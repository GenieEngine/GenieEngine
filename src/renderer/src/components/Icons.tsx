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

/** Lucide's "settings" icon (lucide.dev/icons/settings), rescaled from its native 24x24 grid onto ours. */
export const GearIcon = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <g transform="translate(8 8) scale(0.6667) translate(-12 -12)">
      <path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" />
      <circle cx="12" cy="12" r="3" />
    </g>
  </Icon>
)

/** Official VS Code product icon (the folded-ribbon mark), reproduced faithfully in its brand colors. */
export const VSCodeLogoIcon = ({ size = 16 }: IconProps): React.JSX.Element => (
  <svg width={size} height={size} viewBox="0 0 128 128" aria-hidden="true">
    <mask
      id="vscode-logo-mask"
      width="128"
      height="128"
      x="0"
      y="0"
      maskUnits="userSpaceOnUse"
      style={{ maskType: 'alpha' }}
    >
      <path
        fill="#fff"
        fillRule="evenodd"
        d="M90.767 127.126a7.968 7.968 0 0 0 6.35-.244l26.353-12.681a8 8 0 0 0 4.53-7.209V21.009a8 8 0 0 0-4.53-7.21L97.117 1.12a7.97 7.97 0 0 0-9.093 1.548l-50.45 46.026L15.6 32.013a5.328 5.328 0 0 0-6.807.302l-7.048 6.411a5.335 5.335 0 0 0-.006 7.888L20.796 64 1.74 81.387a5.336 5.336 0 0 0 .006 7.887l7.048 6.411a5.327 5.327 0 0 0 6.807.303l21.974-16.68 50.45 46.025a7.96 7.96 0 0 0 2.743 1.793Zm5.252-92.183L57.74 64l38.28 29.058V34.943Z"
        clipRule="evenodd"
      />
    </mask>
    <g mask="url(#vscode-logo-mask)">
      <path
        fill="#0065A9"
        d="M123.471 13.82 97.097 1.12A7.973 7.973 0 0 0 88 2.668L1.662 81.387a5.333 5.333 0 0 0 .006 7.887l7.052 6.411a5.333 5.333 0 0 0 6.811.303l103.971-78.875c3.488-2.646 8.498-.158 8.498 4.22v-.306a8.001 8.001 0 0 0-4.529-7.208Z"
      />
      <path
        fill="#007ACC"
        d="m123.471 114.181-26.374 12.698A7.973 7.973 0 0 1 88 125.333L1.662 46.613a5.333 5.333 0 0 1 .006-7.887l7.052-6.411a5.333 5.333 0 0 1 6.811-.303l103.971 78.874c3.488 2.647 8.498.159 8.498-4.219v.306a8.001 8.001 0 0 1-4.529 7.208Z"
      />
      <path
        fill="#1F9CF0"
        d="M97.098 126.882A7.977 7.977 0 0 1 88 125.333c2.952 2.952 8 .861 8-3.314V5.98c0-4.175-5.048-6.266-8-3.313a7.977 7.977 0 0 1 9.098-1.549L123.467 13.8A8 8 0 0 1 128 21.01v85.982a8 8 0 0 1-4.533 7.21l-26.369 12.681Z"
      />
      <path
        fill="url(#vscode-logo-shine)"
        fillRule="evenodd"
        d="M90.69 127.126a7.968 7.968 0 0 0 6.349-.244l26.353-12.681a8 8 0 0 0 4.53-7.21V21.009a8 8 0 0 0-4.53-7.21L97.039 1.12a7.97 7.97 0 0 0-9.093 1.548l-50.45 46.026-21.974-16.68a5.328 5.328 0 0 0-6.807.302l-7.048 6.411a5.336 5.336 0 0 0-.006 7.888L20.718 64 1.662 81.386a5.335 5.335 0 0 0 .006 7.888l7.048 6.411a5.328 5.328 0 0 0 6.807.303l21.975-16.681 50.45 46.026a7.959 7.959 0 0 0 2.742 1.793Zm5.252-92.184L57.662 64l38.28 29.057V34.943Z"
        clipRule="evenodd"
        opacity="0.25"
        style={{ mixBlendMode: 'overlay' }}
      />
    </g>
    <defs>
      <linearGradient
        id="vscode-logo-shine"
        x1="63.9222"
        x2="63.9222"
        y1="0.329902"
        y2="127.67"
        gradientUnits="userSpaceOnUse"
      >
        <stop stopColor="#fff" />
        <stop offset="1" stopColor="#fff" stopOpacity="0" />
      </linearGradient>
    </defs>
  </svg>
)

