import { dialog, ipcMain } from 'electron'
import type { ChatAttachment, GameInputEvent, GitChange, InitialState, ProjectInfo, Result, StageRect } from '../shared/types'
import { normalizeGodotPath, resolveGodot, resolveOpencode } from './services/binaries'
import * as files from './services/files'
import { handleGameInput, openGodotEditor, playGame, setStageRect, stopGame } from './services/game'
import * as git from './services/git'
import { cancelChat, newChatSession, sendChatMessage, shutdownChat } from './services/opencode'
import { getSetupStatus, saveSetup } from './services/opencode-setup'
import { cancelExport, revealExport, runExport } from './services/export'
import type { ExportPlatform } from '../shared/types'
import { createProject, openProject, projectInfoFor } from './services/projects'
import {
  addRecentProject,
  getCurrentProject,
  getRecentProjectPaths,
  requireProject,
  setCurrentProject,
  setGodotPath
} from './state'

/**
 * Every handler is wrapped in a Result envelope so expected failures (godot
 * missing, git errors, invalid folders…) flow to the UI as messages instead
 * of opaque "Error invoking remote method" exceptions.
 */
function handle(channel: string, fn: (...args: never[]) => unknown): void {
  ipcMain.handle(channel, async (_event, ...args): Promise<Result<unknown>> => {
    try {
      return { ok: true, data: (await fn(...(args as never[]))) ?? null }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}

/** Opening/closing a project tears down anything bound to the previous one. */
function activateProject(project: ProjectInfo | null): void {
  stopGame()
  shutdownChat()
  setCurrentProject(project)
  if (project) addRecentProject(project.path)
}

export function registerIpcHandlers(): void {
  // ---- App / project lifecycle -------------------------------------------
  handle('app:getInitialState', async (): Promise<InitialState> => {
    const recents = await Promise.all(getRecentProjectPaths().map(projectInfoFor))
    return {
      project: getCurrentProject(),
      recentProjects: recents,
      godotPath: await resolveGodot(),
      opencodePath: await resolveOpencode()
    }
  })

  handle('dialog:chooseDirectory', async (): Promise<string | null> => {
    const result = await dialog.showOpenDialog({
      title: 'Choose a folder',
      properties: ['openDirectory', 'createDirectory']
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  handle('project:create', async (parentDir: string, name: string): Promise<ProjectInfo> => {
    const project = await createProject(parentDir, name)
    activateProject(project)
    return project
  })

  handle('project:open', async (path: string): Promise<ProjectInfo> => {
    const project = await openProject(path)
    activateProject(project)
    return project
  })

  handle('project:openDialog', async (): Promise<ProjectInfo | null> => {
    const result = await dialog.showOpenDialog({
      title: 'Open a Godot project',
      properties: ['openDirectory']
    })
    if (result.canceled || !result.filePaths[0]) return null
    const project = await openProject(result.filePaths[0])
    activateProject(project)
    return project
  })

  handle('project:close', () => activateProject(null))

  // ---- Game ----------------------------------------------------------------
  handle('game:play', () => playGame(requireProject().path))
  handle('game:stop', () => stopGame())
  // High-frequency fire-and-forget channels — plain listeners, no Result envelope.
  ipcMain.on('game:stageBounds', (_event, rect: StageRect) => setStageRect(rect))
  ipcMain.on('game:input', (_event, input: GameInputEvent) => handleGameInput(input))
  handle('game:locateGodot', async (): Promise<string | null> => {
    const result = await dialog.showOpenDialog({
      title: 'Locate the Godot application or binary',
      defaultPath: '/Applications',
      properties: ['openFile']
    })
    if (result.canceled || !result.filePaths[0]) return null
    const path = normalizeGodotPath(result.filePaths[0])
    setGodotPath(path)
    const resolved = await resolveGodot()
    if (!resolved) throw new Error(`The selected file is not an executable Godot binary: ${path}`)
    return resolved
  })

  // ---- AI chat ---------------------------------------------------------------
  handle('chat:send', (message: string, attachments?: ChatAttachment[]) =>
    sendChatMessage(message, requireProject().path, attachments ?? [])
  )
  handle('chat:cancel', () => cancelChat())
  handle('chat:new', () => newChatSession())
  handle('chat:setupStatus', () => getSetupStatus())
  handle('chat:saveSetup', async (provider: string, model: string, apiKey: string) => {
    await saveSetup(provider, model, apiKey)
    return getSetupStatus()
  })

  // ---- Export ----------------------------------------------------------------
  handle('export:run', (name: string, platforms: ExportPlatform[]) =>
    runExport(requireProject().path, name, platforms)
  )
  handle('export:cancel', () => cancelExport())
  handle('export:reveal', (path: string) => revealExport(path))

  // ---- Files -----------------------------------------------------------------
  handle('files:list', (dir: string) => files.listDir(dir))
  handle('files:openVSCode', (target?: string) => files.openInVSCode(target ?? requireProject().path))
  handle('files:openGodotEditor', () => openGodotEditor(requireProject().path))

  // ---- Git ---------------------------------------------------------------------
  handle('git:status', () => git.status(requireProject().path))
  handle('git:init', () => git.init(requireProject().path))
  handle('git:stage', (paths: string[]) => git.stage(requireProject().path, paths))
  handle('git:unstage', (paths: string[]) => git.unstage(requireProject().path, paths))
  handle('git:discard', (change: GitChange) => git.discard(requireProject().path, change))
  handle('git:commit', (message: string) => git.commit(requireProject().path, message))
  handle('git:push', () => git.push(requireProject().path))
  handle('git:pull', () => git.pull(requireProject().path))
  handle('git:addRemote', (url: string) => git.addRemote(requireProject().path, url))
  handle('git:log', () => git.log(requireProject().path))
}
