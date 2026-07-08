import { app, screen, type BrowserWindow } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { join } from 'node:path'
import type { GameInputEvent, GameState, StageRect } from '../../shared/types'
import { getMainWindow, sendToRenderer } from '../window'
import { resolveGodot } from './binaries'
import { EmbedSession, NOTIFICATION, WIN_EVENT } from './godot-embed'
import {
  domButtonsToGodotMask,
  domButtonToGodot,
  encodeKeyEvent,
  encodeMouseButtonEvent,
  encodeMouseMotionEvent
} from './godot-input-codec'
import { addPerfFrames, appendPerfLog, drainPerfWindow, formatPerfStats, resetPerfWindow, type PerfStats } from './perf-monitor'
import { cleanupTestAgent, injectTestAgent } from './test-agent'

/**
 * Runs the user's game with the full desktop engine, rendered *inside* the
 * OpenGenie window. Uses Godot 4.6+'s embedded display server (the same
 * mechanism the Godot editor uses for its in-editor game view on macOS): the
 * game process renders into a cross-process CoreAnimation context, which we
 * composite via the layerhost native addon; display state and input travel
 * over Godot's debugger protocol. Works in fullscreen — it's just a layer in
 * our window. AI test runs use the same pipeline without attaching the layer.
 */

let state: GameState = { status: 'stopped' }
let nativeProcess: ChildProcess | null = null

// Native embedded-session state
let embedSession: EmbedSession | null = null
let layerAttached = false
let stageRect: StageRect | null = null

// The project that currently has the agent (test-agent.ts) injected — set for
// every embedded run (play and test), cleaned up on stop. Also where perf.log goes.
let injectedProjectPath: string | null = null

// AI test-run state
let testCommandCounter = 0
const pendingTestReplies = new Map<
  number,
  { resolve: (r: { ok: boolean; text: string }) => void; timer: ReturnType<typeof setTimeout> }
>()

/**
 * Budget for one AI test run. Without a cap, open-ended test briefs ran
 * 50-70 agent-loop steps (12+ minutes): the model kept probing instead of
 * concluding, every step re-sent the whole screenshot-laden conversation,
 * and the provider started failing (413/500) — the user saw a frozen chat
 * and cancelled. Healthy focused runs finish in well under 20 tool calls,
 * so the cap only trips runaway sessions. Enforced in the harness
 * (test-harness.ts) because a prompt-only budget is routinely ignored.
 * Starting a new run_game_test resets the budget — deliberate: a fresh run
 * restarts the game, so it can't be farmed to extend one endless session.
 */
const TEST_BUDGET = { calls: 40, ms: 8 * 60_000, warnCalls: 30, warnMs: 6 * 60_000 }
let testToolCalls = 0
let testRunStart = 0

/**
 * Count one game tool call against the current test run's budget and report
 * where it stands. `notice` (when set) must reach the model: it is either the
 * wrap-up warning appended to a successful result or the exhausted message
 * that replaces the tool result entirely.
 */
export function consumeTestBudget(): { exhausted: boolean; notice?: string } {
  if (state.mode !== 'test' || state.status !== 'running') return { exhausted: false }
  testToolCalls++
  const elapsedMs = Date.now() - testRunStart
  const minutes = Math.round(elapsedMs / 60_000)
  if (testToolCalls > TEST_BUDGET.calls || elapsedMs > TEST_BUDGET.ms) {
    return {
      exhausted: true,
      notice:
        `Test budget exhausted (${TEST_BUDGET.calls} game tool calls / ${TEST_BUDGET.ms / 60_000} minutes per run) — ` +
        'stop probing now. Call stop_game_test, then write your report from the evidence you already have. ' +
        'game_logs still works if you need the final console output.'
    }
  }
  if (testToolCalls > TEST_BUDGET.warnCalls || elapsedMs > TEST_BUDGET.warnMs) {
    return {
      exhausted: false,
      notice:
        `[test budget: ${testToolCalls}/${TEST_BUDGET.calls} tool calls, ~${minutes}/${TEST_BUDGET.ms / 60_000} minutes] ` +
        'Wrap up: verify anything essential with the fewest remaining probes, then stop_game_test and report.'
    }
  }
  return { exhausted: false }
}

function setState(next: GameState): void {
  state = next
  sendToRenderer('game:state', state)
}

export function getGameState(): GameState {
  return state
}

