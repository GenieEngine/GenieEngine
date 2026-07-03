/**
 * Types shared between the Electron main process, the preload bridge and the
 * renderer. This file is the single source of truth for the IPC surface.
 */

/** Uniform envelope returned by every IPC call so the renderer can render errors inline. */
export type Result<T> = { ok: true; data: T } | { ok: false; error: string }

export interface ProjectInfo {
  path: string
  name: string
}

export interface InitialState {
  project: ProjectInfo | null
  recentProjects: ProjectInfo[]
  /** Resolved path of the Godot binary, or null when it could not be found. */
  godotPath: string | null
  /** Resolved path of the OpenCode CLI, or null when it could not be found. */
  opencodePath: string | null
}

export interface FileEntry {
  name: string
  path: string
  isDirectory: boolean
}

export interface GitRemote {
  name: string
  url: string
}

export interface GitChange {
  path: string
  /** Single-letter status code shown in the UI (M, A, D, R, ?, …). */
  status: string
  staged: boolean
  untracked: boolean
}

export interface GitStatus {
  isRepo: boolean
  branch: string
  upstream: string | null
  ahead: number
  behind: number
  staged: GitChange[]
  unstaged: GitChange[]
  remotes: GitRemote[]
}

export interface GitCommit {
  hash: string
  subject: string
}

export interface ChatDonePayload {
  ok: boolean
  cancelled?: boolean
  error?: string
}

/**
 * A file the user attached to a chat message. Sent to the model as a message
 * part (data URL) — never written into the game project.
 */
export interface ChatAttachment {
  name: string
  mime: string
  dataUrl: string
}

/** State of the AI provider setup (API key / provider / model). */
export interface SetupStatus {
  /** True once the configured provider has a usable credential. */
  configured: boolean
  provider: string
  model: string
}

/** Live status of a tool invocation the AI is running. */
export type ChatToolStatus = 'pending' | 'running' | 'completed' | 'error'

/**
 * Incremental update for one part of a streaming assistant message.
 * Text/reasoning parts carry the full accumulated text (idempotent upsert);
 * tool parts carry their latest state.
 */
export interface ChatPartUpdate {
  messageID: string
  partID: string
  kind: 'text' | 'reasoning' | 'tool'
  text?: string
  tool?: {
    name: string
    status: ChatToolStatus
    title?: string
  }
}

/** How the game is currently being presented. */
export interface GameState {
  status: 'stopped' | 'starting' | 'running'
  /** 'native' = embedded in the game view; 'test' = AI running it off-screen. */
  mode?: 'native' | 'test'
}

/** Viewport-relative rect of the game stage area, reported by the renderer. */
export interface StageRect {
  x: number
  y: number
  width: number
  height: number
}

/** Aspect-ratio presets for the game preview area (UI-side letterboxing). */
export type AspectMode = 'any' | 'desktop' | 'mobile-portrait' | 'mobile-landscape'

/** Platforms Godot can export a project to. */
export type ExportPlatform = 'windows' | 'macos' | 'linux' | 'web' | 'android' | 'ios'

/** Progress updates streamed while an export runs. */
export type ExportProgress =
  | { phase: 'templates'; message: string; percent: number }
  | { phase: 'platform'; platform: ExportPlatform; status: 'exporting' | 'success' | 'error'; message?: string }
  | { phase: 'done'; message?: string }

/** Modifier keys held during an input event. */
export interface GameInputModifiers {
  shift: boolean
  ctrl: boolean
  alt: boolean
  meta: boolean
}

/**
 * Input captured by the renderer over the embedded native game view,
 * forwarded to the game process. Coordinates are CSS px relative to the view.
 */
export type GameInputEvent =
  | (GameInputModifiers & {
      type: 'key'
      key: string
      code: string
      pressed: boolean
      echo: boolean
      location: number
    })
  | (GameInputModifiers & {
      type: 'mousebutton'
      button: number // DOM button index
      buttons: number // DOM buttons bitmask
      pressed: boolean
      doubleClick: boolean
      x: number
      y: number
    })
  | (GameInputModifiers & {
      type: 'mousemotion'
      x: number
      y: number
      relX: number
      relY: number
      buttons: number
    })
  | (GameInputModifiers & { type: 'wheel'; x: number; y: number; deltaX: number; deltaY: number })
  | { type: 'enter' }
  | { type: 'leave' }
  | { type: 'focus' }
  | { type: 'blur' }

/** The API the preload script exposes on `window.api`. */
export interface OpenGenieApi {
  platform: string

  // App / project lifecycle
  getInitialState(): Promise<Result<InitialState>>
  chooseDirectory(): Promise<Result<string | null>>
  createProject(parentDir: string, name: string): Promise<Result<ProjectInfo>>
  openProject(path: string): Promise<Result<ProjectInfo>>
  openProjectDialog(): Promise<Result<ProjectInfo | null>>
  closeProject(): Promise<Result<null>>

  // Game (Godot)
  playGame(): Promise<Result<null>>
  stopGame(): Promise<Result<null>>
  locateGodot(): Promise<Result<string | null>>
  /** Fire-and-forget: keeps the main process aware of where the stage is. */
  setGameStageBounds(rect: StageRect): void
  /** Fire-and-forget: input captured over the embedded native game view. */
  sendGameInput(event: GameInputEvent): void
  onGameLog(cb: (line: string) => void): () => void
  onGameState(cb: (state: GameState) => void): () => void
  /** Godot CursorShape the game requested over its view (native mode). */
  onGameCursor(cb: (shape: number) => void): () => void
  /** PNG data URL each time the AI captures a screenshot during a test run. */
  onGameTestShot(cb: (dataUrl: string) => void): () => void

  // AI chat (OpenCode)
  chatSend(message: string, attachments?: ChatAttachment[]): Promise<Result<null>>
  chatCancel(): Promise<Result<null>>
  chatNewSession(): Promise<Result<null>>
  getSetupStatus(): Promise<Result<SetupStatus>>
  saveSetup(provider: string, model: string, apiKey: string): Promise<Result<SetupStatus>>
  onChatPart(cb: (part: ChatPartUpdate) => void): () => void
  onChatDone(cb: (payload: ChatDonePayload) => void): () => void
  /** Fired (debounced) when the AI edits project files during a response. */
  onChatFilesChanged(cb: () => void): () => void

  // Export
  exportGame(name: string, platforms: ExportPlatform[]): Promise<Result<null>>
  cancelExport(): Promise<Result<null>>
  revealExport(path: string): Promise<Result<null>>
  onExportProgress(cb: (update: ExportProgress) => void): () => void

  // Files
  listDir(path: string): Promise<Result<FileEntry[]>>
  openInVSCode(target?: string): Promise<Result<null>>
  openInGodotEditor(): Promise<Result<null>>

  // Git
  gitStatus(): Promise<Result<GitStatus>>
  gitInit(): Promise<Result<null>>
  gitStage(paths: string[]): Promise<Result<null>>
  gitUnstage(paths: string[]): Promise<Result<null>>
  gitDiscard(change: GitChange): Promise<Result<null>>
  gitCommit(message: string): Promise<Result<string>>
  gitPush(): Promise<Result<string>>
  gitPull(): Promise<Result<string>>
  gitAddRemote(url: string): Promise<Result<null>>
  gitLog(): Promise<Result<GitCommit[]>>
}
