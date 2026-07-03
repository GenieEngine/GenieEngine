import { app } from 'electron'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Registers OpenGenie's game-testing MCP server in the user's global OpenCode
 * config (~/.config/opencode/opencode.json) so the chat assistant gets the
 * run_game_test / game_input / game_screenshot / game_state tools in every
 * project. Runs at app startup and rewrites only the `mcp.opengenie` entry —
 * everything else in the config is preserved.
 *
 * The bridge is spawned with the app's own binary in Node mode
 * (ELECTRON_RUN_AS_NODE), so users don't need Node installed; it locates the
 * running app through harness.json (see test-harness.ts), so this config
 * stays valid across app restarts.
 */
export async function ensureOpencodeMcpConfig(): Promise<void> {
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

    const mcp = (config.mcp ?? {}) as Record<string, unknown>
    const desired = {
      type: 'local',
      command: [process.execPath, bridgePath],
      enabled: true,
      environment: { ELECTRON_RUN_AS_NODE: '1' }
    }
    if (JSON.stringify(mcp.opengenie) === JSON.stringify(desired)) return

    mcp.opengenie = desired
    config.mcp = mcp
    if (!config.$schema) config.$schema = 'https://opencode.ai/config.json'
    await writeFile(configPath, JSON.stringify(config, null, 2))
  } catch (err) {
    console.error('[opengenie] failed to update opencode MCP config:', err)
  }
}
