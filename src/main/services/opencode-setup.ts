import { existsSync } from 'node:fs'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { SetupStatus } from '../../shared/types'
import { shutdownChat } from './opencode'

/**
 * First-run provider setup: the AI chat needs a provider (e.g. openrouter), a
 * model, and an API key before it can do anything. This module reports whether
 * that's configured and writes the configuration:
 *
 *  - the API key goes into OpenCode's credential store (auth.json), the same
 *    file `opencode auth login` writes;
 *  - the provider + model go into the global OpenCode config as `provider/model`.
 *
 * Defaults are OpenRouter + Kimi K2.7 Code, overridable by the user.
 */

export const DEFAULT_PROVIDER = 'openrouter'
export const DEFAULT_MODEL = 'moonshotai/kimi-k2.7-code'

function configPath(): string {
  return join(homedir(), '.config', 'opencode', 'opencode.json')
}

function authPath(): string {
  const dataHome = process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share')
  return join(dataHome, 'opencode', 'auth.json')
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
  } catch {
    return {}
  }
}

/** Split a stored `provider/model` string into its parts (model may contain '/'). */
function splitModel(full: string): { provider: string; model: string } {
  const slash = full.indexOf('/')
  if (slash === -1) return { provider: DEFAULT_PROVIDER, model: full }
  return { provider: full.slice(0, slash), model: full.slice(slash + 1) }
}

/** OpenCode's env-var convention for a provider's key, e.g. openrouter → OPENROUTER_API_KEY. */
function providerEnvVar(provider: string): string {
  return `${provider.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_API_KEY`
}

export async function getSetupStatus(): Promise<SetupStatus> {
  const config = await readJson(configPath())
  const modelField = typeof config.model === 'string' && config.model ? config.model : `${DEFAULT_PROVIDER}/${DEFAULT_MODEL}`
  const { provider, model } = splitModel(modelField)

  // Configured if the provider has a stored credential OR its env var is set
  // (dev launches inject the key via env; packaged apps rely on auth.json).
  const auth = await readJson(authPath())
  const configured = provider in auth || !!process.env[providerEnvVar(provider)]

  return { configured, provider, model }
}

export async function saveSetup(provider: string, model: string, apiKey: string): Promise<void> {
  const cleanProvider = provider.trim() || DEFAULT_PROVIDER
  const cleanModel = model.trim() || DEFAULT_MODEL

  // 1. Credential → auth.json (only when a key was provided; the user may just
  //    be changing the model with a key already stored).
  if (apiKey.trim()) {
    const path = authPath()
    await mkdir(join(path, '..'), { recursive: true })
    const auth = await readJson(path)
    auth[cleanProvider] = { type: 'api', key: apiKey.trim() }
    await writeFile(path, JSON.stringify(auth, null, 2))
    await chmod(path, 0o600) // credentials — owner-only
  }

  // 2. Provider + model → global OpenCode config (preserving mcp etc.).
  const configFile = configPath()
  await mkdir(join(configFile, '..'), { recursive: true })
  const config = await readJson(configFile)
  config.model = `${cleanProvider}/${cleanModel}`
  if (!config.$schema) config.$schema = 'https://opencode.ai/config.json'
  await writeFile(configFile, JSON.stringify(config, null, 2))

  // 3. Drop the stale chat server so the next message picks up the new config.
  shutdownChat()
}

/** Whether a provider currently has a stored credential (used by the pre-send guard). */
export function authFileExists(): boolean {
  return existsSync(authPath())
}