// Recent console lines, kept so the AI test harness can read game output.
const logBuffer: string[] = []
const LOG_BUFFER_MAX = 300

export function getGameLogs(): string[] {
  return [...logBuffer]
}

// Godot output can be ANSI-colored; the console renders plain text.
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\[[0-9;]*m/g

function emitLog(line: string): void {
  const clean = line.replace(ANSI_RE, '')
  if (clean.trim().length > 0) {
    logBuffer.push(clean)
    if (logBuffer.length > LOG_BUFFER_MAX) logBuffer.splice(0, logBuffer.length - LOG_BUFFER_MAX)
    sendToRenderer('game:log', clean)
  }
}

function pipeLines(stream: NodeJS.ReadableStream | null): void {
  if (!stream) return
  let buffer = ''
  stream.setEncoding('utf8')
  stream.on('data', (chunk: string) => {
    buffer += chunk
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    lines.forEach(emitLog)
  })
  stream.on('end', () => emitLog(buffer))
}

/**
 * Record a completed 60s frame-rate window: into the game console/log buffer
 * (so the AI's game_logs tool sees it) and the project's .opengenie/perf.log
 * (persistent history for diagnosing performance across runs).
 */
function logPerfStats(stats: PerfStats): void {
  emitLog(`[opengenie] fps ${formatPerfStats(stats)} — history in .opengenie/perf.log`)
  if (injectedProjectPath) {
    void appendPerfLog(injectedProjectPath, state.mode ?? 'native', stats)
  }
}

/** Frame-delta batch (~1/s) from the injected agent — see perf-monitor.ts. */
function handlePerfFrames(deltas: number[]): void {
  const { fps, completed } = addPerfFrames(deltas)
  if (fps !== null) sendToRenderer('game:fps', fps)
  if (completed) logPerfStats(completed)
}

function godotMissingError(): Error {
  return new Error(
    'The bundled Godot engine is missing. Reinstall OpenGenie (or run `npm run setup` in development), or locate a Godot binary manually.'
  )
}

// ---------------------------------------------------------------------------
// layerhost native addon (macOS)
// ---------------------------------------------------------------------------

interface LayerHostAddon {
  attach(handle: Buffer, contextId: number, x: number, y: number, w: number, h: number): boolean
  setFrame(x: number, y: number, w: number, h: number): void
  setVisible(visible: boolean): void
  detach(): void
}

let layerHostAddon: LayerHostAddon | null | undefined

function layerhost(): LayerHostAddon | null {
  if (layerHostAddon !== undefined) return layerHostAddon
  if (process.platform !== 'darwin') {
    layerHostAddon = null
    return null
  }
  const path = app.isPackaged
    ? join(process.resourcesPath, 'app.asar.unpacked', 'native', 'layerhost', 'build', 'Release', 'layerhost.node')
    : join(app.getAppPath(), 'native', 'layerhost', 'build', 'Release', 'layerhost.node')
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    layerHostAddon = require(path) as LayerHostAddon
  } catch (err) {
    console.error('[opengenie] failed to load layerhost addon:', err)
    layerHostAddon = null
  }
  return layerHostAddon
}

// ---------------------------------------------------------------------------
// Native embedded mode
// ---------------------------------------------------------------------------

/** The game's window size message is in *pixels* (the DS divides by scale). */
function sendStageSizeToGame(session: EmbedSession, rect: StageRect): void {
  const win = getMainWindow()
  const scale = win ? currentDisplayState(win).scale : 2
  session.sendWindowSize(rect.width * scale, rect.height * scale)
}

/** Renderer reports where the stage sits inside the window (CSS px = points). */
export function setStageRect(rect: StageRect): void {
  stageRect = rect
  if (layerAttached && embedSession) {
    layerhost()?.setFrame(rect.x, rect.y, rect.width, rect.height)
    sendStageSizeToGame(embedSession, rect)
  }
}

/**
 * Hide/show the embedded game layer. The OS composites it above the web
 * contents, so the renderer can't cover it with DOM — it asks us to hide it
 * while another center tab (e.g. the ECS viewer) occupies the stage.
 */
export function setGameLayerVisible(visible: boolean): void {
  if (layerAttached) layerhost()?.setVisible(visible)
}

