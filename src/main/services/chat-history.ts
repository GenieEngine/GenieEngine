import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ChatAttachment } from '../../shared/types'

/**
 * Per-project chat persistence, stored inside the game project under
 * .opengenie/ (gitignored — chat transcripts are personal, never shared):
 *
 * - chat.json           the rendered transcript plus the OpenCode session id,
 *                       restored when the project is reopened. /clear deletes
 *                       it, so a cleared chat stays cleared.
 * - input-history.json  every message the user has sent, for ↑/↓ recall in
 *                       the composer. Intentionally survives /clear.
 * - attachments/        images the user attached to messages, saved so the
 *                       AI's image-enabled subagents can open them by path.
 *
 * The transcript is stored as the renderer's own message JSON — the main
 * process treats it as opaque (`unknown[]`) and the renderer validates shape
 * on load, so a schema change can never crash the app, only skip restoring.
 */

const STATE_DIR = '.opengenie'
const CHAT_FILE = 'chat.json'
const INPUT_FILE = 'input-history.json'
const ATTACH_DIR = 'attachments'
const MAX_INPUT_ENTRIES = 100

export interface SavedChat {
  sessionID: string | null
  messages: unknown[]
  inputHistory: string[]
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch {
    return null // missing or corrupt — treated as empty
  }
}

/**
 * Transcripts can be large (they embed screenshots as data URLs); write via
 * temp file + rename so a crash mid-write can't leave corrupt JSON behind.
 */
async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const tmp = `${path}.tmp`
  await writeFile(tmp, JSON.stringify(value))
  await rename(tmp, path)
}

/** Projects whose .gitignore already got the .opengenie/ entry this run. */
const ignoreEnsured = new Set<string>()

async function ensureStateDir(projectPath: string): Promise<string> {
  const dir = join(projectPath, STATE_DIR)
  await mkdir(dir, { recursive: true })
  if (!ignoreEnsured.has(projectPath)) {
    ignoreEnsured.add(projectPath)
    // New projects get this via the template; this covers projects created
    // before chat persistence existed and imported Godot projects.
    const gitignorePath = join(projectPath, '.gitignore')
    const current = await readFile(gitignorePath, 'utf8').catch(() => '')
    if (!current.split('\n').some((line) => line.trim().replace(/\/$/, '') === STATE_DIR)) {
      const entry = `${current && !current.endsWith('\n') ? '\n' : ''}\n# OpenGenie local chat history (personal, never shared)\n${STATE_DIR}/\n`
      await writeFile(gitignorePath, current + entry).catch(() => {})
    }
  }
  return dir
}

export async function loadChatState(projectPath: string): Promise<SavedChat> {
  const dir = join(projectPath, STATE_DIR)
  const chat = await readJson<{ sessionID?: unknown; messages?: unknown }>(join(dir, CHAT_FILE))
  const input = await readJson<{ entries?: unknown }>(join(dir, INPUT_FILE))
  return {
    sessionID: typeof chat?.sessionID === 'string' ? chat.sessionID : null,
    messages: Array.isArray(chat?.messages) ? chat.messages : [],
    inputHistory: Array.isArray(input?.entries) ? input.entries.filter((e) => typeof e === 'string') : []
  }
}

export async function saveChatHistory(
  projectPath: string,
  messages: unknown[],
  sessionID: string | null
): Promise<void> {
  const dir = await ensureStateDir(projectPath)
  await writeJsonAtomic(join(dir, CHAT_FILE), { version: 1, sessionID, messages })
}

export async function appendInputHistory(projectPath: string, entry: string): Promise<void> {
  if (!entry.trim()) return
  const dir = await ensureStateDir(projectPath)
  const path = join(dir, INPUT_FILE)
  const entries = (await readJson<{ entries?: string[] }>(path))?.entries ?? []
  if (entries[entries.length - 1] === entry) return // consecutive repeat
  entries.push(entry)
  await writeJsonAtomic(path, { version: 1, entries: entries.slice(-MAX_INPUT_ENTRIES) })
}

/** /clear: forget the transcript (input history intentionally stays). */
export async function clearChatHistory(projectPath: string): Promise<void> {
  await rm(join(projectPath, STATE_DIR, CHAT_FILE), { force: true })
  // Attachments only exist for the conversation that referenced them — a
  // cleared chat can't reach the old paths, so drop the files with it.
  await rm(join(projectPath, STATE_DIR, ATTACH_DIR), { recursive: true, force: true })
}

/**
 * Writes message attachments into .opengenie/attachments/ and returns their
 * project-relative paths (POSIX-style, ready for the message text). Saving to
 * disk is what lets an image reach the image-enabled subagents: they never
 * see the data URLs riding the chat message — a file path handed through the
 * task tool plus the `read` tool is their only way in. The main model may not
 * accept image input at all, so the path can be the image's only usable form.
 */
export async function saveChatAttachments(
  projectPath: string,
  attachments: ChatAttachment[]
): Promise<string[]> {
  if (attachments.length === 0) return []
  const dir = join(await ensureStateDir(projectPath), ATTACH_DIR)
  await mkdir(dir, { recursive: true })
  const stamp = Date.now()
  const saved: string[] = []
  for (const [i, attachment] of attachments.entries()) {
    const comma = attachment.dataUrl.indexOf(',')
    if (comma === -1) continue
    // Attachment names come from the user's filesystem — keep a recognizable
    // slug but drop anything path-hostile; the timestamp prefix de-dupes.
    const base =
      attachment.name
        .replace(/\.[^.]*$/, '')
        .replace(/[^\w.-]+/g, '_')
        .slice(0, 40) || 'image'
    const ext =
      attachment.name.match(/\.([A-Za-z0-9]+)$/)?.[1] ??
      attachment.mime.split('/')[1]?.split('+')[0] ??
      'png'
    const file = `${stamp}-${i}-${base}.${ext}`
    await writeFile(join(dir, file), Buffer.from(attachment.dataUrl.slice(comma + 1), 'base64'))
    saved.push(`${STATE_DIR}/${ATTACH_DIR}/${file}`)
  }
  return saved
}
