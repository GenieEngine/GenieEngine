#!/usr/bin/env node
/**
 * Downloads the engines OpenGenie ships with — Godot and the OpenCode CLI —
 * into vendor/ for a target platform. Defaults to the *current* platform and
 * runs automatically on `npm install` (postinstall); idempotent. electron-builder
 * copies vendor/<platform> into that platform's packaged app resources, so
 * installed builds are fully self-contained.
 *
 * To stage another platform's binaries for cross-building (e.g. building the
 * Windows or Linux installer from macOS), pass --platform= and --arch=:
 *   node scripts/fetch-vendor.mjs --platform=win32 --arch=x64
 *   node scripts/fetch-vendor.mjs --platform=linux --arch=x64
 * Extraction only needs tools available on the *host* (tar/ditto/unzip), not
 * the target platform, so this works cross-platform from a POSIX host.
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

function argValue(flag) {
  const arg = process.argv.find((a) => a.startsWith(`--${flag}=`))
  return arg ? arg.slice(flag.length + 3) : undefined
}

const platform = argValue('platform') ?? process.platform
const arch = (argValue('arch') ?? process.arch) === 'arm64' ? 'arm64' : 'x64'
// Extraction tool is chosen by the *host* OS (what can actually run these
// commands), independent of which platform's binaries we're fetching.
const host = process.platform

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
  } else if (host === 'darwin') {
    // ditto preserves .app bundle structure, symlinks and permissions
    // (also handles plain zips fine when fetching a non-mac target).
    execFileSync('ditto', ['-xk', archive, dir])
  } else if (host === 'win32') {
    // bsdtar (Windows 10 1803+) extracts zips; paths are plain args, never
    // interpolated into a PowerShell command string (same fix as export.ts).
    execFileSync('tar', ['-xf', archive, '-C', dir])
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
  // Preserve the real extension so extract() can tell a .tar.gz from a .zip —
  // matters once we're fetching non-host targets (e.g. Linux's .tar.gz from macOS).
  const archive = join(target.dir, target.url.endsWith('.tar.gz') ? '_download.tar.gz' : '_download.zip')
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
    // Executable bit is meaningless on Windows but harmless to set from a
    // POSIX host when cross-fetching the win32 target's binaries.
    if (host !== 'win32' && existsSync(target.check)) chmodSync(target.check, 0o755)
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
