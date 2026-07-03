import { app } from 'electron'
import { chmod, readFile, rm, writeFile } from 'node:fs/promises'
import { join, normalize, resolve, sep } from 'node:path'

/**
 * Shared pieces of the asset-generation services (hy3d.ts, gptimage.ts):
 * where generated assets land inside a project, and how provider credentials
 * are stored. Each provider keeps a small JSON file in userData, chmod 600 —
 * the same treatment OpenCode's auth.json gets.
 */

export const slug = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')

/**
 * Resolve `assets/<folder>/<name>` inside the project, refusing anything that
 * escapes it (the folder comes from the model — treat it as untrusted).
 * Leading slashes are stripped rather than rejected, so a stray absolute-ish
 * input stays contained under assets/.
 */
export function assetDir(projectPath: string, folder: string, name: string): { abs: string; rel: string } {
  const cleanFolder = normalize(folder).replace(/^[/\\]+|[/\\]+$/g, '')
  if (!cleanFolder || cleanFolder.split(/[/\\]/).some((part) => part === '..' || part.startsWith('.'))) {
    throw new Error(`Invalid asset folder "${folder}" — use a relative path like "entities/e_player".`)
  }
  const cleanName = slug(name)
  if (!cleanName) throw new Error('Asset name is required.')
  const rel = join('assets', cleanFolder, cleanName)
  const abs = resolve(projectPath, rel)
  if (!abs.startsWith(resolve(projectPath) + sep)) throw new Error(`Asset path escapes the project: ${folder}`)
  return { abs, rel }
}

/** Media types the chat/vision pipeline accepts for generated-asset previews. */
export const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif'
}

/** Owner-only JSON credentials file in userData for one provider. */
export function credentialsStore<T extends Record<string, string>>(fileName: string) {
  const path = (): string => join(app.getPath('userData'), fileName)

  return {
    async load(): Promise<T | null> {
      try {
        const parsed = JSON.parse(await readFile(path(), 'utf8')) as T
        // Every field present and non-empty, or treat as unconfigured.
        return Object.values(parsed).every((v) => typeof v === 'string' && v) ? parsed : null
      } catch {
        return null
      }
    },
    async save(values: T): Promise<void> {
      await writeFile(path(), JSON.stringify(values, null, 2))
      await chmod(path(), 0o600)
    },
    async clear(): Promise<void> {
      await rm(path(), { force: true })
    },
    async isConfigured(): Promise<boolean> {
      return (await this.load()) !== null
    }
  }
}
