# AI Workflow

## Lightweight Execution
- Define one concrete objective per run.
- Limit context to relevant modules.
- Avoid parallel heavy agents on low-resource machines.

## Focused File Analysis
- Start from known entrypoint file.
- Read only adjacent dependencies if required.
- Avoid loading generated assets, logs, and build outputs.

## Enterprise Repo Optimization
- Use directory-scoped searches.
- Prefer incremental investigation over global architecture reads.
- Keep change sets modular and auditable.

## Low-Memory Session Strategy
- Keep terminal count low.
- Stop inactive services.
- Restart editor periodically during long sessions.
- Keep extensions minimal in active workspace.

## Low-Token Prompting Template
Use this structure:
1. Task: one sentence.
2. Scope: exact files/directories.
3. Constraints: no refactor/no full scan/minimal patch.
4. Output: expected diff or validation result.

Example:
- Task: Fix failing token refresh path.
- Scope: `src/auth`, `server/auth`.
- Constraints: no architecture changes, minimal patch only.
- Output: code diff + targeted verification command.

## Cursor Workflow Recommendations
- Keep indexing excludes strict (`node_modules`, build, cache, media, logs).
- Prefer smaller context windows and focused prompts.
- Use concise agent instructions with hard scope boundaries.
- Validate quickly, then stop background tasks.