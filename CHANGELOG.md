# Changelog

All notable changes to GenieEngine are documented here.

## [Unreleased]

### Added
- The chat agent now runs on two configurable models instead of one: Medium (default: deepseek/deepseek-v4-pro) for everyday work, and Large (default: z-ai/glm-5.2) for tough tasks that need extra juice but may cost more. A dropdown in the chat box switches between them mid-conversation — the full chat history carries over. The image / game-testing model stays its own separate configuration (default: moonshotai/kimi-k2.7-code)
- Every model in the AI settings can now set Thinking (enabled/disabled) and Reasoning effort (low/medium/high/xhigh/max), sent with each request as the standard OpenAI-format `thinking` / `reasoning_effort` fields; the default sends nothing and leaves the model on its own behavior

### Fixed
- Updating the chat model's API key silently overwrote the image model's stored key whenever both models pointed at the same endpoint (they shared one credential slot), and changing the chat endpoint could strand the image credential entirely. Every model now keeps its own credential slot; leaving a key blank to share another section's key copies it instead of aliasing it
- The game-testing subagent could probe a game for 10+ minutes behind a motionless chat, looking hung until the user cancelled. AI test runs now have a per-run budget (~40 game tool calls / 8 minutes) with an early wrap-up warning, and subagent tool activity is shown live in the chat as labelled chips
- Test screenshots are now downscaled to 1024-wide JPEGs before being sent to the model — full-size retina PNGs accumulating in the test conversation made every step slower and could exceed the provider's request-size limit mid-run (the on-disk copy stays full resolution)

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
- Running multiple GenieEngine instances no longer lets the assistant's game-testing tools cross-talk between them
- Restoring a saved chat session now correctly resumes the conversation instead of silently starting a new one
- macOS window traffic lights disappearing in native fullscreen no longer leave stray padding in the title bar

### Changed
- AI provider setup now accepts any OpenAI-compatible endpoint rather than a fixed list of providers
- App and installer now use a custom GenieEngine icon, including the macOS `.dmg` file itself
