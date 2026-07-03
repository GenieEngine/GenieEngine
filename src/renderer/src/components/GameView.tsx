import { useCallback, useEffect, useRef, useState } from 'react'
import type { AspectMode, GameInputModifiers, GameState } from '../../../shared/types'
import { PlayIcon, StopIcon, XIcon } from './Icons'

/** width/height ratios for enforced preview shapes (modern phones ≈ 19.5:9). */
const ASPECT_RATIOS: Partial<Record<AspectMode, number>> = {
  desktop: 16 / 9,
  'mobile-portrait': 9 / 19.5,
  'mobile-landscape': 19.5 / 9
}

/** Godot CursorShape → CSS cursor (servers/display DisplayServer::CursorShape order). */
const GODOT_CURSORS = [
  'default', 'text', 'pointer', 'crosshair', 'wait', 'progress', 'grabbing', 'copy', 'not-allowed',
  'ns-resize', 'ew-resize', 'nesw-resize', 'nwse-resize', 'move', 'row-resize', 'col-resize', 'help'
]

function modifiers(e: { shiftKey: boolean; ctrlKey: boolean; altKey: boolean; metaKey: boolean }): GameInputModifiers {
  return { shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey, meta: e.metaKey }
}

/**
 * Captures input over the embedded native game (which renders as a layer
 * behind this transparent element) and forwards it to the game process.
 */
function NativeGameOverlay(): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [cursor, setCursor] = useState('default')

  useEffect(() => window.api.onGameCursor((shape) => setCursor(GODOT_CURSORS[shape] ?? 'default')), [])

  // Focus the game as soon as it appears so keyboard input works immediately.
  useEffect(() => {
    ref.current?.focus()
  }, [])

  const pos = useCallback((e: React.MouseEvent): { x: number; y: number } => {
    const rect = ref.current?.getBoundingClientRect()
    return { x: e.clientX - (rect?.x ?? 0), y: e.clientY - (rect?.y ?? 0) }
  }, [])

  return (
    <div
      ref={ref}
      className="native-overlay"
      style={{ cursor }}
      tabIndex={0}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        e.preventDefault()
        window.api.sendGameInput({
          type: 'key', key: e.key, code: e.code, pressed: true, echo: e.repeat,
          location: e.location, ...modifiers(e)
        })
      }}
      onKeyUp={(e) => {
        e.preventDefault()
        window.api.sendGameInput({
          type: 'key', key: e.key, code: e.code, pressed: false, echo: false,
          location: e.location, ...modifiers(e)
        })
      }}
      onMouseDown={(e) => {
        ref.current?.focus()
        window.api.sendGameInput({
          type: 'mousebutton', button: e.button, buttons: e.buttons, pressed: true,
          doubleClick: e.detail === 2, ...pos(e), ...modifiers(e)
        })
      }}
      onMouseUp={(e) =>
        window.api.sendGameInput({
          type: 'mousebutton', button: e.button, buttons: e.buttons, pressed: false,
          doubleClick: false, ...pos(e), ...modifiers(e)
        })
      }
      onMouseMove={(e) =>
        window.api.sendGameInput({
          type: 'mousemotion', ...pos(e), relX: e.movementX, relY: e.movementY,
          buttons: e.buttons, ...modifiers(e)
        })
      }
      onWheel={(e) =>
        window.api.sendGameInput({ type: 'wheel', ...pos(e), deltaX: e.deltaX, deltaY: e.deltaY, ...modifiers(e) })
      }
      onMouseEnter={() => window.api.sendGameInput({ type: 'enter' })}
      onMouseLeave={() => window.api.sendGameInput({ type: 'leave' })}
      onFocus={() => window.api.sendGameInput({ type: 'focus' })}
      onBlur={() => window.api.sendGameInput({ type: 'blur' })}
    />
  )
}

interface Props {
  state: GameState
  error: string | null
  godotPath: string | null
  aspect: AspectMode
  onPlay: () => void
  onStop: () => void
  onLocateGodot: () => void
  onDismissError: () => void
  advancedMode: boolean
}

const MAX_LOG_LINES = 500
const CONSOLE_HEIGHT_KEY = 'opengenie:consoleHeight'
const CONSOLE_MIN = 80
const CONSOLE_MAX = 600

/**
 * Center stage. Run renders the full native engine embedded in this view
 * (via the layerhost compositing pipeline); the transparent overlay captures
 * input. AI test runs show a live monitor card instead.
 */
