import discordMark from '../assets/discord.png'

const DISCORD_INVITE_URL = 'https://discord.gg/BC8fF2nr4y'

/**
 * Community invite button, shown next to the AdvancedToggle on both the
 * welcome screen and the editor title bar. A plain anchor: the main process
 * will-navigate handler blocks in-app navigation and hands external http(s)
 * URLs to the OS default browser.
 */
export function DiscordButton(): React.JSX.Element {
  return (
    <a className="btn btn-sm btn-discord" href={DISCORD_INVITE_URL}>
      <img src={discordMark} alt="" className="discord-mark" />
      Join Discord
    </a>
  )
}
