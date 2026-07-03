# OpenGenie

OpenGenie is an AI-powered game engine that enables anyone to build their own video games by
describing them in plain language. Games are real [Godot 4](https://godotengine.org) projects
under the hood, and the AI assistant is powered by the [OpenCode](https://opencode.ai) CLI.

## Layout

- **Game view (center)** — press Run and the full desktop engine runs embedded in the OpenGenie
  window via Godot 4.7's embedded display server (the same mechanism the Godot editor uses for its
  in-editor game view on macOS): the game process draws into a cross-process CoreAnimation context
  that OpenGenie composites with a small native addon (`native/layerhost`), while input and display
  state travel over Godot's debugger protocol (`src/main/services/godot-wire.ts`, `godot-embed.ts`,
  `godot-input-codec.ts`). Works in macOS fullscreen. macOS-only for now. Console output (including
  the game's own prints) streams into the Output panel.
- **Workspace sidebar (right)** with three tabs:
  - **Chat** — talk to the AI assistant (OpenCode, via its headless server API). Responses stream
    live, including the tools the agent runs (file edits, shell commands) shown as activity chips.
    The assistant can also **test games itself**: an MCP server (`resources/mcp-bridge.mjs`,
    auto-registered in the global OpenCode config, backed by a local HTTP harness in the app)
    gives it tools to run the game off-screen (full engine, no window), send scripted input,
    capture screenshots, query scene-tree state with GDScript expressions, and read logs —
    so it can verify its changes actually work before reporting back.
  - **Files** — browse the project, plus buttons to open the codebase in **VS Code** or the
    **Godot editor**.
  - **Git** — VS Code-style source control: stage, commit, add a remote, push and pull.

New games are scaffolded as runnable Godot projects (with an `AGENTS.md` so the AI has context)
and initialized as git repositories. The welcome screen lets you choose where the game's source
code is stored, and the Git tab lets you publish it to any remote (e.g. GitHub).

## Batteries included

OpenGenie is fully self-contained — installed builds ship with everything the user needs:

- **Godot 4.7** — downloaded into `vendor/` by `scripts/fetch-vendor.mjs` (runs automatically on
  `npm install`) and packaged into the app's resources by electron-builder.
- **git** — embedded via [dugite](https://github.com/desktop/dugite) (the same embedded git that
  GitHub Desktop ships). A system git is preferred when present because it carries the user's
  credential helpers; otherwise the bundled git is used, with a default commit identity fallback.
- **OpenCode CLI** — bundled the same way as Godot (users still sign in to their AI provider on
  first use).

**VS Code is the only external app** — and only if the user wants the "Open in VS Code" button.

## Development

Requires Node.js 18+.

```sh
npm install        # installs deps + downloads bundled engines (~500 MB)
npm run dev        # launch OpenGenie with hot reload
npm run typecheck  # typecheck main + preload + renderer
npm run build      # production build to out/
npm run dist       # package a distributable (dmg/zip on macOS) into dist/
npm run setup      # re-download bundled engines if vendor/ is missing
```

Note: `fetch-vendor` downloads engines for the current platform only, so distributables are built
per-OS (standard Electron practice).

## Architecture

```
src/
  shared/types.ts        # IPC contract shared by all processes
  main/                  # Electron main process
    index.ts             # window creation, lifecycle
    ipc.ts               # all IPC handlers (Result-envelope wrapped)
    state.ts             # settings persistence, current project
    services/
      binaries.ts        # PATH fixing + godot/opencode/code discovery
      projects.ts        # create/open projects (Godot scaffolding)
      templates.ts       # new-project file templates
      game.ts            # embedded native runs + AI test runs (layerhost)
      godot-wire.ts      # Godot debugger protocol (variant codec, framing)
      godot-embed.ts     # embedded-game session over the debugger channel
      godot-input-codec.ts # DOM input -> Godot InputEvent bytes
      test-harness.ts    # HTTP API behind the MCP game-testing tools
      opencode.ts        # AI chat via headless opencode server (SSE)
      git.ts             # git status/stage/commit/push/pull (porcelain v2)
      files.ts           # file tree listing, open in VS Code
  preload/               # contextBridge API (window.api)
  renderer/              # React UI (dark mode)
    src/components/      # TitleBar, Welcome, GameView, Workspace,
                         # ChatPanel, FilesPanel, GitPanel
```
