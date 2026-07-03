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

async function callHarness(name, args) {
  let harness
  try {
    harness = JSON.parse(readFileSync(join(userDataDir(), 'harness.json'), 'utf8'))
  } catch {
    return { ok: false, text: 'OpenGenie does not appear to be running (harness.json not found). These tools only work while the OpenGenie app is open.' }
  }
  try {
    const res = await fetch(`http://127.0.0.1:${harness.port}/tool`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-opengenie-token': harness.token },
      body: JSON.stringify({ name, arguments: args })
    })
    return await res.json()
  } catch (err) {
    return { ok: false, text: `Failed to reach OpenGenie: ${err.message}` }
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
    send({ jsonrpc: '2.0', id, result: { tools: TOOLS } })
  } else if (method === 'tools/call') {
    const result = await callHarness(params.name, params.arguments ?? {})
    const content = []
    if (result.imageBase64) {
      content.push({ type: 'image', data: result.imageBase64, mimeType: 'image/png' })
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
