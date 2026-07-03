import { useCallback, useEffect, useRef, useState } from 'react'
import type { GitChange, GitCommit, GitStatus } from '../../../shared/types'
import {
  CheckIcon,
  ChevronIcon,
  DownArrowIcon,
  FileIcon,
  GitBranchIcon,
  MinusIcon,
  PlusIcon,
  RefreshIcon,
  UndoIcon,
  UpArrowIcon
} from './Icons'

interface Props {
  active: boolean
  refreshToken: number
}

const STATUS_LABEL: Record<string, string> = {
  M: 'Modified',
  A: 'Added',
  D: 'Deleted',
  R: 'Renamed',
  C: 'Copied',
  U: 'Untracked',
  '?': 'Untracked'
}

/** Discard is destructive, so the button asks for a second click to confirm. */
function DiscardButton({ onConfirm }: { onConfirm: () => void }): React.JSX.Element {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const timer = setTimeout(() => setArmed(false), 3000)
    return () => clearTimeout(timer)
  }, [armed])
  return armed ? (
    <button
      className="row-btn danger"
      title="Click again to discard changes"
      onClick={(e) => {
        e.stopPropagation()
        onConfirm()
      }}
    >
      Sure?
    </button>
  ) : (
    <button
      className="row-btn"
      title="Discard changes"
      onClick={(e) => {
        e.stopPropagation()
        setArmed(true)
      }}
    >
      <UndoIcon size={12} />
    </button>
  )
}

