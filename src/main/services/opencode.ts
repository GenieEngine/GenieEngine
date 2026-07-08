import { app } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { request as httpRequest, get as httpGet } from 'node:http'
import { createServer } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, sep } from 'node:path'
import { sendToRenderer } from '../window'
import { resolveOpencode } from './binaries'
import { saveChatAttachments } from './chat-history'
import { getHarnessEndpoint } from './test-harness'
import type { ChatAttachment, ChatPartUpdate, ChatToolStatus } from '../../shared/types'

/**
 * AI chat backed by a headless OpenCode server (https://opencode.ai).
 *
 * One `opencode serve` process runs per open project (sessions are bound to
 * the server's working directory). Messages go through the HTTP API and the
 * /event SSE stream feeds live progress — text deltas, reasoning and tool
 * invocations — so long agentic tasks show real activity in the chat instead
 * of a silent spinner. The blocking message POST provides the authoritative
 * final message state.
 */

interface OpencodeServer {
  proc: ChildProcess
  base: string
  projectPath: string
  stderrTail: string
  sseAbort: AbortController
  /** Set once the configured model's provider is confirmed available. */
  providerChecked?: boolean
}

let server: OpencodeServer | null = null
let sessionID: string | null = null
/** True while sessionID came from a saved chat file and hasn't been checked against the server. */
let sessionRestored = false
let busy = false
let cancelled = false
let filesChangedTimer: ReturnType<typeof setTimeout> | null = null
/** Roles by messageID — parts carry no role, so user echoes must be filtered. */
const messageRoles = new Map<string, string>()
/**
 * Accumulated text of streaming parts in the current turn, by partID.
 * message.part.updated only snapshots a part (empty on creation, full on
 * completion) — the characters in between arrive as message.part.delta
 * appends, so without this cache text and thinking would not stream at all.
 */
const partCache = new Map<string, ChatPartUpdate>()

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      const port = typeof address === 'object' && address ? address.port : 0
      probe.close(() => resolve(port))
    })
  })
}

