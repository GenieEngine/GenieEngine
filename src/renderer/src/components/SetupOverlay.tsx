import { useState } from 'react'
import type { SetupStatus } from '../../../shared/types'
import { SparkIcon, XIcon } from './Icons'

interface Props {
  status: SetupStatus
  onConfigured: (status: SetupStatus) => void
  /** Present when the panel was opened from the gear (already configured) — shows a close button. */
  onClose?: () => void
}

type SetupTab = 'agent' | '2d' | '3d'

const TABS: { id: SetupTab; label: string }[] = [
  { id: 'agent', label: 'Coding Agent' },
  { id: '2d', label: '2D Asset Generation (Optional)' },
  { id: '3d', label: '3D Asset Generation (Optional)' }
]

/**
 * Stands in for a credential input once it's already configured, so a
 * stored key is never blanked out by opening the panel and hitting Save —
 * the actual field only appears once the user asks to change it.
 */
function ConfiguredButton({ onClick }: { onClick: () => void }): React.JSX.Element {
  return (
    <button type="button" className="btn btn-ghost setup-configured-btn" onClick={onClick}>
      Already configured. Click to update.
    </button>
  )
}

/**
 * AI provider setup, shown over a darkened chat until the assistant is
 * connected (and reopenable later from the sidebar gear). Three tabs:
 * the coding agent (any OpenAI-compatible endpoint + model + key, defaults
 * to OpenRouter + Kimi K2.7 Code), optional 2D asset generation (OpenAI
 * gpt-image-1.5) and optional 3D asset generation (Tencent HY 3D).
 */
