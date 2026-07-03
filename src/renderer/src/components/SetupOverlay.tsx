import { useState } from 'react'
import type { SetupStatus } from '../../../shared/types'
import { SparkIcon, XIcon } from './Icons'

interface Props {
  status: SetupStatus
  onConfigured: (status: SetupStatus) => void
  /** Present when the panel was opened from the gear (already configured) — shows a close button. */
  onClose?: () => void
}

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
 * connected (and reopenable later from the sidebar gear). Collects provider
 * (endpoint), model and API key — defaults to OpenRouter + Kimi K2.7 Code —
 * plus optional Tencent HY 3D credentials that enable the 3D asset
 * generation tool.
 */
export function SetupOverlay({ status, onConfigured, onClose }: Props): React.JSX.Element {
  const [provider, setProvider] = useState(status.provider)
  const [model, setModel] = useState(status.model)
  const [apiKey, setApiKey] = useState('')
  const [tencentId, setTencentId] = useState('')
  const [tencentKey, setTencentKey] = useState('')
  const [openaiKey, setOpenaiKey] = useState('')
  const [openaiModel, setOpenaiModel] = useState(status.gptImageModel)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Each already-configured credential starts hidden behind a button — the
  // field only appears once the user explicitly asks to change it, so
  // opening the panel and hitting Save can never blank out a stored key.
  const [providerKeyRevealed, setProviderKeyRevealed] = useState(!status.configured)
  const [tencentRevealed, setTencentRevealed] = useState(!status.hy3dConfigured)
  const [openaiKeyRevealed, setOpenaiKeyRevealed] = useState(!status.gptImageConfigured)

  const save = async (): Promise<void> => {
    // A provider key is only mandatory on first-time setup; when reopened via
    // the gear the user may just be adding Tencent credentials.
    if (!apiKey.trim() && !status.configured) {
      setError('An API key is required to connect the assistant.')
      return
    }
    if (!!tencentId.trim() !== !!tencentKey.trim()) {
      setError('Enter both the Tencent SecretId and SecretKey (or leave both blank).')
      return
    }
    setBusy(true)
    setError(null)
    const result = await window.api.saveSetup(provider, model, apiKey, tencentId, tencentKey, openaiKey, openaiModel)
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
    } else if (result.data.configured) {
      onConfigured(result.data)
      onClose?.()
    } else {
      setError('That provider still has no usable credential — double-check the API key.')
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
              OpenGenie's assistant is powered by OpenCode. Choose a provider and model and paste an
              API key to get started.
            </p>
          </div>
        </div>

        <label className="setup-field">
          <span className="setup-label">Provider</span>
          <input
            className="text-input"
            value={provider}
            spellCheck={false}
            autoCapitalize="off"
            onChange={(e) => setProvider(e.target.value)}
            placeholder="openrouter"
          />
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
              placeholder={status.configured ? 'Leave blank to keep the stored key' : `Your ${provider || 'provider'} API key`}
            />
          )}
          <span className="setup-hint">
            Stored locally in OpenCode's credential file — it never leaves your machine or enters
            your game's code.
          </span>
        </div>

        <div className="setup-section">
          <span className="setup-section-title">3D asset generation · optional</span>
          <span className="setup-hint">
            Add Tencent Cloud credentials to let the assistant generate 3D models with Tencent HY 3D
            (saved into your game's assets folder). Without them the assistant simply won't have the
            tool.
          </span>
        </div>

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
                placeholder={status.hy3dConfigured ? 'Leave blank to keep the stored value' : 'Your Tencent Cloud SecretKey'}
              />
            </label>
          </>
        )}

        <div className="setup-section">
          <span className="setup-section-title">2D image generation · optional</span>
          <span className="setup-hint">
            Add an OpenAI API key to let the assistant generate 2D art — sprites, icons, UI — as
            transparent 1024×1024 PNGs saved into your game's assets folder.
          </span>
        </div>

        <label className="setup-field">
          <span className="setup-label">Model</span>
          <input
            className="text-input"
            value={openaiModel}
            spellCheck={false}
            autoCapitalize="off"
            onChange={(e) => setOpenaiModel(e.target.value)}
            placeholder="gpt-image-1.5"
          />
        </label>

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

        {error && <div className="error-banner small">{error}</div>}

        <button className="btn btn-primary setup-connect" disabled={busy} onClick={() => void save()}>
          {busy ? 'Saving…' : status.configured ? 'Save' : 'Connect'}
        </button>
      </div>
    </div>
  )
}
