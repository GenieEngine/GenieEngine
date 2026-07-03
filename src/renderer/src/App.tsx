import { useCallback, useEffect, useRef, useState } from 'react'
import type { AspectMode, GameState, InitialState, ProjectInfo } from '../../shared/types'
import { ExportModal } from './components/ExportModal'
import { GameView } from './components/GameView'
import { TitleBar } from './components/TitleBar'
import { Welcome } from './components/Welcome'
import { Workspace } from './components/Workspace'

const SIDEBAR_WIDTH_KEY = 'opengenie:sidebarWidth'
const ASPECT_KEY = 'opengenie:aspect'
const ASPECT_MODES: AspectMode[] = ['any', 'desktop', 'mobile-portrait', 'mobile-landscape']
// "3 inch" workspace sidebar ≈ 288px at 96dpi; default slightly wider.
const SIDEBAR_DEFAULT = 300
const SIDEBAR_MIN = 260
const SIDEBAR_MAX = 560

export function App(): React.JSX.Element {
  const [booted, setBooted] = useState(false)
  const [project, setProject] = useState<ProjectInfo | null>(null)
  const [recents, setRecents] = useState<ProjectInfo[]>([])
  const [godotPath, setGodotPath] = useState<string | null>(null)
  const [opencodePath, setOpencodePath] = useState<string | null>(null)

  const [gameState, setGameState] = useState<GameState>({ status: 'stopped' })
  const [gameError, setGameError] = useState<string | null>(null)
  const [aspect, setAspectState] = useState<AspectMode>(() => {
    const saved = localStorage.getItem(ASPECT_KEY) as AspectMode | null
    return saved && ASPECT_MODES.includes(saved) ? saved : 'any'
  })

  const setAspect = useCallback((mode: AspectMode) => {
    localStorage.setItem(ASPECT_KEY, mode)
    setAspectState(mode)
  }, [])

  const [exportOpen, setExportOpen] = useState(false)

  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY))
    return saved >= SIDEBAR_MIN && saved <= SIDEBAR_MAX ? saved : SIDEBAR_DEFAULT
  })

  useEffect(() => {
    window.api.getInitialState().then((result) => {
      if (result.ok) {
        const state: InitialState = result.data
        setProject(state.project)
        setRecents(state.recentProjects)
        setGodotPath(state.godotPath)
        setOpencodePath(state.opencodePath)
      }
      setBooted(true)
    })
  }, [])

  useEffect(() => window.api.onGameState(setGameState), [])

  const handleProjectOpened = useCallback((opened: ProjectInfo) => {
    setProject(opened)
    setGameError(null)
    setGameState({ status: 'stopped' })
  }, [])

  const goHome = useCallback(async () => {
    await window.api.closeProject()
    const result = await window.api.getInitialState()
    if (result.ok) setRecents(result.data.recentProjects)
    setProject(null)
    setGameState({ status: 'stopped' })
    setGameError(null)
  }, [])

  const play = useCallback(async () => {
    setGameError(null)
    const result = await window.api.playGame()
    if (!result.ok) setGameError(result.error)
  }, [])

  const stop = useCallback(() => {
    void window.api.stopGame()
  }, [])

  const locateGodot = useCallback(async () => {
    const result = await window.api.locateGodot()
    if (result.ok && result.data) {
      setGodotPath(result.data)
      setGameError(null)
    } else if (!result.ok) {
      setGameError(result.error)
    }
  }, [])

  // Sidebar drag-resize: track the pointer on the whole window while dragging.
  const dragging = useRef(false)
  const onDividerMouseDown = useCallback(() => {
    dragging.current = true
    document.body.classList.add('resizing')
    const onMove = (e: MouseEvent): void => {
      if (!dragging.current) return
      const width = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, window.innerWidth - e.clientX))
      setSidebarWidth(width)
    }
    const onUp = (): void => {
      dragging.current = false
      document.body.classList.remove('resizing')
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      setSidebarWidth((w) => {
        localStorage.setItem(SIDEBAR_WIDTH_KEY, String(w))
        return w
      })
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])

  const platformClass = window.api.platform === 'darwin' ? 'app mac' : 'app'

  if (!booted) return <div className={platformClass} />

  return (
    <div className={platformClass}>
      <TitleBar
        project={project}
        gameState={gameState}
        aspect={aspect}
        onSetAspect={setAspect}
        onPlay={play}
        onStop={stop}
        onHome={goHome}
        onExport={() => setExportOpen(true)}
      />
      {exportOpen && project && <ExportModal projectName={project.name} onClose={() => setExportOpen(false)} />}
      {project ? (
        <div className="content-row">
          <GameView
            state={gameState}
            error={gameError}
            godotPath={godotPath}
            aspect={aspect}
            onPlay={play}
            onStop={stop}
            onLocateGodot={locateGodot}
            onDismissError={() => setGameError(null)}
          />
          <div className="divider" onMouseDown={onDividerMouseDown} />
          <Workspace
            key={project.path}
            project={project}
            width={sidebarWidth}
            opencodeAvailable={opencodePath !== null}
          />
        </div>
      ) : (
        <Welcome recents={recents} onProjectOpened={handleProjectOpened} />
      )}
    </div>
  )
}
