import { useEffect, useState } from 'react'
import type { ExportPlatform, ExportProgress } from '../../../shared/types'
import { AndroidIcon, AppleIcon, CheckIcon, GlobeIcon, LinuxIcon, WindowsIcon, XIcon } from './Icons'

interface Props {
  projectName: string
  onClose: () => void
}

const PLATFORMS: { id: ExportPlatform; label: string; icon: React.JSX.Element; note?: string }[] = [
  { id: 'macos', label: 'macOS', icon: <AppleIcon size={15} /> },
  { id: 'windows', label: 'Windows', icon: <WindowsIcon size={15} /> },
  { id: 'linux', label: 'Linux', icon: <LinuxIcon size={15} /> },
  { id: 'web', label: 'Web', icon: <GlobeIcon size={15} /> },
  { id: 'android', label: 'Android', icon: <AndroidIcon size={15} />, note: 'needs Android SDK' },
  { id: 'ios', label: 'iOS', icon: <AppleIcon size={15} />, note: 'needs Xcode' }
]

type PlatformState = { status: 'idle' | 'exporting' | 'success' | 'error'; message?: string }

export function ExportModal({ projectName, onClose }: Props): React.JSX.Element {
  const [name, setName] = useState(projectName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'game')
  const [selected, setSelected] = useState<Set<ExportPlatform>>(new Set(['macos']))
  const [running, setRunning] = useState(false)
  const [templates, setTemplates] = useState<{ message: string; percent: number } | null>(null)
  const [states, setStates] = useState<Partial<Record<ExportPlatform, PlatformState>>>({})
  const [doneMessage, setDoneMessage] = useState<string | null>(null)

  useEffect(
    () =>
      window.api.onExportProgress((update: ExportProgress) => {
        if (update.phase === 'templates') {
          setTemplates({ message: update.message, percent: update.percent })
        } else if (update.phase === 'platform') {
          setTemplates(null)
          setStates((prev) => ({ ...prev, [update.platform]: { status: update.status, message: update.message } }))
        } else if (update.phase === 'done') {
          setTemplates(null)
          setRunning(false)
          setDoneMessage(update.message ?? null)
        }
      }),
    []
  )

  const toggle = (id: ExportPlatform): void => {
    if (running) return
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const start = async (): Promise<void> => {
    if (running || selected.size === 0) return
    setRunning(true)
    setDoneMessage(null)
    setStates(Object.fromEntries([...selected].map((id) => [id, { status: 'idle' as const }])))
    const result = await window.api.exportGame(name, [...selected])
    if (!result.ok) {
      setRunning(false)
      setDoneMessage(result.error)
    }
  }

  const cancel = (): void => {
    void window.api.cancelExport()
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !running && onClose()}>
      <div className="modal-card">
        <div className="modal-head">
          <h2 className="modal-title">Export your game</h2>
          <button className="icon-btn" title="Close" onClick={onClose} disabled={running}>
            <XIcon size={13} />
          </button>
        </div>

        <label className="setup-field">
          <span className="setup-label">Output name</span>
          <input
            className="text-input"
            value={name}
            spellCheck={false}
            disabled={running}
            onChange={(e) => setName(e.target.value)}
          />
        </label>

        <div className="setup-field">
          <span className="setup-label">Platforms</span>
          <div className="platform-grid">
            {PLATFORMS.map((platform) => {
              const on = selected.has(platform.id)
              const state = states[platform.id]
              return (
                <button
                  key={platform.id}
                  className={on ? 'platform-tile selected' : 'platform-tile'}
                  onClick={() => toggle(platform.id)}
                  disabled={running}
                  title={platform.note}
                >
                  <span className="platform-icon">{platform.icon}</span>
                  <span className="platform-label">
                    {platform.label}
                    {platform.note && <span className="platform-note">{platform.note}</span>}
                  </span>
                  <span className="platform-status">
                    {state?.status === 'exporting' && <span className="spinner" />}
                    {state?.status === 'success' && (
                      <span className="ok">
                        <CheckIcon size={12} />
                      </span>
                    )}
                    {state?.status === 'error' && (
                      <span className="bad">
                        <XIcon size={11} />
                      </span>
                    )}
                    {!state && on && <CheckIcon size={12} />}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {templates && (
          <div className="export-templates">
            <div className="export-templates-msg">{templates.message}</div>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${templates.percent}%` }} />
            </div>
          </div>
        )}

        {Object.entries(states)
          .filter(([, s]) => s.message)
          .map(([id, s]) => (
            <div key={id} className={s.status === 'error' ? 'export-result bad' : 'export-result'}>
              <strong>{PLATFORMS.find((p) => p.id === id)?.label}:</strong>{' '}
              {s.status === 'success' ? (
                <>
                  exported.{' '}
                  <button className="link-btn" onClick={() => void window.api.revealExport(s.message!)}>
                    Reveal in Finder
                  </button>
                </>
              ) : (
                <span className="export-error-text">{s.message}</span>
              )}
            </div>
          ))}

        {doneMessage && <div className="error-banner small">{doneMessage}</div>}

        <div className="modal-actions">
          {running ? (
            <button className="btn btn-ghost" onClick={cancel}>
              Cancel export
            </button>
          ) : (
            <button className="btn btn-ghost" onClick={onClose}>
              Close
            </button>
          )}
          <button className="btn btn-primary" disabled={running || selected.size === 0} onClick={() => void start()}>
            {running ? 'Exporting…' : `Export${selected.size > 1 ? ` (${selected.size})` : ''}`}
          </button>
        </div>
      </div>
    </div>
  )
}