function currentDisplayState(win: BrowserWindow): { scale: number; dpi: number; displayId: number } {
  const display = screen.getDisplayMatching(win.getBounds())
  return {
    scale: display.scaleFactor || 1,
    dpi: 96 * (display.scaleFactor || 1),
    // On macOS Electron's display id is the CGDirectDisplayID Godot expects.
    displayId: display.id
  }
}

/** Input events captured by the renderer over the game view. */
export function handleGameInput(event: GameInputEvent): void {
  if (!embedSession) return
  switch (event.type) {
    case 'key':
      embedSession.sendInputEvent(encodeKeyEvent(event))
      break
    case 'mousebutton':
      embedSession.sendInputEvent(
        encodeMouseButtonEvent({
          ...event,
          button: domButtonToGodot(event.button),
          mask: domButtonsToGodotMask(event.buttons)
        })
      )
      break
    case 'mousemotion':
      embedSession.sendInputEvent(
        encodeMouseMotionEvent({ ...event, mask: domButtonsToGodotMask(event.buttons) })
      )
      break
    case 'wheel':
      handleWheel(event)
      break
    case 'enter':
      embedSession.sendWinEvent(WIN_EVENT.MOUSE_ENTER)
      break
    case 'leave':
      embedSession.sendWinEvent(WIN_EVENT.MOUSE_EXIT)
      break
    case 'focus':
      embedSession.sendNotification(NOTIFICATION.APPLICATION_FOCUS_IN)
      embedSession.sendWinEvent(WIN_EVENT.FOCUS_IN)
      break
    case 'blur':
      embedSession.sendWinEvent(WIN_EVENT.FOCUS_OUT)
      embedSession.sendNotification(NOTIFICATION.APPLICATION_FOCUS_OUT)
      break
  }
}

// Wheel deltas accumulate into discrete Godot wheel-button clicks
// (WHEEL_UP=4 / WHEEL_DOWN=5 / WHEEL_LEFT=6 / WHEEL_RIGHT=7).
let wheelAccumX = 0
let wheelAccumY = 0
const WHEEL_STEP = 60

function handleWheel(event: Extract<GameInputEvent, { type: 'wheel' }>): void {
  wheelAccumX += event.deltaX
  wheelAccumY += event.deltaY
  const emit = (button: number): void => {
    const base = { shift: event.shift, ctrl: event.ctrl, alt: event.alt, meta: event.meta, x: event.x, y: event.y, doubleClick: false, mask: 0 }
    embedSession?.sendInputEvent(encodeMouseButtonEvent({ ...base, button, pressed: true }))
    embedSession?.sendInputEvent(encodeMouseButtonEvent({ ...base, button, pressed: false }))
  }
  while (Math.abs(wheelAccumY) >= WHEEL_STEP) {
    emit(wheelAccumY > 0 ? 5 : 4)
    wheelAccumY -= Math.sign(wheelAccumY) * WHEEL_STEP
  }
  while (Math.abs(wheelAccumX) >= WHEEL_STEP) {
    emit(wheelAccumX > 0 ? 7 : 6)
    wheelAccumX -= Math.sign(wheelAccumX) * WHEEL_STEP
  }
}

/**
 * Launch the game with the embedded display server. `visible` attaches the
 * layer host so the game shows in the game view; a test run stays off-screen
 * (the game still renders on the GPU — screenshots and probes work).
 */
