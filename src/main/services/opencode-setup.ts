import { existsSync } from 'node:fs'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { SetupStatus } from '../../shared/types'
import { isGptImageConfigured, saveGptImageConfig } from './gptimage'
import { isHy3dConfigured, saveHy3dCredentials } from './hy3d'
import { shutdownChat } from './opencode'

/**
 * First-run provider setup: the AI chat needs an API endpoint (any
 * OpenAI-compatible one), a model, and an API key before it can do anything.
 * This module reports whether that's configured and writes the configuration:
 *
 *  - the API key goes into OpenCode's credential store (auth.json), the same
 *    file `opencode auth login` writes;
 *  - the endpoint + model go into the global OpenCode config. OpenRouter is
 *    a provider OpenCode knows natively, so its endpoint maps to the built-in
 *    `openrouter` provider (keeping models.dev metadata like tool-call
 *    support); any other endpoint is written as a custom provider entry
 *    backed by the openai-compatible SDK with the endpoint as its baseURL.
 *
 * Defaults are OpenRouter + Kimi K2.7 Code, overridable by the user.
 */

export const DEFAULT_ENDPOINT = 'https://openrouter.ai/api/v1'
export const DEFAULT_MODEL = 'moonshotai/kimi-k2.7-code'

/** Provider id OpenCode's built-in OpenRouter support registers under. */
const OPENROUTER_PROVIDER = 'openrouter'
/** Provider id we register user-supplied OpenAI-compatible endpoints under. */
const CUSTOM_PROVIDER = 'custom'

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
  if (slash === -1) return { provider: OPENROUTER_PROVIDER, model: full }
  return { provider: full.slice(0, slash), model: full.slice(slash + 1) }
}

/** OpenCode's env-var convention for a provider's key, e.g. openrouter → OPENROUTER_API_KEY. */
function providerEnvVar(provider: string): string {
  return `${provider.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_API_KEY`
}

function isOpenRouterEndpoint(endpoint: string): boolean {
  try {
    return new URL(endpoint).hostname === 'openrouter.ai'
  } catch {
    return false
  }
}

/** A custom-provider entry in the OpenCode config's `provider` map. */
interface ProviderEntry extends Record<string, unknown> {
  options?: { baseURL?: string }
}

function providerEntries(config: Record<string, unknown>): Record<string, ProviderEntry> {
  return (config.provider ?? {}) as Record<string, ProviderEntry>
}

export async function getSetupStatus(): Promise<SetupStatus> {
  const config = await readJson(configPath())
  const modelField = typeof config.model === 'string' && config.model ? config.model : `${OPENROUTER_PROVIDER}/${DEFAULT_MODEL}`
  const { provider, model } = splitModel(modelField)

  // A custom provider carries its endpoint in the config; anything else
  // (built-in openrouter, or a provider name from an older version) is shown
  // as the default OpenRouter endpoint.
  const endpoint = providerEntries(config)[provider]?.options?.baseURL || DEFAULT_ENDPOINT

  // Configured if the provider has a stored credential OR its env var is set
  // (dev launches inject the key via env; packaged apps rely on auth.json).
  const auth = await readJson(authPath())
  const configured = provider in auth || !!process.env[providerEnvVar(provider)]

  return {
    configured,
    endpoint,
    model,
    hy3dConfigured: await isHy3dConfigured(),
    gptImageConfigured: await isGptImageConfigured()
  }
}

export async function saveSetup(
  endpoint: string,
  model: string,
  apiKey: string,
  tencentSecretId = '',
  tencentSecretKey = '',
  openaiApiKey = ''
): Promise<void> {
  // Optional asset-generation credentials: only touch a stored credential
  // when the user typed something (blank = unchanged, so re-saving the model
  // doesn't wipe an existing setup).
  if (tencentSecretId.trim() || tencentSecretKey.trim()) {
    await saveHy3dCredentials(tencentSecretId, tencentSecretKey)
  }
  await saveGptImageConfig(openaiApiKey)

  const cleanEndpoint = endpoint.trim() || DEFAULT_ENDPOINT
  const cleanModel = model.trim() || DEFAULT_MODEL
  const provider = isOpenRouterEndpoint(cleanEndpoint) ? OPENROUTER_PROVIDER : CUSTOM_PROVIDER

  // 1. Credential → auth.json (only when a key was provided; the user may just
  //    be changing the model with a key already stored).
  if (apiKey.trim()) {
    const path = authPath()
    await mkdir(join(path, '..'), { recursive: true })
    const auth = await readJson(path)
    auth[provider] = { type: 'api', key: apiKey.trim() }
    await writeFile(path, JSON.stringify(auth, null, 2))
    await chmod(path, 0o600) // credentials — owner-only
  }

  // 2. Endpoint + model → global OpenCode config (preserving mcp etc.).
  const configFile = configPath()
  await mkdir(join(configFile, '..'), { recursive: true })
  const config = await readJson(configFile)
  config.model = `${provider}/${cleanModel}`
  const providers = providerEntries(config)
  if (provider === CUSTOM_PROVIDER) {
    providers[CUSTOM_PROVIDER] = {
      npm: '@ai-sdk/openai-compatible',
      name: 'Custom endpoint',
      options: { baseURL: cleanEndpoint },
      // Custom providers aren't in models.dev, so the model must be declared.
      models: { [cleanModel]: { name: cleanModel } }
    }
  } else {
    // Built-in OpenRouter needs no provider entry; drop a stale custom one so
    // it can't shadow anything or confuse a later status read.
    delete providers[CUSTOM_PROVIDER]
  }
  if (Object.keys(providers).length) config.provider = providers
  else delete config.provider
  if (!config.$schema) config.$schema = 'https://opencode.ai/config.json'
  await writeFile(configFile, JSON.stringify(config, null, 2))

  // 3. Drop the stale chat server so the next message picks up the new config.
  shutdownChat()
}

/** Whether a provider currently has a stored credential (used by the pre-send guard). */
export function authFileExists(): boolean {
  return existsSync(authPath())
}