export function SetupOverlay({ status, onConfigured, onClose }: Props): React.JSX.Element {
  const [tab, setTab] = useState<SetupTab>('agent')
  const [endpoint, setEndpoint] = useState(status.endpoint)
  const [model, setModel] = useState(status.model)
  const [apiKey, setApiKey] = useState('')
  const [tencentId, setTencentId] = useState('')
  const [tencentKey, setTencentKey] = useState('')
  const [openaiKey, setOpenaiKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Each already-configured credential starts hidden behind a button — the
  // field only appears once the user explicitly asks to change it, so
  // opening the panel and hitting Save can never blank out a stored key.
  const [providerKeyRevealed, setProviderKeyRevealed] = useState(!status.configured)
  const [tencentRevealed, setTencentRevealed] = useState(!status.hy3dConfigured)
  const [openaiKeyRevealed, setOpenaiKeyRevealed] = useState(!status.gptImageConfigured)

  // Save applies every tab at once, so a validation error may concern a tab
  // the user isn't looking at — switch to it so the message makes sense.
  const fail = (message: string, where: SetupTab): void => {
    setError(message)
    setTab(where)
  }

  const save = async (): Promise<void> => {
    // A provider key is only mandatory on first-time setup; when reopened via
    // the gear the user may just be adding asset-generation credentials.
    if (!apiKey.trim() && !status.configured) {
      fail('An API key is required to connect the assistant.', 'agent')
      return
    }
    if (!!tencentId.trim() !== !!tencentKey.trim()) {
      fail('Enter both the Tencent SecretId and SecretKey (or leave both blank).', '3d')
      return
    }
    setBusy(true)
    setError(null)
    const result = await window.api.saveSetup(endpoint, model, apiKey, tencentId, tencentKey, openaiKey)
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
    } else if (result.data.configured) {
      onConfigured(result.data)
      onClose?.()
    } else {
      setError('That endpoint still has no usable credential — double-check the API key.')
    }
  }

  return (
    <div className="setup-overlay">
      <div className="setup-card">
        {onClose && (
          <button className="icon-btn setup-close" onClick={onClose} title="Close">
            <XIcon size={12} />
          </button>
        )}
        <div className="setup-head">
          <span className="setup-icon">
            <SparkIcon size={18} />
          </span>
          <div>
            <h2 className="setup-title">{status.configured ? 'AI settings' : 'Connect your AI assistant'}</h2>
            <p className="setup-sub">
              OpenGenie's assistant is powered by OpenCode. Point it at an API endpoint and paste a
              key to get started.
            </p>
          </div>
        </div>

        <div className="setup-tabs" role="tablist">
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={`setup-tab${tab === id ? ' active' : ''}`}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'agent' && (
          <>
            <label className="setup-field">
              <span className="setup-label">API endpoint</span>
              <input
                className="text-input"
                value={endpoint}
                spellCheck={false}
                autoCapitalize="off"
                onChange={(e) => setEndpoint(e.target.value)}
                placeholder="https://openrouter.ai/api/v1"
              />
              <span className="setup-hint">Any OpenAI-compatible API endpoint will work.</span>
            </label>

            <label className="setup-field">
              <span className="setup-label">Model</span>
              <input
                className="text-input"
                value={model}
                spellCheck={false}
                autoCapitalize="off"
                onChange={(e) => setModel(e.target.value)}
                placeholder="moonshotai/kimi-k2.7-code"
              />
            </label>

            <div className="setup-field">
              <span className="setup-label">API key</span>
              {status.configured && !providerKeyRevealed ? (
                <ConfiguredButton onClick={() => setProviderKeyRevealed(true)} />
              ) : (
                <input
                  className="text-input"
                  type="password"
                  value={apiKey}
                  spellCheck={false}
                  autoComplete="off"
                  autoFocus={status.configured}
                  onChange={(e) => setApiKey(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void save()}
                  placeholder={status.configured ? 'Leave blank to keep the stored key' : 'Your API key'}
                />
              )}
              <span className="setup-hint">
                Stored locally in OpenCode's credential file — it never leaves your machine or
                enters your game's code.
              </span>
            </div>
          </>
        )}

        {tab === '2d' && (
          <>
            <span className="setup-hint">
              Add an OpenAI API key to let the assistant generate 2D art — sprites, icons, UI — as
              transparent 1024×1024 PNGs saved into your game's assets folder. Only OpenAI's
              gpt-image-1.5 model is supported right now.
            </span>

            <div className="setup-field">
              <span className="setup-label">OpenAI API key</span>
              {status.gptImageConfigured && !openaiKeyRevealed ? (
                <ConfiguredButton onClick={() => setOpenaiKeyRevealed(true)} />
              ) : (
                <input
                  className="text-input"
                  type="password"
                  value={openaiKey}
                  spellCheck={false}
                  autoComplete="off"
                  autoFocus={status.gptImageConfigured}
                  onChange={(e) => setOpenaiKey(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void save()}
                  placeholder={status.gptImageConfigured ? 'Leave blank to keep the stored key' : 'sk-…'}
                />
              )}
            </div>
          </>
        )}

        {tab === '3d' && (
          <>
            <span className="setup-hint">
              Add Tencent Cloud credentials to let the assistant generate 3D models saved into your
              game's assets folder. Only Tencent's HY 3D model is supported right now.
            </span>

            {status.hy3dConfigured && !tencentRevealed ? (
              <div className="setup-field">
                <span className="setup-label">Tencent credentials</span>
                <ConfiguredButton onClick={() => setTencentRevealed(true)} />
              </div>
            ) : (
              <>
                <label className="setup-field">
                  <span className="setup-label">Tencent SecretId</span>
                  <input
                    className="text-input"
                    value={tencentId}
                    spellCheck={false}
                    autoCapitalize="off"
                    autoComplete="off"
                    autoFocus={status.hy3dConfigured}
                    onChange={(e) => setTencentId(e.target.value)}
                    placeholder={status.hy3dConfigured ? 'Leave blank to keep the stored value' : 'AKID…'}
                  />
                </label>

                <label className="setup-field">
                  <span className="setup-label">Tencent SecretKey</span>
                  <input
                    className="text-input"
                    type="password"
                    value={tencentKey}
                    spellCheck={false}
                    autoComplete="off"
                    onChange={(e) => setTencentKey(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && void save()}
                    placeholder={status.hy3dConfigured ? 'Leave blank to keep the stored value' : 'Your Tencent Cloud SecretKey'}
                  />
                </label>
              </>
            )}
          </>
        )}

        {error && <div className="error-banner small">{error}</div>}

        <button className="btn btn-primary setup-connect" disabled={busy} onClick={() => void save()}>
          {busy ? 'Saving…' : status.configured ? 'Save' : 'Connect'}
        </button>
      </div>
    </div>
  )
}