async function playNativeEmbedded(godot: string, projectPath: string, visible: boolean): Promise<void> {
  const win = getMainWindow()
  if (!win) throw new Error('Main window unavailable')
  const addon = layerhost()
  if (visible && !addon) {
    throw new Error('Native embedded mode is unavailable (layerhost addon failed to load).')
  }

  const session = new EmbedSession({
    onContextId: (contextId) => {
      // Configure the game's display *after* its embedded display server is
      // up (this message is our signal): with the default state the GL
      // manager has no valid display id and presents nothing but black.
      session.sendDsState(currentDisplayState(win))
      const rect = stageRect ?? { x: 0, y: 0, width: 640, height: 360 }
      sendStageSizeToGame(session, rect)
      if (visible) {
        addon!.attach(win.getNativeWindowHandle(), contextId, rect.x, rect.y, rect.width, rect.height)
        layerAttached = true
        emitLog('[opengenie] game embedded in the OpenGenie window (native, full performance)')
        setState({ status: 'running', mode: 'native' })
      } else {
        emitLog('[opengenie] game running off-screen for an AI test run')
        setState({ status: 'running', mode: 'test' })
      }
      // Give the game keyboard focus semantics right away.
      session.sendNotification(NOTIFICATION.APPLICATION_FOCUS_IN)
      session.sendWinEvent(WIN_EVENT.FOCUS_IN)
    },
    onCursorShape: (shape) => sendToRenderer('game:cursor', shape),
    onDisconnect: () => {
      // Game went away (quit/crash) — tear down if the process exit hasn't already.
      if (state.status !== 'stopped') stopGame()
    },
    onTestReply: (id, ok, text) => {
      const pending = pendingTestReplies.get(id)
      if (pending) {
        clearTimeout(pending.timer)
        pendingTestReplies.delete(id)
        pending.resolve({ ok, text })
      }
    },
    onPerfFrames: handlePerfFrames
  })

  resetPerfWindow()
  const port = await session.listen()
  embedSession = session

  const proc = spawn(
    godot,
    ['--path', projectPath, '--embedded', '--remote-debug', `tcp://127.0.0.1:${port}`, '--skip-breakpoints'],
    {
      cwd: projectPath,
      env: { ...process.env, PWD: projectPath },
      stdio: ['ignore', 'pipe', 'pipe']
    }
  )
  await new Promise<void>((resolve, reject) => {
    proc.once('spawn', resolve)
    proc.once('error', reject)
  })
  nativeProcess = proc
  pipeLines(proc.stdout)
  pipeLines(proc.stderr)
  proc.once('exit', (code, signal) => {
    emitLog(`[opengenie] game exited (${signal ?? `code ${code ?? 0}`})`)
    // Only tear down if this process is still the active run. After a Stop,
    // the old process exits up to 1.5s later (grace period before kill); by
    // then a new run may own nativeProcess/embedSession, and tearing down
    // here would kill that new run.
    if (nativeProcess !== proc) return
    nativeProcess = null
    stopGame()
  })
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function playGame(projectPath: string): Promise<void> {
  if (state.status !== 'stopped') throw new Error('The game is already running')
  const godot = await resolveGodot()
  if (!godot) throw godotMissingError()

  setState({ status: 'starting' })
  try {
    // The agent also runs during user play — it supplies the frame timings
    // behind the FPS counter and .opengenie/perf.log (probe commands stay
    // test-only: runTestCommand refuses outside test mode).
    await cleanupTestAgent(projectPath) // stale files from a crashed run
    await injectTestAgent(projectPath)
    injectedProjectPath = projectPath
    await playNativeEmbedded(godot, projectPath, true)
  } catch (err) {
    stopGame()
    throw err
  }
}

export function stopGame(): void {
  // Flush the in-progress stats window first (needs mode + project path, both
  // still set here); short leftovers are dropped inside drainPerfWindow.
  const finalStats = drainPerfWindow()
  if (finalStats) logPerfStats(finalStats)
  if (nativeProcess) {
    // Ask the game to close cleanly (saves etc.); force-kill if it lingers.
    const proc = nativeProcess
    embedSession?.requestClose()
    setTimeout(() => proc.kill(), 1500)
    nativeProcess = null
  }
  if (layerAttached) {
    layerhost()?.detach()
    layerAttached = false
  }
  embedSession?.close()
  embedSession = null
  wheelAccumX = 0
  wheelAccumY = 0
  for (const pending of pendingTestReplies.values()) {
    clearTimeout(pending.timer)
    pending.resolve({ ok: false, text: 'game stopped' })
  }
  pendingTestReplies.clear()
  if (injectedProjectPath) {
    void cleanupTestAgent(injectedProjectPath)
    injectedProjectPath = null
  }
  if (state.status !== 'stopped') setState({ status: 'stopped' })
}

// ---------------------------------------------------------------------------
// AI test runs (used by the MCP harness — see test-harness.ts)
// ---------------------------------------------------------------------------

/** Start the game off-screen for an AI test run. */
export async function startGameTest(projectPath: string): Promise<void> {
  if (state.status !== 'stopped') {
    throw new Error('A game is already running. Stop it first (stop_game_test or the Stop button).')
  }
  const godot = await resolveGodot()
  if (!godot) throw godotMissingError()

  logBuffer.length = 0
  testToolCalls = 0
  testRunStart = Date.now()
  setState({ status: 'starting', mode: 'test' })
  try {
    await cleanupTestAgent(projectPath) // stale files from a crashed run
    await injectTestAgent(projectPath)
    injectedProjectPath = projectPath
    await playNativeEmbedded(godot, projectPath, false)
    // Wait until the handshake completes (state flips to running) so tools
    // called right after run_game_test find a live session. Read via the
    // accessor: `state` is mutated from event callbacks TS can't see.
    const deadline = Date.now() + 15000
    while (getGameState().status === 'starting' && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100))
    }
    if (getGameState().status !== 'running') {
      throw new Error('The game did not reach a running state — check game_logs for errors.')
    }
  } catch (err) {
    stopGame()
    throw err
  }
}

