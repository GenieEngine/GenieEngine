import { existsSync } from 'node:fs'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { SetupRequest, SetupStatus } from '../../shared/types'
import { isGptImageConfigured, saveGptImageConfig } from './gptimage'
import { isHy3dConfigured, saveHy3dCredentials } from './hy3d'
import { shutdownChat } from './opencode'

/**
 * Provider setup for the AI chat, which runs as a small agent team:
 *
 *  - the MAIN coding agent (OpenCode's default `build` agent) plans and edits
 *    the game. Its model is the global `model` in the OpenCode config and
 *    needs no image support.
 *  - two SUBAGENTS declared under `agent` in the same config, both running a
 *    separately configurable IMAGE-ENABLED model:
 *      · image-reader — describes image files (user-uploaded references,
 *        generated art) to the main agent, which may not see images itself;
 *      · game-tester  — plays the game via the opengenie MCP tools and
 *        verifies the screenshots it takes.
 *
 * Each of the two models has its own endpoint + API key. The key goes into
 * OpenCode's credential store (auth.json, same file `opencode auth login`
 * writes); endpoint + model go into the global OpenCode config. OpenRouter
 * endpoints map to OpenCode's built-in `openrouter` provider (keeping
 * models.dev metadata like image/tool-call support); other endpoints are
 * written as openai-compatible provider entries — `custom` for the main
 * model, `image` for the image model — each with its own credential slot.
 * When both models point at the same endpoint they share one provider and
 * one key.
 */

export const DEFAULT_ENDPOINT = 'https://openrouter.ai/api/v1'
export const DEFAULT_MODEL = 'z-ai/glm-5.2'
export const DEFAULT_IMAGE_MODEL = 'moonshotai/kimi-k2.7-code'

/** Provider id OpenCode's built-in OpenRouter support registers under. */
const OPENROUTER_PROVIDER = 'openrouter'
/** Provider id for a user-supplied OpenAI-compatible main-model endpoint. */
const CUSTOM_PROVIDER = 'custom'
/** Provider id for the image model when it uses its own non-OpenRouter endpoint. */
const IMAGE_PROVIDER = 'image'

const IMAGE_READER_AGENT = 'image-reader'
const GAME_TESTER_AGENT = 'game-tester'

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

function agentEntries(config: Record<string, unknown>): Record<string, Record<string, unknown>> {
  return (config.agent ?? {}) as Record<string, Record<string, unknown>>
}

/** The `provider/model` currently assigned to the subagents (default when unset). */
export function configuredImageModel(config: Record<string, unknown>): string {
  const current = agentEntries(config)[IMAGE_READER_AGENT]?.model
  return typeof current === 'string' && current
    ? current
    : `${OPENROUTER_PROVIDER}/${DEFAULT_IMAGE_MODEL}`
}

/**
 * (Re)writes OpenGenie's agent team into an OpenCode config object: the two
 * image-enabled subagents the main coding agent delegates to. Called on every
 * setup save AND at app startup (so app updates refresh prompts/tools without
 * the user re-running setup — see ensureOpencodeConfig). Agents under other
 * names are the user's own and are left alone.
 *
 * Both subagents get the image model: their whole value over the main agent
 * is that they can actually see — the read tool returns image files as
 * attachments, and game_screenshot returns the rendered frame.
 */