async function waitForHealth(srv: OpencodeServer): Promise<void> {
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    if (srv.proc.exitCode !== null) {
      throw new Error(`OpenCode server exited unexpectedly: ${srv.stderrTail.trim() || 'no output'}`)
    }
    try {
      const res = await fetch(`${srv.base}/session`, { signal: AbortSignal.timeout(2000) })
      if (res.ok) return
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error('OpenCode server did not become ready in time')
}

/* eslint-disable @typescript-eslint/no-explicit-any -- SSE payloads are untyped JSON */
function translatePart(part: any): ChatPartUpdate | null {
  if (!part?.id || !part.messageID) return null
  if (part.type === 'text' || part.type === 'reasoning') {
    return { messageID: part.messageID, partID: part.id, kind: part.type, text: part.text ?? '' }
  }
  if (part.type === 'tool') {
    // Phantom calls: some model/provider combos (notably Kimi through
    // quantized OpenRouter hosts) emit malformed duplicate tool-call
    // fragments. OpenCode records them as tool "unknown" — they never
    // execute and the real call sits alongside, so they're pure noise.
    if (!part.tool || part.tool === 'unknown') return null
    const state = part.state ?? {}
    const status: ChatToolStatus = ['pending', 'running', 'completed', 'error'].includes(state.status)
      ? state.status
      : 'running'
    // Prefer the human title OpenCode assigns on completion; fall back to the
    // tool input (file path, subagent task description, or command) so
    // pending chips aren't blank.
    const input = state.input ?? {}
    const title: string =
      state.title ||
      input.filePath ||
      input.pattern ||
      input.description ||
      (typeof input.command === 'string' ? input.command : '') ||
      ''
    return {
      messageID: part.messageID,
      partID: part.id,
      kind: 'tool',
      tool: {
        name: part.tool ?? 'tool',
        status,
        title: String(title).slice(0, 200),
        // Why the call failed — shown as a tooltip on the red ✗ chip.
        error: status === 'error' && state.error ? String(state.error).slice(0, 500) : undefined
      }
    }
  }
  return null // step-start / step-finish / snapshot etc. — not user-facing
}

/**
 * External directories the agent may use freely: the OS scratch space, in
 * every spelling it shows up under (macOS /tmp is a symlink into /private,
 * and os.tmpdir() lives in /var/folders).
 */
const TEMP_ROOTS = [
  tmpdir(),
  ...(process.platform === 'darwin' ? ['/tmp', '/private/tmp', '/var/folders', '/private/var/folders'] : []),
  ...(process.platform === 'linux' ? ['/tmp'] : [])
]

function isUnderRoot(dir: string, root: string): boolean {
  // Windows paths compare case-insensitively.
  const [a, b] = process.platform === 'win32' ? [dir.toLowerCase(), root.toLowerCase()] : [dir, root]
  return a === b || a.startsWith(b.endsWith(sep) ? b : b + sep)
}

/**
 * OpenCode pauses the whole session until permission asks are answered, and
 * OpenGenie has no permission UI — unanswered asks would freeze the chat
 * forever. Policy, matching the CLI's autonomous behavior:
 *
 *  - external_directory asks for the OS temp dir are approved — shell
 *    commands legitimately stage scratch files in /tmp, and rejecting those
 *    made ordinary bash commands fail mid-turn;
 *  - other external_directory asks are rejected (the agent sees the denial
 *    and corrects course) — game work belongs inside the project;
 *  - everything else is approved.
 *
 * Bash can still slip file access past OpenCode's command parsing, so this
 * reply is NOT what keeps the agent out of the user's personal folders — the
 * macOS seatbelt around the server process is (see sandboxCommand).
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- untyped event payload */
function replyToPermission(sessionId: string, permissionId: string, permission: string, ask: any): void {
  if (!server) return
  let response: 'always' | 'reject' = 'always'
  if (permission === 'external_directory') {
    // The ask names the directories involved: bash asks carry
    // metadata.directories, file-tool asks metadata.parentDir, and both carry
    // "<dir>/*" patterns. An ask we can't extract a directory from fails
    // closed (reject), same as the old blanket behavior.
    const meta = ask?.metadata ?? {}
    const dirs: string[] = (
      Array.isArray(meta.directories) && meta.directories.length
        ? meta.directories
        : typeof meta.parentDir === 'string' && meta.parentDir
          ? [meta.parentDir]
          : Array.isArray(ask?.patterns)
            ? ask.patterns.map((p: unknown) => String(p).replace(/[\\/]\*$/, ''))
            : []
    ).map(String)
    const inTemp = dirs.length > 0 && dirs.every((d) => TEMP_ROOTS.some((root) => isUnderRoot(d, root)))
    response = inTemp ? 'always' : 'reject'
  }
  void api(server, 'POST', `/session/${sessionId}/permissions/${permissionId}`, { response }).catch(() => {})
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function handleEvent(evt: any): void {
  const props = evt?.properties ?? {}
  if (evt?.type === 'permission.asked' && props.id && props.sessionID) {
    replyToPermission(props.sessionID, props.id, String(props.permission ?? ''), props)
  } else if (evt?.type === 'permission.v2.asked' && props.id && props.sessionID) {
    replyToPermission(props.sessionID, props.id, String(props.action ?? ''), props)
  } else if (
    (evt?.type === 'question.asked' || evt?.type === 'question.v2.asked') &&
    props.id &&
    props.sessionID === sessionID
  ) {
    // The "question" tool blocks the whole turn until it gets a reply — the
    // renderer shows the options as buttons (see ChatPanel's question card).
    // Both API generations carry identical payloads (id/sessionID/questions),
    // same v1/v2 dance as the permission events above.
    sendToRenderer('chat:question', { id: props.id, questions: props.questions ?? [] })
  } else if (/^question\.(v2\.)?(replied|rejected)$/.test(evt?.type) && props.requestID) {
    sendToRenderer('chat:question-done', props.requestID)
  } else if (evt?.type === 'message.updated' && props.info?.id) {
    messageRoles.set(props.info.id, props.info.role)
  } else if (evt?.type === 'message.part.updated') {
    if (!sessionID || props.sessionID !== sessionID || !props.part) return
    // The user's own message echoes back as a text part — skip it.
    if (messageRoles.get(props.part.messageID) === 'user') return
    const update = translatePart(props.part)
    if (update) {
      if (update.kind === 'text' || update.kind === 'reasoning') partCache.set(update.partID, update)
      sendToRenderer('chat:part', update)
    }
  } else if (evt?.type === 'message.part.delta') {
    if (!sessionID || props.sessionID !== sessionID || props.field !== 'text') return
    const cached = partCache.get(props.partID)
    if (!cached) return // part not announced (or not a streaming kind) — skip
    cached.text = (cached.text ?? '') + String(props.delta ?? '')
    sendToRenderer('chat:part', { ...cached })
  } else if (evt?.type === 'file.edited') {
    // The agent touched a project file — nudge the Files/Git panels (debounced).
    if (filesChangedTimer) clearTimeout(filesChangedTimer)
    filesChangedTimer = setTimeout(() => sendToRenderer('chat:files-changed'), 750)
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Consume the server's SSE event stream via node:http — undici's fetch
 * applies a 5-minute idle body timeout that would silently kill the stream
 * during long agent "thinking" gaps. Reconnects while the server lives.
 */
function pumpEvents(srv: OpencodeServer): void {
  if (srv.sseAbort.signal.aborted) return
  const req = httpGet(`${srv.base}/event`, { signal: srv.sseAbort.signal, timeout: 0 }, (res) => {
    res.setEncoding('utf8')
    let buffer = ''
    res.on('data', (chunk: string) => {
      buffer += chunk
      const frames = buffer.split('\n\n')
      buffer = frames.pop() ?? ''
      for (const frame of frames) {
        const dataLine = frame.split('\n').find((l) => l.startsWith('data:'))
        if (!dataLine) continue
        try {
          handleEvent(JSON.parse(dataLine.slice(5)))
        } catch {
          /* malformed frame — skip */
        }
      }
    })
    res.on('end', () => retry())
    res.on('error', () => retry())
  })
  req.on('error', () => retry())

  const retry = (): void => {
    if (!srv.sseAbort.signal.aborted && srv.proc.exitCode === null) {
      setTimeout(() => pumpEvents(srv), 1000)
    }
  }
}

/** Quote a path as an SBPL string literal. */
function sbplPath(p: string): string {
  return `"${p.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/** A path plus its symlink-resolved form (seatbelt matches canonical paths). */
function withRealpath(p: string): string[] {
  try {
    const real = realpathSync(p)
    return real === p ? [p] : [p, real]
  } catch {
    return [p]
  }
}

/**
 * Wraps the chat-server command in a macOS seatbelt sandbox, inherited by
 * every tool it spawns (bash, rg, git, the MCP bridge). Two reasons:
 *
 *  - macOS attributes file access by this process tree to OpenGenie, so a
 *    stray `find ~` from the model used to pop "OpenGenie would like to
 *    access your Desktop/Photos/…" TCC dialogs at the user. Seatbelt denies
 *    the access before TCC is ever consulted — no dialog, the command just
 *    gets a permission error the agent can read and route around.
 *  - OpenCode's external-directory permission asks are parsed out of bash
 *    commands heuristically and can miss, so replyToPermission alone can't
 *    keep the agent out of personal folders. This is the hard boundary.
 *
 * The profile allows everything except the user's personal and cloud-synced
 * folders plus key credential stores. The project itself is re-allowed even
 * when it lives inside a denied folder (projects commonly sit in Documents;
 * SBPL is last-match-wins), and the app's own files stay readable — the
 * opencode binary, MCP bridge, and dev vendor tree live there.
 */
function sandboxCommand(opencode: string, args: string[], projectPath: string): { command: string; args: string[] } {
  if (process.platform !== 'darwin') return { command: opencode, args }
  const home = homedir()
  const denyDirs = [
    app.getPath('desktop'),
    app.getPath('documents'),
    app.getPath('downloads'),
    app.getPath('music'),
    app.getPath('pictures'), // includes the Photos library
    app.getPath('videos'),
    join(home, 'Library', 'Mobile Documents'), // iCloud Drive
    join(home, 'Library', 'CloudStorage'), // Google Drive / Dropbox / OneDrive mounts
    join(home, 'Library', 'Containers'),
    join(home, 'Library', 'Group Containers'),
    join(home, '.ssh'),
    join(home, '.aws'),
    join(home, '.gnupg'),
    '/Volumes' // removable + network drives
  ]
  // The MCP bridge reads harness.json from userData, so that directory stays
  // readable — but the asset-generation API keys stored next to it don't.
  const denyFiles = [
    join(app.getPath('userData'), 'gptimage-credentials.json'),
    join(app.getPath('userData'), 'hy3d-credentials.json')
  ]
  const allowRead = [...withRealpath(app.getAppPath()), ...withRealpath(process.resourcesPath), dirname(opencode)]
  const allowReadWrite = withRealpath(projectPath)
  const profile = [
    '(version 1)',
    '(allow default)',
    `(deny file-read* file-write* ${denyDirs.map((p) => `(subpath ${sbplPath(p)})`).join(' ')})`,
    `(deny file-read* ${denyFiles.map((p) => `(literal ${sbplPath(p)})`).join(' ')})`,
    `(allow file-read* ${allowRead.map((p) => `(subpath ${sbplPath(p)})`).join(' ')})`,
    `(allow file-read* file-write* ${allowReadWrite.map((p) => `(subpath ${sbplPath(p)})`).join(' ')})`
  ].join('\n')
  return { command: '/usr/bin/sandbox-exec', args: ['-p', profile, opencode, ...args] }
}

/** Kill the serve process (if any) without touching conversation state. */
function killServer(): void {
  if (server) {
    server.sseAbort.abort()
    server.proc.kill()
    server = null
  }
}

async function ensureServer(projectPath: string): Promise<OpencodeServer> {
  if (server && server.projectPath === projectPath && server.proc.exitCode === null) {
    return server
  }
  // Replace a dead or wrong-project server process — but never reset the
  // conversation here: sessions live in OpenCode's storage, not the process,
  // and a session restored from saved chat history must survive its own
  // first send (which is what spawns the server).
  killServer()

  const opencode = await resolveOpencode()
  if (!opencode) {
    throw new Error(
      'The bundled OpenCode assistant is missing. Reinstall OpenGenie, or run `npm run setup` in development.'
    )
  }

  const port = await getFreePort()
  // The MCP bridge inherits this env through OpenCode, so the game-test tools
  // reach THIS app instance even when several OpenGenie instances are running
  // (harness.json alone is shared and only names whichever registered last).
  const harness = getHarnessEndpoint()
  const { command, args } = sandboxCommand(
    opencode,
    ['serve', '--port', String(port), '--hostname', '127.0.0.1'],
    projectPath
  )
  const proc = spawn(command, args, {
    cwd: projectPath,
    // PWD must match cwd — OpenCode trusts the logical PWD for its project
    // directory (see the run-mode bug this fixed in git history).
    // OPENCODE_ENABLE_EXA registers the websearch tool (hosted Exa/Parallel
    // search, no API key needed) — without it, OpenCode only offers webfetch.
    env: {
      ...process.env,
      PWD: projectPath,
      NO_COLOR: '1',
      OPENCODE_ENABLE_EXA: '1',
      ...(harness
        ? { OPENGENIE_HARNESS_PORT: String(harness.port), OPENGENIE_HARNESS_TOKEN: harness.token }
        : {})
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })

  const srv: OpencodeServer = {
    proc,
    base: `http://127.0.0.1:${port}`,
    projectPath,
    stderrTail: '',
    sseAbort: new AbortController()
  }
  proc.stderr?.setEncoding('utf8')
  proc.stderr?.on('data', (chunk: string) => {
    srv.stderrTail = (srv.stderrTail + chunk).slice(-2000)
  })
  proc.once('exit', () => {
    if (server === srv) server = null
  })

  await waitForHealth(srv)
  server = srv
  pumpEvents(srv)
  return srv
}

/**
 * API call via node:http with timeouts disabled: the message POST blocks for
 * the entire agent run, which can far exceed undici fetch's 5-minute default.
 */
function api<T>(srv: OpencodeServer, method: string, path: string, body?: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      `${srv.base}${path}`,
      { method, headers: { 'content-type': 'application/json' }, timeout: 0 },
      (res) => {
        res.setEncoding('utf8')
        let data = ''
        res.on('data', (chunk: string) => (data += chunk))
        res.on('end', () => {
          if ((res.statusCode ?? 500) >= 400) {
            reject(new Error(`OpenCode API ${method} ${path} failed (${res.statusCode}): ${data.slice(0, 300)}`))
            return
          }
          try {
            resolve(JSON.parse(data) as T)
          } catch {
            reject(new Error(`OpenCode API ${method} ${path}: invalid JSON response`))
          }
        })
        res.on('error', reject)
      }
    )
    req.on('error', reject)
    if (body !== undefined) req.write(JSON.stringify(body))
    req.end()
  })
}

