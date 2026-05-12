# Performance Optimization Guide

## Goals
- Reduce GPU and RAM usage in editor sessions.
- Lower extension and indexing overhead.
- Keep long coding sessions stable on limited hardware.

## VS Code / Cursor Rendering
- Use a simple theme and disable UI effects.
- Keep minimap off.
- Keep sticky scroll off.
- Keep smooth scrolling off.
- Keep breadcrumbs off unless needed.
- Limit simultaneous open editors and split panes.

## Extension and Agent Memory
- Disable unused extensions per workspace.
- Keep only essential AI and linting extensions enabled.
- Disable extension auto-updates during active sessions.
- Avoid running multiple heavy AI agents in parallel unless necessary.

## Terminal Rendering Load
- Limit terminal scrollback (for example 1000 lines).
- Avoid verbose watch logs; run focused commands.
- Stop inactive dev servers and background watchers.
- Prefer one terminal per active task.

## Indexing and File Watchers
- Exclude build, cache, generated, and media paths from indexing.
- Keep explorer auto-refresh and file nesting features minimal.
- Avoid broad recursive scans; target specific folders.

## Live Preview and Animations
- Disable unused live previews.
- Disable UI animations where available.
- Close preview tabs when not actively used.

## AI Context Overhead
- Read only directly relevant files.
- Avoid full-file reads when a small slice is enough.
- Avoid loading generated outputs and logs into prompts.
- Keep prompt scope to one module or feature at a time.

## Recommended Workspace Settings
Use these in local workspace settings when needed:
- `workbench.editor.enablePreview`: true
- `editor.minimap.enabled`: false
- `editor.stickyScroll.enabled`: false
- `editor.smoothScrolling`: false
- `terminal.integrated.scrollback`: 1000
- `files.watcherExclude`: include build/cache/generated/media paths
- `search.exclude`: include build/cache/generated/media paths

## Stability Workflow
- Restart Cursor after long sessions with high memory growth.
- Use short, focused agent runs.
- Re-open only required folders/tabs after restart.