export function applyAgentConfig(config: Record<string, unknown>, imageModelRef: string): void {
  const agents = agentEntries(config)

  agents[IMAGE_READER_AGENT] = {
    description:
      'Views image files and reports their contents in detail: user-attached references ' +
      '(saved under .opengenie/attachments/), game screenshots (saved under ' +
      '.opengenie/test-shots/), generated art, or any image in the project. ' +
      'Give it the image path(s) and the questions you need answered.',
    mode: 'subagent',
    model: imageModelRef,
    prompt:
      'You are the image-analysis specialist inside OpenGenie, an AI game engine. Another ' +
      'agent that may not be able to see images delegates image questions to you. Open every ' +
      'image path you were given with the read tool, look carefully, and answer with a ' +
      'precise, complete description — the caller cannot see the image, so your words are ' +
      'all it gets.\n\n' +
      'Always cover, when relevant:\n' +
      '- Subject and composition: what is depicted, layout, camera/perspective (top-down, ' +
      'side view, isometric, ...).\n' +
      '- Art style: pixel art / vector / hand-drawn / 3D render, outline weight, shading, ' +
      'level of detail.\n' +
      '- Colors: the dominant palette with approximate hex values; whether the background ' +
      'is transparent.\n' +
      '- For game screenshots: apparent genre, HUD elements and their positions, visible ' +
      'mechanics, menus, and all text transcribed exactly.\n' +
      "- The caller's specific questions, answered directly.\n\n" +
      'If a path does not exist or is not an image, say so plainly. You only look and ' +
      'report — never modify anything.',
    // Look-and-report only: no editing, no shell, no game control, and no
    // question tool (subagent questions have no UI and would hang the turn).
    tools: {
      write: false,
      edit: false,
      patch: false,
      bash: false,
      task: false,
      question: false,
      todowrite: false,
      todoread: false,
      webfetch: false,
      websearch: false,
      'opengenie*': false
    }
  }

  agents[GAME_TESTER_AGENT] = {
    description:
      'Plays and verifies the current game end-to-end: launches it off-screen, sends ' +
      'scripted input, inspects scene tree / state / logs, and checks screenshots it can ' +
      'actually see. Use it after gameplay or visual changes instead of testing yourself; ' +
      'tell it what changed and what to verify, and it reports what works and what is broken.',
    mode: 'subagent',
    model: imageModelRef,
    prompt:
      'You are the game-testing specialist inside OpenGenie, an AI game engine for Godot 4 ' +
      'games. You verify that the current project actually works by playing it with the ' +
      'opengenie MCP tools, then report your findings. You never edit files — you test and ' +
      'report so the coding agent can fix.\n\n' +
      'Test procedure:\n' +
      '1. run_game_test — start the game off-screen (full engine, real rendering).\n' +
      '2. game_logs — check for script errors right away; a broken launch is the most ' +
      'important finding of all.\n' +
      '3. game_scene_tree — discover node paths; game_state evaluates a GDScript expression ' +
      '(e.g. get_node("/root/Main/Score").text) to assert state cheaply.\n' +
      '4. game_input — drive the game with scripted keys/mouse (DOM-style key names like ' +
      '"ArrowLeft", "Space", "Enter"; mouse coordinates in game-view points from the ' +
      'top-left).\n' +
      '5. game_screenshot — capture and LOOK at the rendered frame: verify sprites and art ' +
      'actually display (no missing textures), the layout and HUD are right, and the visuals ' +
      'match what was asked. You can see images — use screenshots as real evidence.\n' +
      '6. Re-check game_logs after interacting, then ALWAYS stop_game_test when finished, ' +
      'even after failures.\n\n' +
      "Focus on what the caller asked you to verify, but always report launch errors. Read " +
      'the project source when you need to know which keys, nodes, or mechanics to ' +
      'exercise.\n\n' +
      'Report format: a one-line verdict first (works / broken), then evidence per checked ' +
      'item — the state values you probed, what the screenshots show, and any log errors ' +
      'verbatim. Give concrete reproduction steps for every failure. Do not speculate about ' +
      'fixes; describe precisely what is wrong.',
    // Test-and-report only: reading code is fine, changing it is the main
    // agent's job. Asset generation stays with the main agent too, and the
    // question tool would hang (no UI for subagent questions).
    tools: {
      write: false,
      edit: false,
      patch: false,
      bash: false,
      task: false,
      question: false,
      'opengenie_generate*': false
    }
  }

  config.agent = agents
}

export async function getSetupStatus(): Promise<SetupStatus> {
  const config = await readJson(configPath())
  const providers = providerEntries(config)

  // Configured if the provider has a stored credential OR its env var is set
  // (dev launches inject the key via env; packaged apps rely on auth.json).
  const auth = await readJson(authPath())
  const hasCredential = (provider: string): boolean =>
    provider in auth || !!process.env[providerEnvVar(provider)]
  // A custom provider carries its endpoint in the config; anything else
  // (built-in openrouter, or a provider name from an older version) is shown
  // as the default OpenRouter endpoint.
  const endpointOf = (provider: string): string =>
    providers[provider]?.options?.baseURL || DEFAULT_ENDPOINT

  const modelField =
    typeof config.model === 'string' && config.model
      ? config.model
      : `${OPENROUTER_PROVIDER}/${DEFAULT_MODEL}`
  const { provider, model } = splitModel(modelField)
  const { provider: imageProvider, model: imageModel } = splitModel(configuredImageModel(config))

  return {
    configured: hasCredential(provider),
    endpoint: endpointOf(provider),
    model,
    imageConfigured: hasCredential(imageProvider),
    imageEndpoint: endpointOf(imageProvider),
    imageModel,
    hy3dConfigured: await isHy3dConfigured(),
    gptImageConfigured: await isGptImageConfigured()
  }
}

