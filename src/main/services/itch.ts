import { mkdir, open, readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { downloadGame, type DownloadGameResponse } from 'itchio-downloader'
import { slug } from './asset-store'
import { ensureProjectStateDir } from './chat-history'
import { extractZip } from './export'

/**
 * itch.io free-asset tools, exposed to the AI as `itch_search` and
 * `itch_download` (test-harness.ts / mcp-bridge.mjs). Neither needs an
 * itch.io account or API key: search goes through r.jina.ai's markdown
 * rendering of itch.io's free-game-assets search page, and downloads use
 * itchio-downloader's direct-HTTP path (its puppeteer fallback is an optional
 * dependency we deliberately never install — see .puppeteerrc.cjs).
 *
 * Downloads land in `.genieengine/itch/<author>-<name>/` — a STAGING area
 * (gitignored and .gdignore'd like all of .genieengine/). The agent then
 * copies just the files the user wants into assets/, exactly like the
 * user-uploaded asset-pack workflow in agent-instructions.md.
 */

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

// r.jina.ai allows ~20 requests/minute per IP without a key; space calls to
// stay safely under it and serialize them so concurrent tool calls can't race
// the limiter.
const SEARCH_MIN_INTERVAL_MS = 3500
const SEARCH_TIMEOUT_MS = 45_000
const MAX_RESULTS = 10
// When no structured results parse, hand the model this much raw markdown so
// it can extract asset links itself instead of failing outright.
const RAW_FALLBACK_CHARS = 4000

let nextSearchAt = 0
let searchChain: Promise<unknown> = Promise.resolve()

function throttledSearch<T>(fn: () => Promise<T>): Promise<T> {
  const run = searchChain.then(async () => {
    const wait = nextSearchAt - Date.now()
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
    nextSearchAt = Date.now() + SEARCH_MIN_INTERVAL_MS
    return fn()
  })
  // A failed search must not poison the chain for the next one.
  searchChain = run.catch(() => {})
  return run
}

export async function searchItchAssets(query: string): Promise<string> {
  const q = query.trim()
  if (!q) throw new Error('Provide a non-empty search query.')
  // c.2 = the "game assets" category, m.free = free only.
  const target = `https://itch.io/search?facets=c.2%2Cm.free&q=${encodeURIComponent(q)}`
  const markdown = await throttledSearch(async () => {
    const res = await fetch(`https://r.jina.ai/${target}`, {
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
      headers: { accept: 'text/plain' }
    })
    if (res.status === 401 || res.status === 403) {
      // Seen live: the proxy's anonymous tier blocks whole networks by
      // reputation ("bad network reputation (AS...)"), so waiting won't help.
      throw new Error(
        `The search proxy is refusing anonymous requests from this network (HTTP ${res.status}), so searching is ` +
          'unavailable right now. Suggest the user browse https://itch.io/game-assets/free in their browser and ' +
          'paste the page URL of an asset they like — itch_download works with any itch.io asset page URL.'
      )
    }
    if (!res.ok) {
      throw new Error(`itch.io search proxy failed (HTTP ${res.status}) — wait a minute, then try once more.`)
    }
    return res.text()
  })

  // Upstream failure pages arrive as HTTP 200 markdown (both observed live).
  if (markdown.includes('Target URL returned error 429')) {
    throw new Error(
      'itch.io is rate-limiting searches right now. Wait a minute or two, then try ONE more search — do not retry immediately.'
    )
  }
  if (/Just a moment|Performing security verification/i.test(markdown)) {
    throw new Error(
      'itch.io served a bot-verification page instead of results. Try again in a few minutes; the user can also browse https://itch.io/game-assets/free directly.'
    )
  }

  const results = parseSearchResults(markdown)
  if (results.length === 0) {
    return (
      'Could not parse structured results from the itch.io search page. Raw page markdown (truncated) follows — ' +
      'extract any https://<author>.itch.io/<name> asset links yourself:\n\n' +
      markdown.slice(0, RAW_FALLBACK_CHARS)
    )
  }
  const list = results.map((r, i) => `${i + 1}. [${r.title}](${r.url}) — by ${r.author}`).join('\n')
  return (
    `Found ${results.length} free itch.io assets for "${q}":\n\n${list}\n\n` +
    'Relay this numbered list to the user VERBATIM (markdown links intact — they are clickable) and ask which option they want. ' +
    "Include this disclaimer: each asset has its own license — check the asset's itch.io page for usage and attribution rules " +
    'before shipping the game with it. Only call itch_download after the user picks.'
  )
}

interface SearchResult {
  title: string
  author: string
  url: string
}

/**
 * Game pages are the only links of shape https://<author>.itch.io/<name> on
 * the results page (thumbnails live on img.itch.zone, site chrome on bare
 * itch.io), so matching that host shape finds exactly the result entries.
 * Image markdown is stripped first because thumbnails arrive as nested links
 * — [![…](img)](page) — whose page URL would otherwise be missed; their empty
 * titles fall back to the page slug and are upgraded when the plain text-title
 * link for the same page shows up.
 */
function parseSearchResults(markdown: string): SearchResult[] {
  const withoutImages = markdown.replace(/!\[[^\]]*\]\([^)]*\)/g, '')
  const re = /\[([^\]]*)\]\(https:\/\/([a-z0-9][a-z0-9-]*)\.itch\.io\/([a-z0-9][a-z0-9_-]*)\/?(?:[?#][^)]*)?\)/gi
  const seen = new Map<string, SearchResult>()
  for (const match of withoutImages.matchAll(re)) {
    const [, rawTitle, authorRaw, nameRaw] = match
    const author = authorRaw.toLowerCase()
    const name = nameRaw.toLowerCase()
    if (author === 'www') continue
    const url = `https://${author}.itch.io/${name}`
    const title = rawTitle.replace(/\s+/g, ' ').trim()
    const existing = seen.get(url)
    if (existing) {
      if (title && existing.title === name) existing.title = title
    } else if (seen.size < MAX_RESULTS) {
      seen.set(url, { title: title || name, author, url })
    }
  }
  return [...seen.values()]
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

const MAX_CONCURRENT_DOWNLOADS = 2
const MAX_TREE_DEPTH = 4
const MAX_TREE_ENTRIES = 150
const JUNK = new Set(['.DS_Store', 'Thumbs.db', '__MACOSX'])

/** Staging keys of downloads currently in flight. */
const inFlight = new Set<string>()

export async function downloadItchAsset(projectPath: string, url: string): Promise<string> {
  // The URL comes from model output — accept nothing but an itch.io page URL.
  const match = /^https?:\/\/([a-z0-9][a-z0-9-]{0,62})\.itch\.io\/([a-z0-9][a-z0-9_-]{0,120})\/?(?:[?#].*)?$/i.exec(
    url.trim()
  )
  if (!match) {
    throw new Error(
      'Not an itch.io asset page URL — expected https://<author>.itch.io/<name>. Use itch_search results or a URL the user provided.'
    )
  }
  const author = match[1].toLowerCase()
  const name = match[2].toLowerCase()
  if (author === 'www') throw new Error('That is not an asset page — use a https://<author>.itch.io/<name> URL.')
  const cleanUrl = `https://${author}.itch.io/${name}`

  const key = slug(`${author}-${name}`)
  if (inFlight.has(key)) throw new Error(`A download of ${cleanUrl} is already in progress — wait for it to finish.`)
  if (inFlight.size >= MAX_CONCURRENT_DOWNLOADS) {
    throw new Error(`Too many itch.io downloads in flight (max ${MAX_CONCURRENT_DOWNLOADS}) — wait for one to finish.`)
  }

  const stateDir = await ensureProjectStateDir(projectPath)
  const destAbs = join(stateDir, 'itch', key)
  // POSIX-style for the model, matching how other tools report project paths.
  const destRel = `.genieengine/itch/${key}`

  inFlight.add(key)
  try {
    // Re-downloading the same asset starts from a clean slate — never mix
    // leftovers of a previous (possibly different) version into the listing.
    await rm(destAbs, { recursive: true, force: true })
    await mkdir(destAbs, { recursive: true })

    // Single-params calls return a single response; the array-input overload
    // is why the declared return type is a union.
    const result = (await downloadGame({
      itchGameUrl: cleanUrl,
      downloadDirectory: destAbs,
      // Keep the staging dir asset-only (no stray metadata JSON the agent
      // might copy into assets/); the title/author ride in result.metaData.
      writeMetaData: false,
      retries: 2,
      retryDelayMs: 2000
    })) as DownloadGameResponse

    if (!result.status || !result.filePath) {
      throw new Error(downloadFailureText(cleanUrl, result))
    }

    let extracted = false
    if (await isZip(result.filePath)) {
      await extractZip(result.filePath, destAbs)
      await rm(result.filePath, { force: true })
      extracted = true
    }

    const { lines, truncated } = await listTree(destAbs)
    const title = result.metaData?.title ?? name
    const by = result.metaData?.authors?.[0]?.name ?? author
    return (
      `Downloaded "${title}" by ${by} into ${destRel}/${extracted ? ' (zip auto-extracted)' : ''}.\n\n` +
      `Files${truncated ? ` (first ${MAX_TREE_ENTRIES} entries)` : ''}:\n${lines.join('\n')}\n\n` +
      'These staged files are INVISIBLE to Godot and git. Copy ONLY the pieces the user wants into the proper assets/ ' +
      'sub-folders (assets/entities/<id>/, assets/ui/, assets/shared/) with your file tools, renamed to fit the project, ' +
      'then wire them into scenes — never reference .genieengine/... paths from game code. ' +
      `Remind the user to follow this asset's license terms from ${cleanUrl} (many require attribution).`
    )
  } finally {
    inFlight.delete(key)
  }
}

function downloadFailureText(url: string, result: DownloadGameResponse): string {
  switch (result.failReason) {
    case 'paid':
      return `This itch.io asset is paid — only free assets can be downloaded (${result.message}). Tell the user and offer a free alternative from itch_search.`
    case 'web_only':
    case 'no_uploads':
    case 'not_html5':
      return `${url} has no downloadable files (browser-playable or empty page) — pick a downloadable asset pack instead.`
    case 'csrf_failed':
    case 'puppeteer_missing':
      return `itch.io would not serve this download over direct HTTP (${result.message}). Suggest the user download it manually from ${url} and attach it to the chat.`
    default:
      return `itch.io download failed: ${result.message}`
  }
}

/** ZIP magic from the file header only — never buffer a whole asset pack. */
async function isZip(file: string): Promise<boolean> {
  const fh = await open(file, 'r')
  try {
    const buf = Buffer.alloc(4)
    const { bytesRead } = await fh.read(buf, 0, 4, 0)
    return bytesRead === 4 && buf.toString('latin1').startsWith('PK')
  } finally {
    await fh.close()
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Bounded indented tree of the staged files (depth- and entry-capped, junk
 * skipped, directories first) — enough for the model to pick what to copy
 * without flooding its context on huge packs; it can always list the staged
 * folder itself for more.
 */
async function listTree(root: string): Promise<{ lines: string[]; truncated: boolean }> {
  const lines: string[] = []
  let truncated = false
  async function walk(dir: string, depth: number): Promise<void> {
    const entries = (await readdir(dir, { withFileTypes: true }))
      .filter((entry) => !JUNK.has(entry.name))
      .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (lines.length >= MAX_TREE_ENTRIES) {
        truncated = true
        return
      }
      const indent = '  '.repeat(depth)
      if (entry.isDirectory()) {
        if (depth >= MAX_TREE_DEPTH) {
          lines.push(`${indent}${entry.name}/ …`)
          continue
        }
        lines.push(`${indent}${entry.name}/`)
        await walk(join(dir, entry.name), depth + 1)
      } else {
        const { size } = await stat(join(dir, entry.name))
        lines.push(`${indent}${entry.name} (${formatSize(size)})`)
      }
    }
  }
  await walk(root, 0)
  if (truncated) {
    lines.push(`… listing truncated at ${MAX_TREE_ENTRIES} entries — list the staged folder yourself for the rest.`)
  }
  return { lines, truncated }
}
