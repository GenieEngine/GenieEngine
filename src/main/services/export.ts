import { shell } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { createWriteStream, existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { ExportPlatform, ExportProgress } from '../../shared/types'
import { sendToRenderer } from '../window'
import { resolveGodot } from './binaries'

const pexec = promisify(execFile)

/**
 * Game export: generates export presets for the chosen platforms and runs
 * `godot --headless --export-release` for each. Godot's export templates
 * (~1 GB, all platforms in one archive) are downloaded on first export and
 * installed into Godot's standard templates directory.
 *
 * Desktop + Web exports work out of the box; Android needs the Android SDK
 * and iOS needs Xcode — those surface Godot's own error messages.
 */

const GODOT_VERSION = '4.7'
const TEMPLATES_URL = `https://github.com/godotengine/godot/releases/download/${GODOT_VERSION}-stable/Godot_v${GODOT_VERSION}-stable_export_templates.tpz`

interface PlatformSpec {
  id: ExportPlatform
  presetName: string
  /** Godot's export platform identifier. */
  platform: string
  /** Output file for a given base name. */
  outFile: (name: string) => string
  extraOptions: (slug: string) => string
}

const PLATFORMS: PlatformSpec[] = [
  {
    id: 'windows',
    presetName: 'Windows Desktop',
    platform: 'Windows Desktop',
    outFile: (n) => `${n}.exe`,
    extraOptions: () => ''
  },
  {
    id: 'macos',
    presetName: 'macOS',
    platform: 'macOS',
    outFile: (n) => `${n}.zip`,
    extraOptions: (slug) => `application/bundle_identifier="ai.opengenie.${slug}"\n`
  },
  {
    id: 'linux',
    presetName: 'Linux',
    platform: 'Linux',
    outFile: (n) => `${n}.x86_64`,
    extraOptions: () => ''
  },
  {
    id: 'web',
    presetName: 'Web',
    platform: 'Web',
    outFile: () => `index.html`,
    extraOptions: () => 'variant/thread_support=false\n'
  },
  {
    id: 'android',
    presetName: 'Android',
    platform: 'Android',
    outFile: (n) => `${n}.apk`,
    extraOptions: () => ''
  },
  {
    id: 'ios',
    presetName: 'iOS',
    platform: 'iOS',
    outFile: (n) => `${n}.ipa`,
    extraOptions: (slug) => `application/bundle_identifier="ai.opengenie.${slug}"\n`
  }
]

let exporting = false
let currentChild: ChildProcess | null = null
let cancelRequested = false

function progress(update: ExportProgress): void {
  sendToRenderer('export:progress', update)
}

function templatesDir(): string {
  switch (process.platform) {
    case 'darwin':
      return join(homedir(), 'Library', 'Application Support', 'Godot', 'export_templates', `${GODOT_VERSION}.stable`)
    case 'win32':
      return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'Godot', 'export_templates', `${GODOT_VERSION}.stable`)
    default:
      return join(homedir(), '.local', 'share', 'godot', 'export_templates', `${GODOT_VERSION}.stable`)
  }
}

/** Download + install the full template set (once per Godot version). */
async function ensureTemplates(): Promise<void> {
  const dir = templatesDir()
  if (existsSync(dir) && (await readdir(dir)).length > 10) return

  progress({ phase: 'templates', message: 'Downloading Godot export templates (~1 GB, one-time)…', percent: 0 })
  const archive = join(tmpdir(), `og-templates-${GODOT_VERSION}.tpz`)
  const res = await fetch(TEMPLATES_URL, { redirect: 'follow' })
  if (!res.ok || !res.body) throw new Error(`Template download failed: HTTP ${res.status}`)
  const total = Number(res.headers.get('content-length') ?? 0)
  let received = 0
  let lastPercent = -1
  const counter = new (await import('node:stream')).Transform({
    transform(chunk, _enc, cb) {
      received += chunk.length
      const percent = total ? Math.floor((received / total) * 100) : 0
      if (percent !== lastPercent) {
        lastPercent = percent
        progress({ phase: 'templates', message: 'Downloading Godot export templates…', percent })
      }
      cb(null, chunk)
    }
  })
  await pipeline(Readable.fromWeb(res.body as never), counter, createWriteStream(archive))
  if (cancelRequested) {
    await rm(archive, { force: true })
    throw new Error('Export cancelled.')
  }

  progress({ phase: 'templates', message: 'Installing export templates…', percent: 100 })
  const extractTo = join(tmpdir(), `og-templates-extract-${Date.now()}`)
  await mkdir(extractTo, { recursive: true })
  // A .tpz is a zip with everything under templates/.
  await pexec('ditto', ['-xk', archive, extractTo])
  await mkdir(join(dir, '..'), { recursive: true })
  await rm(dir, { recursive: true, force: true })
  await rename(join(extractTo, 'templates'), dir)
  await rm(archive, { force: true })
  await rm(extractTo, { recursive: true, force: true })
}

