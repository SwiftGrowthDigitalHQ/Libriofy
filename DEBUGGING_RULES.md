# Debugging Rules

## Small-Context Method
- Reproduce issue with minimal inputs.
- Capture only key error lines.
- Identify nearest failing file and function.
- Read small code windows around failure.

## Modular Strategy
- Debug one layer at a time:
  - frontend (`src`)
  - server (`server`)
  - auth edge functions (`supabase/functions/auth`)
- Confirm each layer before moving deeper.

## Low-Memory Workflow
- Close unrelated files/tabs.
- Run one debug process at a time.
- Keep terminal output compact.
- Disable noisy watchers when not required.

## Safe Fixing Rules
- Minimal patch first.
- Preserve contracts and response shapes.
- Avoid multi-module refactors during debugging.
- Add logs only when actively debugging; remove if no longer needed.

## Validation
- Run focused checks closest to changed code.
- Prefer single test target over full-suite runs on limited hardware.
- Confirm no side effects on auth and session flows.