export function GameView({
  state,
  error,
  godotPath,
  aspect,
  onPlay,
  onStop,
  onLocateGodot,
  onDismissError,
  advancedMode
}: Props): React.JSX.Element {
  const [logs, setLogs] = useState<string[]>([])
  const [testShot, setTestShot] = useState<string | null>(null)
  const consoleRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const areaRef = useRef<HTMLElement>(null)

  // Console height, drag-resizable like the sidebar (persisted).
  const [consoleHeight, setConsoleHeight] = useState(() => {
    const saved = Number(localStorage.getItem(CONSOLE_HEIGHT_KEY))
    return saved >= CONSOLE_MIN && saved <= CONSOLE_MAX ? saved : 160
  })

  const onConsoleDrag = useCallback((down: React.MouseEvent) => {
    down.preventDefault()
    document.body.classList.add('resizing-v')
    const onMove = (e: MouseEvent): void => {
      const bottom = areaRef.current?.getBoundingClientRect().bottom ?? window.innerHeight
      const maxH = Math.min(CONSOLE_MAX, (areaRef.current?.getBoundingClientRect().height ?? 800) - 120)
      setConsoleHeight(Math.min(maxH, Math.max(CONSOLE_MIN, bottom - e.clientY)))
    }
    const onUp = (): void => {
      document.body.classList.remove('resizing-v')
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      setConsoleHeight((h) => {
        localStorage.setItem(CONSOLE_HEIGHT_KEY, String(h))
        return h
      })
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])

  // Live monitor: show the latest screenshot the AI captured while testing.
  useEffect(() => window.api.onGameTestShot(setTestShot), [])
  useEffect(() => {
    if (state.status !== 'running' || state.mode !== 'test') setTestShot(null)
  }, [state])

  // Keep the main process aware of where the game should render. With an
  // enforced aspect ratio the game frame is the largest centered rect of that
  // shape inside the stage — the stage's black background forms the bars.
  const [frameSize, setFrameSize] = useState<{ width: number; height: number } | null>(null)
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const report = (): void => {
      const rect = el.getBoundingClientRect()
      // Hidden behind another center tab (display:none → 0×0): reporting that
      // would resize the running game's window to nothing. Skip; a real rect
      // is re-reported the moment the tab becomes visible again.
      if (rect.width < 2 || rect.height < 2) return
      const ratio = ASPECT_RATIOS[aspect]
      let width = rect.width
      let height = rect.height
      if (ratio) {
        if (rect.width / rect.height > ratio) {
          height = rect.height
          width = height * ratio
        } else {
          width = rect.width
          height = width / ratio
        }
        setFrameSize({ width, height })
      } else {
        setFrameSize(null)
      }
      window.api.setGameStageBounds({
        x: rect.x + (rect.width - width) / 2,
        y: rect.y + (rect.height - height) / 2,
        width,
        height
      })
    }
    report()
    const observer = new ResizeObserver(report)
    observer.observe(el)
    return () => observer.disconnect()
  }, [aspect])

  useEffect(
    () =>
      window.api.onGameLog((line) => {
        setLogs((prev) => [...prev, line].slice(-MAX_LOG_LINES))
      }),
    []
  )

  useEffect(() => {
    const el = consoleRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [logs])

  const renderStage = (): React.JSX.Element => {
    if (state.status === 'starting') {
      return (
        <div className="game-idle">
          <div className="spinner big" />
          <h2>Starting your game…</h2>
        </div>
      )
    }
    if (state.status === 'running' && state.mode === 'test') {
      return (
        <div className="game-running-card">
          <span className="status-dot starting big" />
          <h2>AI test run in progress</h2>
          <p className="muted">
            {testShot
              ? 'Latest screenshot the assistant captured:'
              : 'The assistant is running your game off-screen — playing it, taking screenshots and checking its state.'}
          </p>
          {testShot && <img className="test-monitor" src={testShot} alt="Latest AI test screenshot" />}
          <button className="btn btn-stop" onClick={onStop}>
            <StopIcon size={12} /> Stop
          </button>
        </div>
      )
    }
    if (state.status === 'running') {
      // Native embedded: the game renders as a native layer exactly behind
      // this transparent frame, which captures and forwards input. The frame
      // matches the (possibly letterboxed) game rect.
      return (
        <div className="game-frame-box" style={frameSize ?? { width: '100%', height: '100%' }}>
          <NativeGameOverlay />
        </div>
      )
    }
    return (
      <div className="game-idle">
        <button className="play-hero" onClick={onPlay} title="Run your game">
          <PlayIcon size={30} />
        </button>
        <h2>Press Run to start your game</h2>
        <p className="muted">
          Your game runs right here in OpenGenie. Ask the assistant in the chat to build or change
          anything.
        </p>
        {!godotPath && (
          <button className="warning-chip" onClick={onLocateGodot}>
            Bundled Godot engine missing — reinstall OpenGenie, or click to locate one
          </button>
        )}
      </div>
    )
  }

  const embedded = state.status === 'running'

  return (
    <section className="game-area" ref={areaRef}>
      <div ref={stageRef} className={embedded ? 'game-stage embedded' : 'game-stage'}>
        {error && (
          <div className="error-banner">
            <span className="error-text">{error}</span>
            <span className="banner-actions">
              {error.toLowerCase().includes('godot') && (
                <button className="btn btn-sm btn-ghost" onClick={onLocateGodot}>
                  Locate Godot…
                </button>
              )}
              <button className="icon-btn" onClick={onDismissError} title="Dismiss">
                <XIcon size={12} />
              </button>
            </span>
          </div>
        )}
        {renderStage()}
      </div>

      {advancedMode && (
        <>
          <div className="console-resize" onMouseDown={onConsoleDrag} title="Drag to resize console" />
          <div className="game-console" style={{ height: consoleHeight }}>
            <div className="console-header">
              <span className="console-title">Output</span>
              <button className="btn btn-sm btn-ghost" onClick={() => setLogs([])}>
                Clear
              </button>
            </div>
            <div className="console-body" ref={consoleRef}>
              {logs.length === 0 ? (
                <span className="console-line muted">Game console output will appear here.</span>
              ) : (
                logs.map((line, i) => (
                  <span key={i} className="console-line">
                    {line}
                  </span>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </section>
  )
}