/**
 * macOS (arm64/universal) and mobile exports require the ETC2/ASTC texture
 * import project setting; Godot refuses to export without it. Enable it in
 * project.godot if missing (the same change the Godot editor prompts for).
 */
async function ensureEtc2Astc(projectPath: string): Promise<void> {
  const file = join(projectPath, 'project.godot')
  let src = await readFile(file, 'utf8')
  if (src.includes('import_etc2_astc')) return
  if (/^\[rendering\]$/m.test(src)) {
    src = src.replace(/^\[rendering\]$/m, '[rendering]\n\ntextures/vram_compression/import_etc2_astc=true')
  } else {
    src += '\n[rendering]\n\ntextures/vram_compression/import_etc2_astc=true\n'
  }
  await writeFile(file, src)
}

function presetsFile(specs: PlatformSpec[], slug: string): string {
  let out = `; Generated by OpenGenie for exporting — regenerated on every export.\n`
  specs.forEach((spec, i) => {
    out += `
[preset.${i}]

name="${spec.presetName}"
platform="${spec.platform}"
runnable=true
advanced_options=false
dedicated_server=false
custom_features=""
export_filter="all_resources"
include_filter=""
exclude_filter=""
export_path=""
patches=PackedStringArray()
encryption_include_filters=""
encryption_exclude_filters=""
seed=0
encrypt_pck=false
encrypt_directory=false
script_export_mode=2

[preset.${i}.options]

custom_template/debug=""
custom_template/release=""
${spec.extraOptions(slug)}`
  })
  return out
}

export async function runExport(projectPath: string, baseName: string, platformIds: ExportPlatform[]): Promise<void> {
  if (exporting) throw new Error('An export is already in progress.')
  const godot = await resolveGodot()
  if (!godot) throw new Error('The bundled Godot engine is missing.')

  const specs = PLATFORMS.filter((p) => platformIds.includes(p.id))
  if (specs.length === 0) throw new Error('Select at least one platform.')
  const name = baseName.trim().replace(/[\\/:*?"<>|]/g, '').trim() || 'game'
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'game'

  exporting = true
  cancelRequested = false
  try {
    await ensureTemplates()

    await ensureEtc2Astc(projectPath)
    await writeFile(join(projectPath, 'export_presets.cfg'), presetsFile(specs, slug))

    for (const spec of specs) {
      if (cancelRequested) throw new Error('Export cancelled.')
      progress({ phase: 'platform', platform: spec.id, status: 'exporting' })

      const outDir = join(projectPath, 'exports', spec.id)
      await mkdir(outDir, { recursive: true })
      const outPath = join(outDir, spec.outFile(name))

      const result = await new Promise<{ code: number | null; output: string }>((resolve, reject) => {
        const child = spawn(godot, ['--headless', '--path', projectPath, '--export-release', spec.presetName, outPath], {
          cwd: projectPath,
          env: { ...process.env, PWD: projectPath },
          stdio: ['ignore', 'pipe', 'pipe']
        })
        currentChild = child
        let output = ''
        child.stdout?.setEncoding('utf8')
        child.stderr?.setEncoding('utf8')
        child.stdout?.on('data', (c: string) => (output += c))
        child.stderr?.on('data', (c: string) => (output += c))
        child.once('error', reject)
        child.once('exit', (code) => resolve({ code, output }))
      })
      currentChild = null

      const produced = existsSync(outPath)
      if (result.code === 0 && produced) {
        progress({ phase: 'platform', platform: spec.id, status: 'success', message: outPath })
      } else {
        const errors = result.output
          .split('\n')
          .filter((l) => /error|ERROR|fail/i.test(l))
          .slice(0, 4)
          .join('\n')
        progress({
          phase: 'platform',
          platform: spec.id,
          status: 'error',
          message: errors || `Export failed (exit ${result.code}).`
        })
      }
    }
    progress({ phase: 'done' })
  } catch (err) {
    progress({ phase: 'done', message: err instanceof Error ? err.message : String(err) })
    throw err
  } finally {
    exporting = false
    currentChild = null
  }
}

export function cancelExport(): void {
  cancelRequested = true
  currentChild?.kill()
}

export function revealExport(path: string): void {
  shell.showItemInFolder(path)
}
