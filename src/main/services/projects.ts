import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { ProjectInfo } from '../../shared/types'
import { commit, init, stage } from './git'
import { agentsMd, gitignore, iconSvg, mainGd, mainTscn, projectGodot } from './templates'

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_ ]/g, '')
    .replace(/\s+/g, '-')
}

async function readProjectName(dir: string): Promise<string> {
  try {
    const config = await readFile(join(dir, 'project.godot'), 'utf8')
    const match = config.match(/^config\/name="(.*)"$/m)
    if (match) return match[1]
  } catch {
    // Fall through to the folder name.
  }
  return basename(dir)
}

/** Scaffold a new runnable Godot project and initialize a git repo in it. */
export async function createProject(parentDir: string, name: string): Promise<ProjectInfo> {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('Project name is required')
  const folder = slugify(trimmed) || 'my-game'
  const dir = join(parentDir, folder)

  if (existsSync(dir) && (await readdir(dir)).length > 0) {
    throw new Error(`Folder already exists and is not empty: ${dir}`)
  }
  await mkdir(dir, { recursive: true })

  await Promise.all([
    writeFile(join(dir, 'project.godot'), projectGodot(trimmed)),
    writeFile(join(dir, 'main.tscn'), mainTscn(trimmed)),
    writeFile(join(dir, 'main.gd'), mainGd(trimmed)),
    writeFile(join(dir, 'icon.svg'), iconSvg()),
    writeFile(join(dir, '.gitignore'), gitignore()),
    writeFile(join(dir, 'AGENTS.md'), agentsMd(trimmed))
  ])

  // Best-effort git setup (uses the git service, which falls back to the
  // bundled git): a failure here should not block project creation — the
  // Git tab surfaces repo state later.
  try {
    await init(dir)
    await stage(dir, ['.'])
    await commit(dir, 'Initial commit — created with OpenGenie')
  } catch {
    /* ignore */
  }

  return { path: dir, name: trimmed }
}

/** Validate and open an existing Godot project directory. */
export async function openProject(dir: string): Promise<ProjectInfo> {
  if (!existsSync(join(dir, 'project.godot'))) {
    throw new Error(
      'The selected folder is not a Godot project (no project.godot found). ' +
        'Choose a project created with OpenGenie or an existing Godot 4 project.'
    )
  }
  return { path: dir, name: await readProjectName(dir) }
}

export async function projectInfoFor(dir: string): Promise<ProjectInfo> {
  return { path: dir, name: await readProjectName(dir) }
}
