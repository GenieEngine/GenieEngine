interface Props {
  value: boolean
  onChange: (value: boolean) => void
}

const FEATURES = ['ECS viewer', 'Files sidebar', 'Git sidebar', 'Console output']

const TOOLTIP_TEXT =
  `Advanced mode is for software engineers and game developers. It adds: ${FEATURES.join(', ')}. ` +
  "You are not limited in what you can create if you don't turn on the advanced view."

/**
 * Shown on both the welcome screen and the editor title bar (left of the
 * settings gear) so its state — and meaning — stays consistent everywhere.
 *
 * The hover explanation is real markup shown via the `.has-tooltip` CSS
 * pattern, not the native `title` attribute — `title` silently never shows
 * in this app's frameless macOS window.
 */
export function AdvancedToggle({ value, onChange }: Props): React.JSX.Element {
  return (
    <label className="toggle-row has-tooltip" aria-label={TOOLTIP_TEXT}>
      <span className="toggle-label">Advanced</span>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        className={value ? 'toggle-switch on' : 'toggle-switch'}
        onClick={() => onChange(!value)}
      >
        <span className="toggle-switch-knob" />
      </button>
      <div className="tooltip-bubble">
        <p>Advanced mode is for software engineers and game developers.</p>
        <p>It adds:</p>
        <ul>
          {FEATURES.map((feature) => (
            <li key={feature}>{feature}</li>
          ))}
        </ul>
        <p>You are not limited in what you can create if you don&apos;t turn on the advanced view.</p>
      </div>
    </label>
  )
}
