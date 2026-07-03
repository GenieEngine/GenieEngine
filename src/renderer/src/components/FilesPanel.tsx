import { useCallback, useEffect, useState } from 'react'
import type { FileEntry, ProjectInfo } from '../../../shared/types'
import { ChevronIcon, CollapseAllIcon, ExternalIcon, FileIcon, FolderIcon, FolderOpenIcon, RefreshIcon } from './Icons'

interface Props {
  project: ProjectInfo
  refreshToken: number
}

/**
 * Explorer-style lazy file tree (modeled on VS Code): compact rows, indent
 * guides, folder twisties, header icon actions. Directory listings are cached
 * by absolute path; refresh re-lists every open directory in place so the
 * tree does not collapse when the AI changes files.
 */
export function FilesPanel({ project, refreshToken }: Props): React.JSX.Element {
  const [dirs, setDirs] = useState<Record<string, FileEntry[]>>({})
  const [openDirs, setOpenDirs] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (path: string): Promise<void> => {
    const result = await window.api.listDir(path)
    if (result.ok) {
      setDirs((prev) => ({ ...prev, [path]: result.data }))
    } else {
      // Directory vanished (deleted/renamed) — drop it from the cache.
      setDirs((prev) => {
        const next = { ...prev }
        delete next[path]
        return next
      })
      setOpenDirs((prev) => {
        const next = new Set(prev)
        next.delete(path)
        return next
      })
    }
  }, [])

  useEffect(() => {
    void load(project.path)
  }, [project.path, load])

  const refreshAll = useCallback((): void => {
    void load(project.path)
    openDirs.forEach((dir) => void load(dir))
  }, [load, openDirs, project.path])

  useEffect(() => {
    if (refreshToken === 0) return
    refreshAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken])

  const toggle = (path: string): void => {
    setOpenDirs((prev) => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
        if (!dirs[path]) void load(path)
      }
      return next
    })
  }

  const openExternal = async (kind: 'vscode' | 'godot', target?: string): Promise<void> => {
    setError(null)
    const result =
      kind === 'vscode' ? await window.api.openInVSCode(target) : await window.api.openInGodotEditor()
    if (!result.ok) setError(result.error)
  }

  const renderEntries = (parent: string, depth: number): React.JSX.Element[] => {
    const entries = dirs[parent] ?? []
    return entries.flatMap((entry) => {
      const isOpen = entry.isDirectory && openDirs.has(entry.path)
      const row = (
        <div
          key={entry.path}
          role="button"
          tabIndex={0}
          className={selected === entry.path ? 'tree-row selected' : 'tree-row'}
          onClick={() => {
            setSelected(entry.path)
            if (entry.isDirectory) toggle(entry.path)
          }}
          onDoubleClick={() => {
            if (!entry.isDirectory) void openExternal('vscode', entry.path)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              setSelected(entry.path)
              if (entry.isDirectory) toggle(entry.path)
              else void openExternal('vscode', entry.path)
            }
          }}
          title={entry.isDirectory ? entry.name : `${entry.name} — double-click to open in VS Code`}
        >
          {Array.from({ length: depth }, (_, i) => (
            <span key={i} className="indent-guide" />
          ))}
          <span className={isOpen ? 'tree-twist open' : 'tree-twist'}>
            {entry.isDirectory && <ChevronIcon size={10} />}
          </span>
          <span className="tree-icon">
            {entry.isDirectory ? (isOpen ? <FolderOpenIcon size={14} /> : <FolderIcon size={14} />) : <FileIcon size={14} />}
          </span>
          <span className="tree-name">{entry.name}</span>
        </div>
      )
      return isOpen ? [row, ...renderEntries(entry.path, depth + 1)] : [row]
    })
  }

  return (
    <div className="files-panel">
      <div className="panel-header">
        <span className="panel-title-caps" title={project.path}>
          {project.name}
        </span>
        <span className="header-actions push-right">
          <button className="icon-btn sm" title="Collapse all" onClick={() => setOpenDirs(new Set())}>
            <CollapseAllIcon size={14} />
          </button>
          <button className="icon-btn sm" title="Refresh" onClick={refreshAll}>
            <RefreshIcon size={14} />
          </button>
        </span>
      </div>

      <div className="open-btns">
        <button className="open-btn" onClick={() => void openExternal('vscode')}>
          <ExternalIcon size={12} /> VS Code
        </button>
        <button className="open-btn" onClick={() => void openExternal('godot')}>
          <ExternalIcon size={12} /> Godot Editor
        </button>
      </div>

      {error && <div className="error-banner small">{error}</div>}

      <div className="tree">{renderEntries(project.path, 0)}</div>
    </div>
  )
}