/**
 * The most common first-run failure is a configured model whose provider has
 * no credentials (OpenCode then 500s with an opaque "UnknownError"). Check
 * proactively — the main model AND the subagents' image model, which may use
 * its own provider — and explain exactly how to fix it.
 */
async function assertProviderAvailable(srv: OpencodeServer): Promise<void> {
  if (srv.providerChecked) return
  let missing: string | null = null
  try {
    const config = await api<{ model?: string; agent?: Record<string, { model?: string }> }>(
      srv,
      'GET',
      '/config'
    )
    const wanted = new Set<string>()
    for (const ref of [config.model, ...Object.values(config.agent ?? {}).map((a) => a?.model)]) {
      if (typeof ref === 'string' && ref.includes('/')) wanted.add(ref.split('/')[0])
    }
    if (wanted.size) {
      const list = await api<{ providers: { id: string }[] }>(srv, 'GET', '/config/providers')
      const available = new Set(list.providers.map((p) => p.id))
      missing = [...wanted].find((id) => !available.has(id)) ?? null
    }
  } catch {
    return // Introspection failed — don't block the chat on it.
  }
  if (missing) {
    // The settings panel writes keys for every provider we configure
    // (including the `custom`/`image` openai-compatible ones, which
    // `opencode auth login` has no named entry for) — point users there.
    throw new Error(
      `The AI provider "${missing}" isn't connected yet — its API key is missing.\n\n` +
        `Open the AI settings (gear icon in the sidebar) and add the API key for its endpoint, then try again.`
    )
  }
  srv.providerChecked = true
}

