#!/usr/bin/env node
/**
 * MCP (Model Context Protocol) stdio server that exposes OpenGenie's game
 * testing tools to OpenCode. It is a thin bridge: every tool call is
 * forwarded over HTTP to the running OpenGenie app, discovered via
 * harness.json in OpenGenie's userData directory (written on app launch).
 *
 * Spawned by OpenCode (registered in the global opencode config by the app)
 * with Electron's binary in Node mode — no separate Node install needed.
 * Zero dependencies; speaks newline-delimited JSON-RPC 2.0 on stdio.
 */
import { readFileSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

function userDataDir() {
  switch (process.platform) {
    case 'darwin':
      return join(homedir(), 'Library', 'Application Support', 'OpenGenie')
    case 'win32':
      return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'OpenGenie')
    default:
      return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'OpenGenie')
  }
}

function readHarness() {
  try {
    return JSON.parse(readFileSync(join(userDataDir(), 'harness.json'), 'utf8'))
  } catch {
    return null
  }
}

/**
 * node:http with timeout 0 — NOT fetch: undici aborts responses that take
 * more than 5 minutes to start, and 3D asset generation legitimately takes
 * longer than that.
 */
function harnessRequest(harness, method, path, body) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port: harness.port,
        method,
        path,
        headers: { 'content-type': 'application/json', 'x-opengenie-token': harness.token },
        timeout: 0
      },
      (res) => {
        let data = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => (data += chunk))
        res.on('end', () => {
          try {
            resolve(JSON.parse(data))
          } catch {
            reject(new Error(`invalid harness response (HTTP ${res.statusCode})`))
          }
        })
        res.on('error', reject)
      }
    )
    req.on('error', reject)
    req.end(body ?? '')
  })
}

async function callHarness(name, args) {
  const harness = readHarness()
  if (!harness) {
    return { ok: false, text: 'OpenGenie does not appear to be running (harness.json not found). These tools only work while the OpenGenie app is open.' }
  }
  try {
    return await harnessRequest(harness, 'POST', '/tool', JSON.stringify({ name, arguments: args }))
  } catch (err) {
    return { ok: false, text: `Failed to reach OpenGenie: ${err.message}` }
  }
}

/** Optional-tool availability, checked once per bridge lifetime (per chat server). */
async function harnessCapabilities() {
  const harness = readHarness()
  if (!harness) return {}
  try {
    return await harnessRequest(harness, 'GET', '/capabilities')
  } catch {
    return {}
  }
}

const TOOLS = [
  {
    name: 'run_game_test',
    description:
      'Start the currently open OpenGenie game project off-screen for testing. The game runs the full native engine (rendering, physics, audio muted display) without showing a window. Always call this before other game_* tools, and stop_game_test when done.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'game_input',
    description:
      'Send scripted input to the running test game. Actions execute in order. Keys use DOM-style names ("ArrowLeft", "Space", "a", "Enter", "Escape"). Mouse coordinates are in game-view points from the top-left.',
    inputSchema: {
      type: 'object',
      properties: {
        actions: {
          type: 'array',
          description: 'Sequence of input steps',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['key_press', 'key_down', 'key_up', 'mouse_click', 'mouse_move', 'wait'] },
              key: { type: 'string', description: 'For key_* actions' },
              holdMs: { type: 'number', description: 'key_press hold duration (default 60ms)' },
              x: { type: 'number' },
              y: { type: 'number' },
              button: { type: 'number', description: 'mouse button: 0 left, 1 middle, 2 right' },
              ms: { type: 'number', description: 'for wait' }
            },
            required: ['type']
          }
        }
      },
      required: ['actions']
    }
  },
  {
    name: 'game_screenshot',
    description: 'Capture a PNG screenshot of the running test game (rendered off-screen). Returns the image.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'game_state',
    description:
      'Evaluate a GDScript expression against the running game\'s scene tree root and return the result as JSON. Examples: get_tree().current_scene.name · get_node("/root/Main").score · get_node("/root/Main/Score").text. Use this to assert game state without screenshots.',
    inputSchema: {
      type: 'object',
      properties: { expression: { type: 'string', description: 'GDScript expression (no statements)' } },
      required: ['expression']
    }
  },
  {
    name: 'game_scene_tree',
    description: 'Dump the running game\'s scene tree (node names, classes, hierarchy). Useful to discover node paths for game_state.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'game_logs',
    description: 'Get the game\'s recent console output (prints and script errors) and current run status.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'stop_game_test',
    description: 'Stop the off-screen test game.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  }
]

/**
 * Offered only when the user has configured an OpenAI API key in OpenGenie's
 * settings panel (checked via /capabilities at list time).
 */
