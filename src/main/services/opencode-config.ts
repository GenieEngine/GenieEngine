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
 *    config stays valid across app restarts. This file entry serves OpenCode
 *    sessions launched outside the app (e.g. a terminal); servers the app
 *    spawns get a per-spawn override pointing at their own instance instead
 *    (see opengenieMcpEntry).
 *  - `agent.image-reader` / `agent.game-tester` — the image-enabled subagents
 *    (see opencode-setup.ts). Re-applied here so users who never reopen the
 *    settings panel (upgrades) still get them, and so prompt/tool refinements
 *    ship with app updates. The models the user picked are preserved.
 *
 * Everything else in the config is the user's and is left untouched.
 */
/**
 * This instance's `mcp.opengenie` entry, pointing at its own binary and
 * bridge script by absolute path (null when the bridge script is missing —
 * broken install). Used twice:
 *
 *  - written into the global config below, as the fallback for OpenCode
 *    sessions not launched by the app;
 *  - passed per spawn via OPENCODE_CONFIG_CONTENT (see ensureServer in
 *    opencode.ts). The global file names exactly ONE instance's paths
 *    (last-started wins), so with several installs around (dev checkout +
 *    mounted DMG builds) it points every other instance at a binary that
 *    instance's sandbox can't read — which silently killed the bridge and
 *    all game tools. The override keeps each server on its own bridge.
 */
export function opengenieMcpEntry(): Record<string, unknown> | null {
  const bridgePath = app.isPackaged
    ? join(process.resourcesPath, 'app.asar.unpacked', 'resources', 'mcp-bridge.mjs')
    : join(app.getAppPath(), 'resources', 'mcp-bridge.mjs')
  if (!existsSync(bridgePath)) return null
  return {
    type: 'local',
    command: [process.execPath, bridgePath],
    enabled: true,
    environment: { ELECTRON_RUN_AS_NODE: '1' }
  }
}

export async function ensureOpencodeConfig(): Promise<void> {
  try {
    const entry = opengenieMcpEntry()
    if (!entry) return

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
    mcp.opengenie = entry
    config.mcp = mcp

    // Without this flag OpenCode halts the whole agent run when a permission
    // ask is rejected (the model only sees the denial after the user manually
    // prompts again). With it, a denial comes back as a normal tool error the
    // agent can read and route around mid-run — OpenGenie answers every ask
    // automatically (see replyToPermission in opencode.ts), so a halt would
    // otherwise strand the chat on every rejected out-of-project access.
    const experimental = (config.experimental ?? {}) as Record<string, unknown>
    experimental.continue_loop_on_deny = true
    config.experimental = experimental

    applyAgentConfig(config, configuredImageModel(config))

    if (!config.$schema) config.$schema = 'https://opencode.ai/config.json'
    if (JSON.stringify(config) === before) return
    await writeFile(configPath, JSON.stringify(config, null, 2))
  } catch (err) {
    console.error('[opengenie] failed to update opencode config:', err)
  }
}
