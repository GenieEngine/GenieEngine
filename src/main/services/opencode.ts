import { spawn, type ChildProcess } from 'node:child_process'
import { request as httpRequest, get as httpGet } from 'node:http'
import { createServer } from 'node:net'
import { sendToRenderer } from '../window'
import { resolveOpencode } from './binaries'
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
let busy = false
let cancelled = false
let filesChangedTimer: ReturnType<typeof setTimeout> | null = null
/** Roles by messageID — parts carry no role, so user echoes must be filtered. */
const messageRoles = new Map<string, string>()

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
    // tool input (file path or command) so pending chips aren't blank.
    const input = state.input ?? {}
    const title: string =
      state.title || input.filePath || input.pattern || (typeof input.command === 'string' ? input.command : '') || ''
    return {
      messageID: part.messageID,
      partID: part.id,
      kind: 'tool',
      tool: { name: part.tool ?? 'tool', status, title: String(title).slice(0, 200) }
    }
  }
  return null // step-start / step-finish / snapshot etc. — not user-facing
}

/**
 * OpenCode pauses the whole session until permission asks are answered, and
 * OpenGenie has no permission UI — unanswered asks would freeze the chat
 * forever. Match the CLI's autonomous behavior: allow everything inside the
 * project, reject attempts to leave it (the agent sees the denial and
 * corrects course).
 */
function replyToPermission(sessionId: string, permissionId: string, permission: string): void {
  if (!server) return
  const response = permission === 'external_directory' ? 'reject' : 'always'
  void api(server, 'POST', `/session/${sessionId}/permissions/${permissionId}`, { response }).catch(() => {})
}

function handleEvent(evt: any): void {
  const props = evt?.properties ?? {}
  if (evt?.type === 'permission.asked' && props.id && props.sessionID) {
    replyToPermission(props.sessionID, props.id, String(props.permission ?? ''))
  } else if (evt?.type === 'permission.v2.asked' && props.id && props.sessionID) {
    replyToPermission(props.sessionID, props.id, String(props.action ?? ''))
  } else if (evt?.type === 'message.updated' && props.info?.id) {
    messageRoles.set(props.info.id, props.info.role)
  } else if (evt?.type === 'message.part.updated') {
    if (!sessionID || props.sessionID !== sessionID || !props.part) return
    // The user's own message echoes back as a text part — skip it.
    if (messageRoles.get(props.part.messageID) === 'user') return
    const update = translatePart(props.part)
    if (update) sendToRenderer('chat:part', update)
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

async function ensureServer(projectPath: string): Promise<OpencodeServer> {
  if (server && server.projectPath === projectPath && server.proc.exitCode === null) {
    return server
  }
  shutdownChat()

  const opencode = await resolveOpencode()
  if (!opencode) {
    throw new Error(
      'The bundled OpenCode assistant is missing. Reinstall OpenGenie, or run `npm run setup` in development.'
    )
  }

  const port = await getFreePort()
  const proc = spawn(opencode, ['serve', '--port', String(port), '--hostname', '127.0.0.1'], {
    cwd: projectPath,
    // PWD must match cwd — OpenCode trusts the logical PWD for its project
    // directory (see the run-mode bug this fixed in git history).
    // OPENCODE_ENABLE_EXA registers the websearch tool (hosted Exa/Parallel
    // search, no API key needed) — without it, OpenCode only offers webfetch.
    env: { ...process.env, PWD: projectPath, NO_COLOR: '1', OPENCODE_ENABLE_EXA: '1' },
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
 * proactively and explain exactly how to fix it.
 */
async function assertProviderAvailable(srv: OpencodeServer): Promise<void> {
  if (srv.providerChecked) return
  let providerId: string | null = null
  let available = true
  try {
    const config = await api<{ model?: string }>(srv, 'GET', '/config')
    const model = config.model
    if (model && model.includes('/')) {
      providerId = model.split('/')[0]
      const list = await api<{ providers: { id: string }[] }>(srv, 'GET', '/config/providers')
      available = list.providers.some((p) => p.id === providerId)
    }
  } catch {
    return // Introspection failed — don't block the chat on it.
  }
  if (!available && providerId) {
    const opencode = (await resolveOpencode()) ?? 'opencode'
    throw new Error(
      `The AI provider "${providerId}" isn't connected yet — its API key is missing.\n\n` +
        `Open a terminal and run:\n\n"${opencode}" auth login\n\n` +
        `Choose ${providerId} and paste your API key, then start a new chat (/clear).`
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

  const srv = await ensureServer(projectPath)
  await assertProviderAvailable(srv)
  if (!sessionID) {
    const session = await api<{ id: string }>(srv, 'POST', '/session', {})
    sessionID = session.id
  }

  busy = true
  cancelled = false
  const currentSession = sessionID

  // Attachments travel as data-URL file parts in the message itself —
  // they reach the model but are never written into the project.
  const parts: unknown[] = attachments.map((a) => ({
    type: 'file',
    mime: a.mime,
    filename: a.name,
    url: a.dataUrl
  }))
  parts.push({ type: 'text', text: message })

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

/** Start a fresh conversation in the same project (keeps the server warm). */
export function newChatSession(): void {
  cancelChat()
  sessionID = null
}

/** Tear down the chat server — project switch or app quit. */
export function shutdownChat(): void {
  sessionID = null
  busy = false
  messageRoles.clear()
  if (server) {
    server.sseAbort.abort()
    server.proc.kill()
    server = null
  }
}
