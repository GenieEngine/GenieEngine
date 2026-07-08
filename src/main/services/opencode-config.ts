import { app } from 'electron'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { applyAgentConfig, configuredImageModel } from './opencode-setup'

/**
 * Keeps OpenGenie's entries in the user's global OpenCode config
 * (~/.config/opencode/opencode.json) up to date at app startup:
 *
 *  - `mcp.opengenie` — the game-testing MCP bridge, giving the assistant the
 *    run_game_test / game_input / game_screenshot / game_state tools in every
 *    project. The bridge is spawned with the app's own binary in Node mode
 *    (ELECTRON_RUN_AS_NODE), so users don't need Node installed; it locates
 *    the running app through harness.json (see test-harness.ts), so this
 *    config stays valid across app restarts.
 *  - `agent.image-reader` / `agent.game-tester` — the image-enabled subagents
 *    (see opencode-setup.ts). Re-applied here so users who never reopen the
 *    settings panel (upgrades) still get them, and so prompt/tool refinements
 *    ship with app updates. The models the user picked are preserved.
 *
 * Everything else in the config is the user's and is left untouched.
 */
export async function ensureOpencodeConfig(): Promise<void> {
  try {
    const bridgePath = app.isPackaged
      ? join(process.resourcesPath, 'app.asar.unpacked', 'resources', 'mcp-bridge.mjs')
      : join(app.getAppPath(), 'resources', 'mcp-bridge.mjs')
    if (!existsSync(bridgePath)) return

    const configDir = join(homedir(), '.config', 'opencode')
    const configPath = join(configDir, 'opencode.json')
    await mkdir(configDir, { recursive: true })

    let config: Record<string, unknown> = {}
    try {
      config = JSON.parse(await readFile(configPath, 'utf8')) as Record<string, unknown>
    } catch {
      // Missing or invalid — start fresh (invalid JSON would break opencode anyway).
    }
    const before = JSON.stringify(config)

    const mcp = (config.mcp ?? {}) as Record<string, unknown>
    mcp.opengenie = {
      type: 'local',
      command: [process.execPath, bridgePath],
      enabled: true,
      environment: { ELECTRON_RUN_AS_NODE: '1' }
    }
    config.mcp = mcp

    applyAgentConfig(config, configuredImageModel(config))

    if (!config.$schema) config.$schema = 'https://opencode.ai/config.json'
    if (JSON.stringify(config) === before) return
    await writeFile(configPath, JSON.stringify(config, null, 2))
  } catch (err) {
    console.error('[opengenie] failed to update opencode config:', err)
  }
}