const GPT_IMAGE_TOOL = {
  name: 'generate_2d_asset',
  description:
    'Generate a 2D image asset (sprite, icon, texture, UI art) with OpenAI image generation and save it into the project\'s assets/ folder. ' +
    'Fixed output: one 1024×1024 PNG with a TRANSPARENT background at medium quality — ideal for sprites and icons. ' +
    'Takes ~10-60 seconds; returns the written file path plus the image itself so you can check it. ' +
    'Describe ONE subject per call (subject, colors/materials, art style, camera angle e.g. "top-down" or "side view for a platformer"). ' +
    'Organize assets to mirror the ECS layout: folder "entities/e_player" for that entity\'s art, "ui" for HUD art, "shared" for reusable pieces. ' +
    'If the user gives feedback on the preview, regenerate with the SAME folder and name so the files are replaced.',
  inputSchema: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'Text description of the image (one subject, style, colors, view angle).' },
      folder: { type: 'string', description: 'Destination under assets/, mirroring the ECS structure — e.g. "entities/e_player", "ui", "shared".' },
      name: { type: 'string', description: 'Asset name (lowercase slug), e.g. "coin-icon".' }
    },
    required: ['prompt', 'folder', 'name']
  }
}

/**
 * Offered only when the user has configured Tencent HY 3D credentials in
 * OpenGenie's setup panel (checked via /capabilities at list time).
 */
const HY3D_TOOL = {
  name: 'generate_3d_asset',
  description:
    'Generate a 3D model with Tencent HY 3D and save it into the project\'s assets/ folder. ' +
    'Takes 1-5 minutes — the call blocks until the model is ready and returns the written file paths plus a preview image. ' +
    'Describe ONE object per call (simple prompt: subject, shape, colors/materials, style). ' +
    'Organize assets to mirror the ECS layout: folder "entities/e_player" for that entity\'s model, "ui" for HUD art, "shared" for reusable pieces. ' +
    'Keep face_count modest for game use (default 60000; use generate_type "LowPoly" for stylized low-poly).',
  inputSchema: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'Text description of the 3D object (max 1024 chars). Required unless image_path is given.' },
      image_path: { type: 'string', description: 'Project-relative path to a reference image (jpg/png/webp, single object on a plain background). Cannot be combined with prompt except in Sketch mode.' },
      folder: { type: 'string', description: 'Destination under assets/, mirroring the ECS structure — e.g. "entities/e_player", "ui", "shared".' },
      name: { type: 'string', description: 'Asset name (lowercase slug), e.g. "spaceship".' },
      face_count: { type: 'number', description: 'Polygon budget, 3000-1500000 (default 60000).' },
      generate_type: { type: 'string', enum: ['Normal', 'LowPoly', 'Geometry', 'Sketch'], description: 'Normal = textured model (default) · LowPoly = stylized reduced-poly · Geometry = untextured white model · Sketch = from a line drawing.' },
      enable_pbr: { type: 'boolean', description: 'Generate PBR materials (default true; ignored for Geometry).' }
    },
    required: ['folder', 'name']
  }
}

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n')
}

async function handle(request) {
  const { id, method, params } = request
  if (method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: params?.protocolVersion ?? '2025-03-26',
        capabilities: { tools: {} },
        serverInfo: { name: 'opengenie', version: '0.1.0' }
      }
    })
  } else if (method === 'tools/list') {
    const caps = await harnessCapabilities()
    const tools = [...TOOLS]
    if (caps.hy3d) tools.push(HY3D_TOOL)
    if (caps.gptImage) tools.push(GPT_IMAGE_TOOL)
    send({ jsonrpc: '2.0', id, result: { tools } })
  } else if (method === 'tools/call') {
    const result = await callHarness(params.name, params.arguments ?? {})
    const content = []
    if (result.imageBase64) {
      content.push({ type: 'image', data: result.imageBase64, mimeType: result.imageMime ?? 'image/png' })
    }
    content.push({ type: 'text', text: result.text ?? (result.ok ? 'ok' : 'failed') })
    send({ jsonrpc: '2.0', id, result: { content, isError: !result.ok } })
  } else if (method === 'ping') {
    send({ jsonrpc: '2.0', id, result: {} })
  } else if (id !== undefined) {
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } })
  }
  // Notifications (no id) are ignored.
}

const rl = createInterface({ input: process.stdin })
rl.on('line', (line) => {
  if (!line.trim()) return
  let request
  try {
    request = JSON.parse(line)
  } catch {
    return
  }
  handle(request).catch((err) => {
    if (request.id !== undefined) {
      send({ jsonrpc: '2.0', id: request.id, error: { code: -32603, message: String(err?.message ?? err) } })
    }
  })
})
rl.on('close', () => process.exit(0))