/** VS Code-style collapsible section header with count badge and actions. */
function Section({
  title,
  count,
  actions,
  children
}: {
  title: string
  count?: number
  actions?: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  const [open, setOpen] = useState(true)
  return (
    <div className="scm-section">
      <div className="section-header" role="button" tabIndex={0} onClick={() => setOpen((v) => !v)}>
        <span className={open ? 'tree-twist open' : 'tree-twist'}>
          <ChevronIcon size={10} />
        </span>
        <span className="section-title">{title}</span>
        {count !== undefined && count > 0 && <span className="count-badge">{count}</span>}
        <span className="header-actions push-right" onClick={(e) => e.stopPropagation()}>
          {actions}
        </span>
      </div>
      {open && children}
    </div>
  )
}

/** Split a repo-relative path into filename + dimmed parent directory. */
function splitPath(path: string): { name: string; dir: string } {
  const idx = path.lastIndexOf('/')
  return idx === -1 ? { name: path, dir: '' } : { name: path.slice(idx + 1), dir: path.slice(0, idx) }
}

/** VS Code-style source control: stage, commit, push/pull, remote setup. */
export function GitPanel({ active, refreshToken }: Props): React.JSX.Element {
  const [status, setStatus] = useState<GitStatus | null>(null)
  const [history, setHistory] = useState<GitCommit[]>([])
  const [message, setMessage] = useState('')
  const [remoteUrl, setRemoteUrl] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const infoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    const [statusResult, logResult] = await Promise.all([window.api.gitStatus(), window.api.gitLog()])
    if (statusResult.ok) setStatus(statusResult.data)
    if (logResult.ok) setHistory(logResult.data)
  }, [])

  useEffect(() => {
    if (active) void refresh()
  }, [active, refresh])

  useEffect(() => {
    if (refreshToken > 0) void refresh()
  }, [refreshToken, refresh])

  const showInfo = (text: string): void => {
    setInfo(text)
    if (infoTimer.current) clearTimeout(infoTimer.current)
    infoTimer.current = setTimeout(() => setInfo(null), 5000)
  }

  /** Run a git action with busy state, error surfacing and a refresh after. */
  const run = async (
    name: string,
    action: () => Promise<{ ok: true; data: unknown } | { ok: false; error: string }>,
    successInfo?: (data: unknown) => string
  ): Promise<void> => {
    setBusy(name)
    setError(null)
    const result = await action()
    setBusy(null)
    if (!result.ok) {
      setError(result.error)
    } else if (successInfo) {
      showInfo(successInfo(result.data))
    }
    await refresh()
  }

  const commit = (): void => {
    if (busy !== null || !message.trim() || !status || status.staged.length === 0) return
    void run(
      'commit',
      () => window.api.gitCommit(message.trim()),
      () => 'Committed.'
    ).then(() => setMessage(''))
  }

  if (!status) {
    return (
      <div className="git-panel">
        <div className="panel-header">
          <span className="panel-title-caps">Source Control</span>
        </div>
        <p className="muted pad">Loading…</p>
      </div>
    )
  }

  if (!status.isRepo) {
    return (
      <div className="git-panel">
        <div className="panel-header">
          <span className="panel-title-caps">Source Control</span>
        </div>
        <div className="scm-empty">
          <p className="muted small-text">This project is not a git repository yet.</p>
          <button
            className="btn btn-primary scm-wide-btn"
            disabled={busy !== null}
            onClick={() => void run('init', () => window.api.gitInit())}
          >
            Initialize Repository
          </button>
          {error && <div className="error-banner small">{error}</div>}
        </div>
      </div>
    )
  }

  const changeRow = (change: GitChange): React.JSX.Element => {
    const { name, dir } = splitPath(change.path)
    const letter = change.status === '?' ? 'U' : change.status
    return (
      <div key={`${change.staged}-${change.path}`} className="change-row" title={change.path}>
        <span className="tree-icon">
          <FileIcon size={13} />
        </span>
        <span className="change-name">{name}</span>
        {dir && <span className="change-dir">{dir}</span>}
        <span className="row-actions">
          {change.staged ? (
            <button
              className="row-btn"
              title="Unstage change"
              onClick={() => void run('unstage', () => window.api.gitUnstage([change.path]))}
            >
              <MinusIcon size={12} />
            </button>
          ) : (
            <>
              <DiscardButton onConfirm={() => void run('discard', () => window.api.gitDiscard(change))} />
              <button
                className="row-btn"
                title="Stage change"
                onClick={() => void run('stage', () => window.api.gitStage([change.path]))}
              >
                <PlusIcon size={12} />
              </button>
            </>
          )}
        </span>
        <span className={`change-status s-${letter}`} title={STATUS_LABEL[change.status] ?? change.status}>
          {letter}
        </span>
      </div>
    )
  }

  const noRemote = status.remotes.length === 0

  return (
    <div className="git-panel">
      <div className="panel-header">
        <span className="panel-title-caps">Source Control</span>
        <span className="header-actions push-right">
          <button
            className="icon-btn sm"
            disabled={busy !== null || noRemote}
            title={noRemote ? 'Add a remote first' : 'Pull'}
            onClick={() => void run('pull', () => window.api.gitPull(), (d) => String(d))}
          >
            <DownArrowIcon size={14} />
          </button>
          <button
            className="icon-btn sm"
            disabled={busy !== null || noRemote}
            title={noRemote ? 'Add a remote first' : 'Push'}
            onClick={() => void run('push', () => window.api.gitPush(), () => 'Pushed to remote.')}
          >
            <UpArrowIcon size={14} />
          </button>
          <button className="icon-btn sm" title="Refresh" onClick={() => void refresh()}>
            <RefreshIcon size={14} />
          </button>
        </span>
      </div>

      <div className="scm-branch-row" title={status.upstream ?? 'No upstream branch'}>
        <GitBranchIcon size={13} />
        <span className="scm-branch-name">{status.branch || '(no branch)'}</span>
        {(status.ahead > 0 || status.behind > 0) && (
          <span className="scm-aheadbehind">
            {status.behind > 0 && `${status.behind}↓`} {status.ahead > 0 && `${status.ahead}↑`}
          </span>
        )}
        {busy && <span className="scm-busy">{busy}…</span>}
      </div>

      <div className="commit-box">
        <textarea
          className="commit-input"
          rows={1}
          placeholder={`Message (⌘Enter to commit on "${status.branch}")`}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              commit()
            }
          }}
        />
        <button
          className="btn btn-primary scm-wide-btn"
          disabled={busy !== null || !message.trim() || status.staged.length === 0}
          title={status.staged.length === 0 ? 'Stage changes first' : 'Commit staged changes'}
          onClick={commit}
        >
          <CheckIcon size={13} /> {busy === 'commit' ? 'Committing…' : 'Commit'}
        </button>
      </div>

      {error && <div className="error-banner small">{error}</div>}
      {info && <div className="success-banner">{info}</div>}

      <div className="git-scroll">
        {status.staged.length > 0 && (
          <Section
            title="Staged Changes"
            count={status.staged.length}
            actions={
              <button
                className="row-btn"
                title="Unstage all changes"
                onClick={() => void run('unstage', () => window.api.gitUnstage(status.staged.map((c) => c.path)))}
              >
                <MinusIcon size={12} />
              </button>
            }
          >
            {status.staged.map(changeRow)}
          </Section>
        )}

        <Section
          title="Changes"
          count={status.unstaged.length}
          actions={
            status.unstaged.length > 0 ? (
              <button
                className="row-btn"
                title="Stage all changes"
                onClick={() => void run('stage', () => window.api.gitStage(status.unstaged.map((c) => c.path)))}
              >
                <PlusIcon size={12} />
              </button>
            ) : undefined
          }
        >
          {status.unstaged.length === 0 ? (
            <p className="muted scm-note">No changes.</p>
          ) : (
            status.unstaged.map(changeRow)
          )}
        </Section>

        <Section title="Remote">
          {noRemote ? (
            <div className="remote-box">
              <p className="muted scm-note">Add a remote (e.g. a GitHub repository URL) to push your game online.</p>
              <input
                className="text-input"
                placeholder="https://github.com/you/your-game.git"
                value={remoteUrl}
                onChange={(e) => setRemoteUrl(e.target.value)}
              />
              <button
                className="btn btn-ghost scm-wide-btn"
                disabled={busy !== null || !remoteUrl.trim()}
                onClick={() =>
                  void run(
                    'remote',
                    () => window.api.gitAddRemote(remoteUrl.trim()),
                    () => 'Remote added. Use Push to publish your branch.'
                  ).then(() => setRemoteUrl(''))
                }
              >
                Add Remote
              </button>
            </div>
          ) : (
            status.remotes.map((remote) => (
              <div key={remote.name} className="change-row" title={remote.url}>
                <span className="tree-icon">
                  <GitBranchIcon size={13} />
                </span>
                <span className="change-name">{remote.name}</span>
                <span className="change-dir">{remote.url}</span>
              </div>
            ))
          )}
        </Section>

        {history.length > 0 && (
          <Section title="History">
            {history.map((commit_) => (
              <div key={commit_.hash} className="change-row history" title={commit_.subject}>
                <span className="hash">{commit_.hash}</span>
                <span className="change-name normal">{commit_.subject}</span>
              </div>
            ))}
          </Section>
        )}
      </div>
    </div>
  )
}