/**
 * Validates and kicks off a chat turn. Resolves as soon as the request is
 * accepted; progress streams via chat:part events and completion (or failure)
 * arrives as a chat:done event when the blocking POST returns.
 */
export async function sendChatMessage(
  message: string,
  projectPath: string,
  attachments: ChatAttachment[] = []
): Promise<void> {
  if (busy) throw new Error('A response is already in progress')
  // Claim the turn before the first await — two rapid sends could otherwise
  // both pass the guard above while the first was still starting its server.
  busy = true
  cancelled = false

  let srv: OpencodeServer
  try {
    srv = await ensureServer(projectPath)
    await assertProviderAvailable(srv)
    // A session restored from a saved chat continues that conversation (OpenCode
    // persists sessions per directory) — but only if the server still knows it;
    // otherwise fall back to a fresh session rather than failing the send.
    if (sessionID && sessionRestored) {
      await api(srv, 'GET', `/session/${sessionID}`).catch(() => (sessionID = null))
      sessionRestored = false
    }
    if (!sessionID) {
      const session = await api<{ id: string }>(srv, 'POST', '/session', {})
      sessionID = session.id
    }
  } catch (err) {
    busy = false
    throw err
  }

  // Parts of finished turns are final — only the live turn needs delta state.
  partCache.clear()
  const currentSession = sessionID

  // Image attachments are additionally saved under .opengenie/attachments/
  // and their paths appended to the message: the main coding model may not
  // accept image input (OpenCode then replaces the file parts below with an
  // "ERROR: Cannot read" note), and the image-enabled subagents can only
  // reach an image through a file path. Best-effort — a failed save just
  // means the message goes out the old way.
  let text = message
  const images = attachments.filter((a) => a.mime.startsWith('image/'))
  if (images.length) {
    const saved = await saveChatAttachments(projectPath, images).catch(() => [] as string[])
    if (saved.length) {
      text +=
        `\n\n[The attached image${saved.length > 1 ? 's are' : ' is'} also saved at: ` +
        `${saved.join(', ')} — if you cannot view images yourself, delegate to the ` +
        `image-reader subagent with the path${saved.length > 1 ? 's' : ''}.]`
    }
  }

  // Attachments travel as data-URL file parts in the message itself —
  // they reach the model directly when it supports image input.
  const parts: unknown[] = attachments.map((a) => ({
    type: 'file',
    mime: a.mime,
    filename: a.name,
    url: a.dataUrl
  }))
  parts.push({ type: 'text', text })

  void (async () => {
    try {
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
      const reply = await api<any>(srv, 'POST', `/session/${currentSession}/message`, { parts })
      // Re-send the final parts: guarantees the full text is present even if
      // the last SSE frames raced the POST response.
      for (const part of reply?.parts ?? []) {
        const update = translatePart(part)
        if (update) sendToRenderer('chat:part', update)
      }
      const error = reply?.info?.error
      if (cancelled) {
        sendToRenderer('chat:done', { ok: false, cancelled: true })
      } else if (error) {
        const detail = error?.data?.message || error?.name || JSON.stringify(error)
        sendToRenderer('chat:done', { ok: false, error: String(detail) })
      } else {
        sendToRenderer('chat:done', { ok: true })
      }
    } catch (err) {
      sendToRenderer('chat:done', {
        ok: false,
        cancelled,
        error: cancelled ? undefined : err instanceof Error ? err.message : String(err)
      })
    } finally {
      busy = false
    }
  })()
}

