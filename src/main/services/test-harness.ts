import { app } from 'electron'
import { randomBytes } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { join } from 'node:path'
import { getCurrentProject } from '../state'
import { sendToRenderer } from '../window'
import {
  getGameLogs,
  getGameState,
  runTestCommand,
  runTestInput,
  startGameTest,
  stopGame,
  type TestInputAction
} from './game'

/**
 * Local HTTP API that exposes the AI game-testing tools to the MCP bridge
 * (resources/mcp-bridge.mjs), which OpenCode spawns as a local MCP server.
 * The bridge finds us through harness.json in userData (port + token), so
 * nothing machine-specific is written into any project or global config.
 * Bound to 127.0.0.1 and guarded by a per-launch random token.
 */

let server: Server | null = null

function harnessFilePath(): string {
  return join(app.getPath('userData'), 'harness.json')
}

function shotsDir(): string {
  return join(app.getPath('userData'), 'test-shots')
}

interface ToolResult {
  ok: boolean
  text: string
  /** Base64 PNG for screenshot results. */
  imageBase64?: string
}

async function runTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  switch (name) {
    case 'run_game_test': {
      const project = getCurrentProject()
      if (!project) return { ok: false, text: 'No project is open in OpenGenie.' }
      await startGameTest(project.path)
      return { ok: true, text: 'Game is running off-screen. Use game_input / game_screenshot / game_state to interact and observe, and stop_game_test when finished.' }
    }
    case 'stop_game_test':
      stopGame()
      return { ok: true, text: 'Game stopped.' }
    case 'game_input': {
      const actions = args.actions as TestInputAction[] | undefined
      if (!Array.isArray(actions) || actions.length === 0) {
        return { ok: false, text: 'Provide a non-empty "actions" array.' }
      }
      await runTestInput(actions)
      return { ok: true, text: `Executed ${actions.length} input action(s).` }
    }
    case 'game_screenshot': {
      mkdirSync(shotsDir(), { recursive: true })
      const path = join(shotsDir(), `shot-${Date.now()}.png`)
      const reply = await runTestCommand('screenshot', [path], 15000)
      if (!reply.ok) return { ok: false, text: reply.text }
      const png = await readFile(path)
      const base64 = png.toString('base64')
      // Mirror what the AI sees into the UI (chat + game-view test monitor).
      sendToRenderer('game:test-shot', `data:image/png;base64,${base64}`)
      return { ok: true, text: `Screenshot saved to ${path}`, imageBase64: base64 }
    }
    case 'game_state': {
      const expression = String(args.expression ?? '')
      if (!expression) return { ok: false, text: 'Provide a GDScript "expression".' }
      return { ...(await runTestCommand('eval', [expression])) }
    }
    case 'game_scene_tree':
      return { ...(await runTestCommand('tree', [])) }
    case 'game_logs': {
      const logs = getGameLogs()
      const state = getGameState()
      return {
        ok: true,
        text: `status=${state.status} mode=${state.mode ?? 'none'}\n${logs.slice(-100).join('\n') || '(no output yet)'}`
      }
    }
    default:
      return { ok: false, text: `Unknown tool: ${name}` }
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
      if (body.length > 1_000_000) reject(new Error('request too large'))
    })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

export function startTestHarness(): void {
  const token = randomBytes(24).toString('hex')

  server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const respond = (status: number, payload: unknown): void => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(payload))
    }
    if (req.headers['x-opengenie-token'] !== token) {
      respond(403, { ok: false, text: 'invalid token' })
      return
    }
    if (req.method !== 'POST' || req.url !== '/tool') {
      respond(404, { ok: false, text: 'not found' })
      return
    }
    try {
      const { name, arguments: args } = JSON.parse(await readBody(req)) as {
        name: string
        arguments?: Record<string, unknown>
      }
      respond(200, await runTool(name, args ?? {}))
    } catch (err) {
      respond(200, { ok: false, text: err instanceof Error ? err.message : String(err) })
    }
  })

  server.listen(0, '127.0.0.1', () => {
    const address = server?.address()
    const port = typeof address === 'object' && address ? address.port : 0
    // The MCP bridge discovers us through this file.
    writeFileSync(harnessFilePath(), JSON.stringify({ port, token, pid: process.pid }))
  })
}

export function stopTestHarness(): void {
  server?.close()
  server = null
  rmSync(harnessFilePath(), { force: true })
}