export async function saveSetup(request: SetupRequest): Promise<void> {
  // Optional asset-generation credentials: only touch a stored credential
  // when the user typed something (blank = unchanged, so re-saving the model
  // doesn't wipe an existing setup).
  if (request.tencentSecretId?.trim() || request.tencentSecretKey?.trim()) {
    await saveHy3dCredentials(request.tencentSecretId ?? '', request.tencentSecretKey ?? '')
  }
  await saveGptImageConfig(request.openaiApiKey ?? '')

  const endpoint = request.endpoint.trim() || DEFAULT_ENDPOINT
  const model = request.model.trim() || DEFAULT_MODEL
  const imageEndpoint = request.imageEndpoint.trim() || DEFAULT_ENDPOINT
  const imageModel = request.imageModel.trim() || DEFAULT_IMAGE_MODEL

  const mainProvider = isOpenRouterEndpoint(endpoint) ? OPENROUTER_PROVIDER : CUSTOM_PROVIDER
  // Same endpoint → same provider and credential slot as the main model (one
  // key covers both, matching the "leave the image key blank" flow in the
  // setup panel). A separate endpoint gets its own provider + key slot.
  const imageProvider =
    imageEndpoint === endpoint
      ? mainProvider
      : isOpenRouterEndpoint(imageEndpoint)
        ? OPENROUTER_PROVIDER
        : IMAGE_PROVIDER

  // 1. Credentials → auth.json (only when a key was provided; the user may
  //    just be changing a model with keys already stored). When both models
  //    share a provider, the image key intentionally wins — same account.
  const keys: [string, string][] = []
  if (request.apiKey.trim()) keys.push([mainProvider, request.apiKey.trim()])
  if (request.imageApiKey.trim()) keys.push([imageProvider, request.imageApiKey.trim()])
  if (keys.length) {
    const path = authPath()
    await mkdir(join(path, '..'), { recursive: true })
    const auth = await readJson(path)
    for (const [providerId, key] of keys) auth[providerId] = { type: 'api', key }
    await writeFile(path, JSON.stringify(auth, null, 2))
    await chmod(path, 0o600) // credentials — owner-only
  }

  // 2. Endpoints + models + agents → global OpenCode config (preserving mcp etc.).
  const configFile = configPath()
  await mkdir(join(configFile, '..'), { recursive: true })
  const config = await readJson(configFile)
  config.model = `${mainProvider}/${model}`

  const providers = providerEntries(config)
  // Rebuild our provider entries from scratch so stale ones can't shadow
  // anything or confuse a later status read (built-in OpenRouter needs none).
  delete providers[CUSTOM_PROVIDER]
  delete providers[IMAGE_PROVIDER]
  // Models on custom endpoints aren't in models.dev, so they must be declared.
  // The image model additionally declares image input — without it OpenCode
  // assumes an unknown model can't see and strips image parts before they
  // ever reach the subagents.
  const imageModelDecl = {
    name: imageModel,
    attachment: true,
    modalities: { input: ['text', 'image'], output: ['text'] }
  }
  if (mainProvider === CUSTOM_PROVIDER) {
    providers[CUSTOM_PROVIDER] = {
      npm: '@ai-sdk/openai-compatible',
      name: 'Custom endpoint',
      options: { baseURL: endpoint },
      models: {
        [model]: { name: model },
        // Shared custom endpoint: the image model rides the same provider.
        ...(imageProvider === CUSTOM_PROVIDER ? { [imageModel]: imageModelDecl } : {})
      }
    }
  }
  if (imageProvider === IMAGE_PROVIDER) {
    providers[IMAGE_PROVIDER] = {
      npm: '@ai-sdk/openai-compatible',
      name: 'Image model endpoint',
      options: { baseURL: imageEndpoint },
      models: { [imageModel]: imageModelDecl }
    }
  }
  if (Object.keys(providers).length) config.provider = providers
  else delete config.provider

  applyAgentConfig(config, `${imageProvider}/${imageModel}`)

  if (!config.$schema) config.$schema = 'https://opencode.ai/config.json'
  await writeFile(configFile, JSON.stringify(config, null, 2))

  // 3. Drop the stale chat server so the next message picks up the new config.
  shutdownChat()
}

/** Whether a provider currently has a stored credential (used by the pre-send guard). */
export function authFileExists(): boolean {
  return existsSync(authPath())
}
