/**
 * itchio-downloader lists puppeteer as an optional dependency, used only as a
 * last-resort fallback that free downloadable assets never reach (its failed
 * require is caught and surfaced as a normal failure). Without this file,
 * puppeteer's postinstall downloads a ~150 MB Chrome build nobody uses —
 * cosmiconfig finds this config by searching upward from node_modules.
 * The puppeteer JS tree is likewise excluded from packaging (package.json
 * build.files).
 */
module.exports = { skipDownload: true }
