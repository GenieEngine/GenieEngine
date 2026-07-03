import { execFile, spawn } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { FileEntry } from '../../shared/types'
import { findBinary } from './binaries'

const pexec = promisify(execFile)

/** Noise folders hidden from the file tree (mirrors what Godot/VS Code hide). */
const HIDDEN = new Set(['.git', '.godot', '.DS_Store'])

export async function listDir(dir: string): Promise<FileEntry[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  return entries
    .filter((e) => !HIDDEN.has(e.name))
    .map((e) => ({ name: e.name, path: join(dir, e.name), isDirectory: e.isDirectory() }))
    .sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name)
    })
}

export async function openInVSCode(target: string): Promise<void> {
  const code = await findBinary('code', [
    '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code'
  ])
  if (code) {
    spawn(code, [target], { detached: true, stdio: 'ignore' }).unref()
    return
  }
  if (process.platform === 'darwin') {
    // The `code` CLI shim may not be installed even when the app is.
    try {
      await pexec('open', ['-a', 'Visual Studio Code', target])
      return
    } catch {
      /* fall through to the error below */
    }
  }
  throw new Error('VS Code not found. Install it from https://code.visualstudio.com to open the codebase.')
}
