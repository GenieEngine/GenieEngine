import { useEffect, useRef, useState } from 'react'
import type { AspectMode, GameState, ProjectInfo } from '../../../shared/types'
import {
  AspectAnyIcon,
  CheckIcon,
  ChevronIcon,
  HomeIcon,
  MonitorIcon,
  PhoneLandscapeIcon,
  PhonePortraitIcon,
  PlayIcon,
  ShareIcon,
  StopIcon
} from './Icons'

interface Props {
  project: ProjectInfo | null
  gameState: GameState
  aspect: AspectMode
  onSetAspect: (mode: AspectMode) => void
  onPlay: () => void
  onStop: () => void
  onHome: () => void
  onExport: () => void
}

const ASPECT_OPTIONS: { mode: AspectMode; label: string; icon: React.JSX.Element }[] = [
  { mode: 'any', label: 'Any Aspect Ratio', icon: <AspectAnyIcon size={14} /> },
  { mode: 'desktop', label: 'Desktop, TV, Standard 16:9', icon: <MonitorIcon size={14} /> },
  { mode: 'mobile-portrait', label: 'Mobile Vertical', icon: <PhonePortraitIcon size={14} /> },
  { mode: 'mobile-landscape', label: 'Mobile Horizontal', icon: <PhoneLandscapeIcon size={14} /> }
]

/** Run/Stop with an aspect-ratio picker on the caret — usable while running too. */
function RunControls({
  gameState,
  aspect,
  onSetAspect,
  onPlay,
  onStop
}: Pick<Props, 'gameState' | 'aspect' | 'onSetAspect' | 'onPlay' | 'onStop'>): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const { status } = gameState

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent): void => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])

  return (
    <div className="run-split" ref={menuRef}>
      {status === 'stopped' ? (
        <button className="btn btn-play run-main" onClick={onPlay}>
          <PlayIcon size={12} /> Run
        </button>
      ) : (
        <button className="btn btn-stop run-main" onClick={onStop}>
          <StopIcon size={12} /> {status === 'starting' ? 'Cancel' : 'Stop'}
        </button>
      )}
      <button
        className={status === 'stopped' ? 'btn btn-play run-caret' : 'btn btn-stop run-caret'}
        title="Game preview aspect ratio"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="caret-down">
          <ChevronIcon size={10} />
        </span>
      </button>
      {open && (
        <div className="run-menu">
          <div className="run-menu-title">Preview aspect ratio</div>
          {ASPECT_OPTIONS.map((option) => (
            <button
              key={option.mode}
              className={option.mode === aspect ? 'run-menu-item selected' : 'run-menu-item'}
              onClick={() => {
                onSetAspect(option.mode)
                setOpen(false)
              }}
            >
              <span className="run-menu-icon">{option.icon}</span>
              <span className="run-menu-label">{option.label}</span>
              {option.mode === aspect && (
                <span className="run-menu-check">
                  <CheckIcon size={12} />
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function TitleBar({ project, gameState, aspect, onSetAspect, onPlay, onStop, onHome, onExport }: Props): React.JSX.Element {
  const { status } = gameState
  return (
    <header className="titlebar">
      <div className="titlebar-left">
        {project && (
          <button className="icon-btn" title="Back to projects" onClick={onHome}>
            <HomeIcon />
          </button>
        )}
        <span className="brand">
          <span className="brand-mark">◆</span> OpenGenie
        </span>
        {project && (
          <>
            <span className="titlebar-sep">/</span>
            <span className="titlebar-project">{project.name}</span>
          </>
        )}
      </div>

      <div className="titlebar-center">
        {project && (
          <RunControls gameState={gameState} aspect={aspect} onSetAspect={onSetAspect} onPlay={onPlay} onStop={onStop} />
        )}
      </div>

      <div className="titlebar-right">
        {project && status !== 'stopped' && (
          <span className="status-pill">
            <span className={status === 'running' ? 'status-dot running' : 'status-dot starting'} />
            {status !== 'running' ? 'Starting…' : gameState.mode === 'test' ? 'AI testing' : 'Running'}
          </span>
        )}
        {project && (
          <button className="btn btn-ghost btn-sm" title="Export your game" onClick={onExport}>
            <ShareIcon size={13} /> Export
          </button>
        )}
      </div>
    </header>
  )
}
