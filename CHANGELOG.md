# Changelog

All notable changes to OpenGenie are documented here.

## [0.1.0] - 2026-07-06

### Added
- Native Godot game view embedded directly in the app window, with aspect-ratio presets, letterboxing, and a resizable output console
- AI chat panel backed by a per-project OpenCode server, with live-streamed responses, tool-activity indicators, file/image attachments, and slash commands
- First-run AI setup overlay — works with OpenRouter out of the box or any OpenAI-compatible endpoint
- The assistant can test games itself via MCP: off-screen runs, scripted input, screenshots, GDScript state probes, and console logs
- One-click export to all six Godot platforms, with export templates downloaded on demand
- Workspace sidebar with a VS Code-style file explorer and a full Git panel (stage/commit/push/pull, remotes, history)
- Buttons to open the current project directly in VS Code or the Godot editor
- "Advanced mode" toggle that reveals the ECS viewer, Files sidebar, Git sidebar, and console output for engineers, while keeping the default view simple
- 2D asset generation (sprites, icons, textures) via OpenAI image generation, saved straight into the project
- 3D asset generation via Tencent Hunyuan 3D, saved straight into the project
- ECS graph viewer showing entities, components, and systems as a linked diagram
- Interactive "question" tool — the assistant can ask multiple-choice questions mid-turn instead of guessing
- Per-project chat history and input recall (↑ / ↓) that persist across app restarts
- "Thinking…" indicator now shows a live elapsed-time counter when a model's reasoning text isn't available
- A turn interrupted by a lost internet connection can be resumed with "Continue" once back online

### Fixed
- Packaged builds could fail to launch because compiled code wasn't bundled into the app
- Project names containing control characters could inject arbitrary GDScript into `project.godot`
- Godot export presets set up in the editor (signing, keystores, icons) were being overwritten instead of merged on export
- Exporting only worked correctly on macOS — Windows and Linux now extract export templates with their own native tools
- Stopping a game run could be undone by a delayed exit event from a previously stopped run
- Links in the AI chat no longer navigate the whole app UI away — they now open in the system browser
- Running multiple OpenGenie instances no longer lets the assistant's game-testing tools cross-talk between them
- Restoring a saved chat session now correctly resumes the conversation instead of silently starting a new one
- macOS window traffic lights disappearing in native fullscreen no longer leave stray padding in the title bar

### Changed
- AI provider setup now accepts any OpenAI-compatible endpoint rather than a fixed list of providers
- App and installer now use a custom OpenGenie icon, including the macOS `.dmg` file itself