/** Godot Engine's "robot head" mark, in the engine's brand blue. */
export const GodotLogoIcon = ({ size = 16 }: IconProps): React.JSX.Element => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="#478CBF" aria-hidden="true">
    <path d="M9.5598.683c-1.096.244-2.1812.5831-3.1983 1.0951.023.8981.081 1.7582.199 2.6323-.395.253-.81.47-1.178.766-.375.288-.7581.564-1.0971.9011-.6781-.448-1.3962-.869-2.1352-1.2411C1.3532 5.6934.608 6.6186 0 7.6546c.458.7411.936 1.4352 1.4521 2.0942h.014v6.3565c.012 0 .023 0 .035.003l3.8963.376c.204.02.364.184.378.3891l.12 1.7201 3.3994.242.234-1.587c.03-.206.207-.358.415-.358h4.1114c.208 0 .385.152.415.358l.234 1.587 3.3993-.242.12-1.72a.4196.4196 0 01.378-.3891l3.8954-.376c.012 0 .023-.003.035-.003v-.5071h.002V9.7498h.014c.516-.659.994-1.3531 1.4521-2.0942-.608-1.036-1.3541-1.9611-2.1512-2.8192-.739.372-1.4571.793-2.1352 1.2411-.339-.337-.721-.613-1.096-.901-.369-.296-.7841-.5131-1.1781-.7661.117-.8741.175-1.7342.199-2.6323-1.0171-.512-2.1012-.851-3.1983-1.095-.438.736-.838 1.533-1.1871 2.3121-.414-.069-.829-.094-1.2461-.099h-.016c-.417.005-.832.03-1.2461.099-.349-.779-.749-1.576-1.1881-2.3121l.001-.001zM6.4765 9.9889c1.2971 0 2.3492 1.0511 2.3492 2.3482s-1.052 2.3482-2.3492 2.3482c-1.296 0-2.3482-1.051-2.3482-2.3482 0-1.297 1.0511-2.3482 2.3482-2.3482zm11.049 0c1.296 0 2.3482 1.0511 2.3482 2.3482s-1.0511 2.3482-2.3482 2.3482-2.3492-1.051-2.3492-2.3482c0-1.297 1.051-2.3482 2.3492-2.3482zm-10.824.9301c-.861 0-1.559.698-1.559 1.5591s.698 1.5582 1.559 1.5582c.8611 0 1.5592-.698 1.5592-1.5582 0-.86-.697-1.559-1.5591-1.559zm10.598 0c-.8611 0-1.5582.698-1.5582 1.5591s.697 1.5582 1.5581 1.5582c.8611 0 1.5592-.698 1.5592-1.5582 0-.86-.697-1.559-1.5592-1.559zm-5.2985.453c.417 0 .757.308.757.6871v2.1622c0 .379-.339.687-.757.687s-.756-.308-.756-.687V12.059c0-.379.339-.687.756-.687zM1.4601 16.9464c.002.377.006.789.006.871 0 3.7014 4.6944 5.4795 10.5269 5.5005h.014c5.8325-.02 10.5259-1.7991 10.5259-5.5004 0-.084.005-.495.007-.871l-3.5023.338-.121 1.729a.421.421 0 01-.389.3901l-4.1814.296a.4203.4203 0 01-.415-.358l-.238-1.6141h-3.3863l-.238 1.6141a.4192.4192 0 01-.4451.357l-4.1513-.296c-.208-.015-.375-.181-.389-.389l-.12-1.7292-3.5044-.337z" />
  </svg>
)
