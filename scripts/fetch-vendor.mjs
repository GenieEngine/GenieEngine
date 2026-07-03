#!/usr/bin/env node
/**
 * Downloads the engines OpenGenie ships with — Godot and the OpenCode CLI —
 * into vendor/ for the *current* platform. Runs automatically on `npm install`
 * (postinstall) and is idempotent. electron-builder copies vendor/ into the
 * packaged app's resources, so installed builds are fully self-contained.
 *
 * Versions are pinned so every build bundles exactly what was tested.
 * (Git is bundled separately via the `dugite` npm dependency.)
 */
import { execFileSync } from 'node:child_process'
import { chmodSync, createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const VENDOR = join(ROOT, 'vendor')

const GODOT_VERSION = '4.7'
const OPENCODE_VERSION = 'v1.17.13'

const platform = process.platform
const arch = process.arch === 'arm64' ? 'arm64' : 'x64'

function godotTarget() {
  const base = `https://github.com/godotengine/godot/releases/download/${GODOT_VERSION}-stable/Godot_v${GODOT_VERSION}-stable`
  if (platform === 'darwin') {
    return {
      url: `${base}_macos.universal.zip`,
      dir: join(VENDOR, 'godot', 'darwin'),
      check: join(VENDOR, 'godot', 'darwin', 'Godot.app', 'Contents', 'MacOS', 'Godot')
    }
  }
  if (platform === 'win32') {
    const asset = arch === 'arm64' ? '_windows_arm64.exe.zip' : '_win64.exe.zip'
    return {
      url: `${base}${asset}`,
      dir: join(VENDOR, 'godot', 'win32'),
      check: join(VENDOR, 'godot', 'win32', 'godot.exe'),
      renameTo: 'godot.exe'
    }
  }
  const asset = arch === 'arm64' ? '_linux.arm64.zip' : '_linux.x86_64.zip'
  return {
    url: `${base}${asset}`,
    dir: join(VENDOR, 'godot', 'linux'),
    check: join(VENDOR, 'godot', 'linux', 'godot'),
    renameTo: 'godot'
  }
}

function opencodeTarget() {
  const os = platform === 'win32' ? 'windows' : platform === 'darwin' ? 'darwin' : 'linux'
  const ext = os === 'linux' ? 'tar.gz' : 'zip'
  const bin = os === 'windows' ? 'opencode.exe' : 'opencode'
  return {
    url: `https://github.com/sst/opencode/releases/download/${OPENCODE_VERSION}/opencode-${os}-${arch}.${ext}`,
    dir: join(VENDOR, 'opencode', platform),
    check: join(VENDOR, 'opencode', platform, bin)
  }
}

async function download(url, dest) {
  console.log(`  downloading ${url}`)
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest))
}

function extract(archive, dir) {
  if (archive.endsWith('.tar.gz')) {
    execFileSync('tar', ['-xzf', archive, '-C', dir])
  } else if (platform === 'darwin') {
    // ditto preserves .app bundle structure, symlinks and permissions.
    execFileSync('ditto', ['-xk', archive, dir])
  } else if (platform === 'win32') {
    execFileSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -Force -Path "${archive}" -DestinationPath "${dir}"`])
  } else {
    execFileSync('unzip', ['-q', '-o', archive, '-d', dir])
  }
}

async function fetchTarget(label, target) {
  if (existsSync(target.check)) {
    console.log(`✓ ${label} already present`)
    return
  }
  console.log(`… fetching ${label}`)
  mkdirSync(target.dir, { recursive: true })
  const archive = join(target.dir, '_download.tmp')
  try {
    await download(target.url, archive)
    extract(archive, target.dir)
    if (target.renameTo) {
      // Godot archives contain a versioned binary name; normalize it so the
      // app can resolve it without knowing the bundled version.
      const extracted = readdirSync(target.dir).find(
        (f) => f.startsWith('Godot_v') && !f.endsWith('_console.exe') && !f.endsWith('.tmp')
      )
      if (extracted) renameSync(join(target.dir, extracted), join(target.dir, target.renameTo))
    }
    if (platform !== 'win32' && existsSync(target.check)) chmodSync(target.check, 0o755)
    if (!existsSync(target.check)) throw new Error(`extraction did not produce ${target.check}`)
    console.log(`✓ ${label} ready`)
  } finally {
    rmSync(archive, { force: true })
  }
}

try {
  await fetchTarget(`Godot ${GODOT_VERSION}`, godotTarget())
  await fetchTarget(`OpenCode ${OPENCODE_VERSION}`, opencodeTarget())
} catch (err) {
  // Don't fail `npm install` when offline — the app degrades gracefully and
  // `npm run setup` can be re-run later.
  console.warn(`\n⚠ vendor fetch failed: ${err.message}`)
  console.warn('  OpenGenie needs these bundled engines; re-run with: npm run setup\n')
}