export function cancelChat(): void {
  if (busy && server && sessionID) {
    cancelled = true
    void fetch(`${server.base}/session/${sessionID}/abort`, { method: 'POST' }).catch(() => {})
  }
}

/**
 * A request is owned by whichever question-API generation created it, and the
 * event doesn't say which — answer via the v1 route, falling back to v2.
 */
async function questionAction(requestID: string, action: 'reply' | 'reject', body: unknown): Promise<void> {
  if (!server) throw new Error('The assistant is not running.')
  try {
    await api(server, 'POST', `/question/${requestID}/${action}`, body)
  } catch {
    await api(server, 'POST', `/api/session/${sessionID}/question/${requestID}/${action}`, body)
  }
}

/** Deliver the user's answers for a pending question (unblocks the turn). */
export async function answerQuestion(requestID: string, answers: string[][]): Promise<void> {
  await questionAction(requestID, 'reply', { answers })
}

/** Dismiss a pending question — best-effort; the tool reports the dismissal to the model. */
export async function rejectQuestion(requestID: string): Promise<void> {
  if (!server) return
  await questionAction(requestID, 'reject', {}).catch(() => {})
}

/**
 * Questions still awaiting an answer in the current session. Lets a freshly
 * (re)loaded window re-show the question card instead of leaving the turn
 * stuck on a prompt that's no longer on screen.
 */
