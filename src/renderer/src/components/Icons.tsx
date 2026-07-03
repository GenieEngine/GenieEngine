/** Minimal stroke icon set (16px grid) so the app has zero icon dependencies. */

interface IconProps {
  size?: number
}

function Icon({ size = 16, children }: IconProps & { children: React.ReactNode }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export const PlayIcon = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M4.5 2.5l8 5.5-8 5.5z" fill="currentColor" stroke="none" />
  </Icon>
)

export const StopIcon = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <rect x="3.5" y="3.5" width="9" height="9" rx="1.5" fill="currentColor" stroke="none" />
  </Icon>
)

export const ChevronIcon = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M6 3.5L10.5 8 6 12.5" />
  </Icon>
)

export const FolderIcon = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M1.5 4a1 1 0 011-1h3l1.5 2h6.5a1 1 0 011 1v6a1 1 0 01-1 1h-11a1 1 0 01-1-1z" />
  </Icon>
)

export const FileIcon = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M4 1.5h5.5L12.5 5v9a.5.5 0 01-.5.5H4a.5.5 0 01-.5-.5V2a.5.5 0 01.5-.5z" />
    <path d="M9.5 1.5V5H13" />
  </Icon>
)

export const SparkIcon = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M8 1.5l1.6 4.3L14 7.5l-4.4 1.7L8 13.5 6.4 9.2 2 7.5l4.4-1.7z" />
  </Icon>
)

export const GitBranchIcon = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <circle cx="4.5" cy="3.5" r="1.8" />
    <circle cx="4.5" cy="12.5" r="1.8" />
    <circle cx="11.5" cy="5" r="1.8" />
    <path d="M4.5 5.3v5.4M11.5 6.8c0 2.5-3 3-5.2 3.6" />
  </Icon>
)

export const PlusIcon = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M8 3.5v9M3.5 8h9" />
  </Icon>
)

export const MinusIcon = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M3.5 8h9" />
  </Icon>
)

export const UndoIcon = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M3 6.5h7a3.5 3.5 0 010 7H6" />
    <path d="M5.5 4L3 6.5 5.5 9" />
  </Icon>
)

export const RefreshIcon = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M13.5 8a5.5 5.5 0 11-1.6-3.9" />
    <path d="M13.5 1.5v3h-3" />
  </Icon>
)

export const UpArrowIcon = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M8 13V3M4 7l4-4 4 4" />
  </Icon>
)

export const DownArrowIcon = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M8 3v10M4 9l4 4 4-4" />
  </Icon>
)

export const SendIcon = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M8 12.5v-9M4.5 7L8 3.5 11.5 7" />
  </Icon>
)

export const HomeIcon = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M2.5 7.5L8 2.5l5.5 5M4 6.8V13a.5.5 0 00.5.5h7a.5.5 0 00.5-.5V6.8" />
  </Icon>
)

export const ExternalIcon = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M6.5 3.5H3a.5.5 0 00-.5.5v9a.5.5 0 00.5.5h9a.5.5 0 00.5-.5V9.5" />
    <path d="M9.5 2.5h4v4M13.5 2.5L7.5 8.5" />
  </Icon>
)

export const XIcon = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </Icon>
)

export const TerminalIcon = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
    <path d="M4.5 6l2.5 2-2.5 2M8.5 10.5H12" />
  </Icon>
)

export const SearchIcon = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <circle cx="7" cy="7" r="4.5" />
    <path d="M10.5 10.5L14 14" />
  </Icon>
)

export const CheckIcon = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M2.5 8.5l4 4 7-8" />
  </Icon>
)

export const FolderOpenIcon = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M1.5 4a1 1 0 011-1h3l1.5 2h6a1 1 0 011 1v1h-11l-1.5 5z" />
    <path d="M2.5 12h10.4a1 1 0 00.96-.72L15 7h-12z" />
  </Icon>
)

export const CollapseAllIcon = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <rect x="4.5" y="4.5" width="9" height="9" rx="1" />
    <path d="M7 9h4" />
    <path d="M2 11V3a1 1 0 011-1h8" />
  </Icon>
)

export const AspectAnyIcon = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M9.5 2.5H13.5V6.5M6.5 13.5H2.5V9.5M13.5 2.5L9.5 6.5M2.5 13.5L6.5 9.5" />
  </Icon>
)

export const MonitorIcon = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <rect x="1.5" y="3" width="13" height="8" rx="1.2" />
    <path d="M6 13.5h4M8 11v2.5" />
  </Icon>
)

export const PhonePortraitIcon = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <rect x="4.5" y="1.5" width="7" height="13" rx="1.5" />
    <path d="M7 12.5h2" />
  </Icon>
)

export const PhoneLandscapeIcon = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <rect x="1.5" y="4.5" width="13" height="7" rx="1.5" />
    <path d="M12.5 7v2" />
  </Icon>
)

export const ShareIcon = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M8 10V2.5M5 5l3-3 3 3" />
    <path d="M3 8v5a1 1 0 001 1h8a1 1 0 001-1V8" />
  </Icon>
)

export const WindowsIcon = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M2.5 4.5l4.5-.8v3.8H2.5zM8.5 3.5l5-.9v4.9h-5zM2.5 8.5H7v3.8l-4.5-.8zM8.5 8.5h5v4.9l-5-.9z" />
  </Icon>
)

export const AppleIcon = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M10.7 4.6c-.9 0-1.9.6-2.7.6-.8 0-1.7-.6-2.6-.6C3.9 4.6 2.5 6 2.5 8.6c0 2.7 1.9 5.4 3.2 5.4.7 0 1.4-.5 2.3-.5s1.5.5 2.3.5c1.3 0 3.2-2.8 3.2-4.5-1.2-.6-1.8-1.5-1.8-2.6 0-1 .5-1.8 1-2.3-.5 0-1.3-.4-2 0z" />
    <path d="M8 4.2c.9-.2 1.9-1.2 1.8-2.7-1 .2-2 1.3-1.8 2.7z" />
  </Icon>
)

export const LinuxIcon = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M8 1.5c-2 0-2.8 1.4-2.8 3 0 1.5-.5 2.3-1.2 3.5-.8 1.3-1.5 3-1 4.5.4 1.2 2 1 3 1.4 1.2.5 2.8.5 4 0 1-.4 2.6-.2 3-1.4.5-1.5-.2-3.2-1-4.5-.7-1.2-1.2-2-1.2-3.5 0-1.6-.8-3-2.8-3z" />
    <path d="M6.5 5.2h.01M9.5 5.2h.01" />
  </Icon>
)

export const AndroidIcon = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M3 11a5 5 0 0110 0z" />
    <path d="M4.5 4.5L3.5 3M11.5 4.5l1-1.5M6 8.5h.01M10 8.5h.01" />
  </Icon>
)

export const GlobeIcon = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <circle cx="8" cy="8" r="6" />
    <path d="M2 8h12M8 2c-1.8 1.7-2.6 3.8-2.6 6S6.2 12.3 8 14c1.8-1.7 2.6-3.8 2.6-6S9.8 3.7 8 2z" />
  </Icon>
)
