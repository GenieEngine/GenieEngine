import { useState } from 'react'
import type { SetupStatus } from '../../../shared/types'
import { SparkIcon } from './Icons'

interface Props {
  status: SetupStatus
  onConfigured: (status: SetupStatus) => void
}

/**
 * First-run provider setup, shown over a darkened chat until the AI is
 * connected. Collects provider (endpoint), model and API key; defaults to
 * OpenRouter + Kimi K2.7 Code but every field is editable.
 */
export function SetupOverlay({ status, onConfigured }: Props): React.JSX.Element {
  const [provider, setProvider] = useState(status.provider)
  const [model, setModel] = useState(status.model)
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const connect = async (): Promise<void> => {
    if (!apiKey.trim()) {
      setError('An API key is required to connect the assistant.')
      return
    }
    setBusy(true)
    setError(null)
    const result = await window.api.saveSetup(provider, model, apiKey)
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
    } else if (result.data.configured) {
      onConfigured(result.data)
    } else {
      setError('That provider still has no usable credential — double-check the API key.')
    }
  }

  return (
    <div className="setup-overlay">
      <div className="setup-card">
        <div className="setup-head">
          <span className="setup-icon">
            <SparkIcon size={18} />
          </span>
          <div>
            <h2 className="setup-title">Connect your AI assistant</h2>
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

        <label className="setup-field">
          <span className="setup-label">API key</span>
          <input
            className="text-input"
            type="password"
            value={apiKey}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => setApiKey(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void connect()}
            placeholder={`Your ${provider || 'provider'} API key`}
          />
          <span className="setup-hint">
            Stored locally in OpenCode's credential file — it never leaves your machine or enters
            your game's code.
          </span>
        </label>

        {error && <div className="error-banner small">{error}</div>}

        <button className="btn btn-primary setup-connect" disabled={busy} onClick={() => void connect()}>
          {busy ? 'Connecting…' : 'Connect'}
        </button>
      </div>
    </div>
  )
}