/** Send a probe command to the injected test agent and await its reply. */
export function runTestCommand(command: string, args: (string | number)[], timeoutMs = 10000): Promise<{ ok: boolean; text: string }> {
  if (!embedSession || state.mode !== 'test' || state.status !== 'running') {
    return Promise.resolve({ ok: false, text: 'No test run is active. Call run_game_test first.' })
  }
  const id = ++testCommandCounter
  const session = embedSession
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingTestReplies.delete(id)
      resolve({ ok: false, text: `test command '${command}' timed out after ${timeoutMs}ms` })
    }, timeoutMs)
    pendingTestReplies.set(id, { resolve, timer })
    session.sendTestCommand(command, id, args)
  })
}

/** One scripted input step from the AI. */
export type TestInputAction =
  | { type: 'key_press'; key: string; holdMs?: number }
  | { type: 'key_down'; key: string }
  | { type: 'key_up'; key: string }
  | { type: 'mouse_click'; x: number; y: number; button?: number }
  | { type: 'mouse_move'; x: number; y: number }
  | { type: 'wait'; ms: number }

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Map a friendly key name to DOM key/code fields for the input codec. */
function keyFields(name: string): { key: string; code: string } {
  if (/^[a-zA-Z]$/.test(name)) return { key: name, code: `Key${name.toUpperCase()}` }
  if (/^[0-9]$/.test(name)) return { key: name, code: `Digit${name}` }
  if (name === ' ' || name.toLowerCase() === 'space') return { key: ' ', code: 'Space' }
  return { key: name, code: name }
}

/** Execute a sequence of input actions against the running test game. */
export async function runTestInput(actions: TestInputAction[]): Promise<void> {
  if (!embedSession || state.status !== 'running') {
    throw new Error('No running game to send input to.')
  }
  if (actions.length > 200) throw new Error('Too many input actions (max 200 per call).')
  const mods = { shift: false, ctrl: false, alt: false, meta: false }
  const keyEvent = (name: string, pressed: boolean): void => {
    const { key, code } = keyFields(name)
    handleGameInput({ type: 'key', key, code, pressed, echo: false, location: 0, ...mods })
  }
  for (const action of actions) {
    switch (action.type) {
      case 'key_press':
        keyEvent(action.key, true)
        await sleep(Math.min(action.holdMs ?? 60, 2000))
        keyEvent(action.key, false)
        break
      case 'key_down':
        keyEvent(action.key, true)
        break
      case 'key_up':
        keyEvent(action.key, false)
        break
      case 'mouse_click': {
        const button = action.button ?? 0
        const buttons = button === 0 ? 1 : button === 2 ? 2 : 4
        handleGameInput({ type: 'mousemotion', x: action.x, y: action.y, relX: 0, relY: 0, buttons: 0, ...mods })
        handleGameInput({ type: 'mousebutton', button, buttons, pressed: true, doubleClick: false, x: action.x, y: action.y, ...mods })
        await sleep(60)
        handleGameInput({ type: 'mousebutton', button, buttons: 0, pressed: false, doubleClick: false, x: action.x, y: action.y, ...mods })
        break
      }
      case 'mouse_move':
        handleGameInput({ type: 'mousemotion', x: action.x, y: action.y, relX: 0, relY: 0, buttons: 0, ...mods })
        break
      case 'wait':
        await sleep(Math.min(action.ms, 10000))
        break
    }
    // Small gap so the game observes distinct events across frames.
    await sleep(20)
  }
}

export async function openGodotEditor(projectPath: string): Promise<void> {
  const godot = await resolveGodot()
  if (!godot) throw godotMissingError()
  // Detached so the editor outlives OpenGenie if the user quits.
  spawn(godot, ['--editor', '--path', projectPath], { detached: true, stdio: 'ignore' }).unref()
}
