import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { ProjectInfo } from '../shared/types'

/**
 * The two chat models as full `provider/model` refs. Stored here rather than
 * in opencode.json because OpenCode's config has exactly one `model` field —
 * the app instead names the chosen model explicitly on every message it
 * sends. `config.model` is still kept in sync with `medium` so OpenCode
 * sessions started outside the app behave like the app's default.
 */
export interface ChatModelRefs {
  medium?: string
  large?: string
}

interface SettingsFile {
  godotPath?: string
  opencodePath?: string
  recentProjects: string[]
  /** Whether the ECS viewer, files/git sidebars and console output are shown. */
  advancedMode?: boolean
  chatModels?: ChatModelRefs
}

let settings: SettingsFile = { recentProjects: [] }
let currentProject: ProjectInfo | null = null

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export function loadSettings(): void {
  try {
    const raw = JSON.parse(readFileSync(settingsPath(), 'utf8')) as Partial<SettingsFile>
    settings = { recentProjects: [], ...raw }
  } catch {
    // First launch (or corrupt file) — start with defaults.
    settings = { recentProjects: [] }
  }
}

export function saveSettings(): void {
  const file = settingsPath()
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(settings, null, 2))
}

export function getSettings(): SettingsFile {
  return settings
}

export function setGodotPath(path: string): void {
  settings.godotPath = path
  saveSettings()
}

export function getChatModelRefs(): ChatModelRefs {
  return settings.chatModels ?? {}
}

export function setChatModelRefs(refs: ChatModelRefs): void {
  settings.chatModels = refs
  saveSettings()
}

export function getAdvancedMode(): boolean {
  return settings.advancedMode ?? false
}

export function setAdvancedMode(value: boolean): void {
  settings.advancedMode = value
  saveSettings()
}

export function addRecentProject(path: string): void {
  settings.recentProjects = [path, ...settings.recentProjects.filter((p) => p !== path)].slice(0, 8)
  saveSettings()
}

export function getRecentProjectPaths(): string[] {
  // Drop projects whose folder no longer exists so the welcome screen stays clean.
  return settings.recentProjects.filter((p) => existsSync(p))
}

export function setCurrentProject(project: ProjectInfo | null): void {
  currentProject = project
}

export function getCurrentProject(): ProjectInfo | null {
  return currentProject
}

export function requireProject(): ProjectInfo {
  if (!currentProject) throw new Error('No project is open')
  return currentProject
}