export async function pendingQuestion(): Promise<{ id: string; questions: unknown[] } | null> {
  if (!server || !sessionID) return null
  /* eslint-disable @typescript-eslint/no-explicit-any -- untyped server JSON */
  const v1 = await api<any[]>(server, 'GET', '/question').catch(() => [])
  const v2 = await api<{ data?: any[] }>(server, 'GET', `/api/session/${sessionID}/question`).catch(
    () => ({}) as { data?: any[] }
  )
  /* eslint-enable @typescript-eslint/no-explicit-any */
  const mine = [...(Array.isArray(v1) ? v1 : []), ...(v2.data ?? [])].find(
    (r) => r?.sessionID === sessionID && r?.id
  )
  return mine ? { id: mine.id, questions: mine.questions ?? [] } : null
}

/** Start a fresh conversation in the same project (keeps the server warm). */
export function newChatSession(): void {
  cancelChat()
  sessionID = null
  sessionRestored = false
}

/**
 * Continue a session saved in the project's chat history (called when a
 * project with a restored transcript is opened). Verified lazily on the next
 * send — see sendChatMessage.
 */
export function resumeSession(id: string | null): void {
  if (busy) return
  sessionID = id
  sessionRestored = id !== null
}

/** The active conversation id, saved with the transcript for later resume. */
export function getSessionID(): string | null {
  return sessionID
}

/** Tear down the chat server — project switch or app quit. */
export function shutdownChat(): void {
  sessionID = null
  sessionRestored = false
  busy = false
  messageRoles.clear()
  partCache.clear()
  killServer()
}
