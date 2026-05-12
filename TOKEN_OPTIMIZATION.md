# Token Optimization

## Core Rules
- Never perform full repository scans by default.
- Prefer targeted files and directory-restricted search.
- Avoid parsing large logs and generated outputs.
- Keep prompts short and task-specific.

## Token-Saving Practices
- Read only the smallest relevant file section.
- Avoid repeating unchanged context in prompts.
- Summarize findings in bullets before next action.
- Use one focused objective per agent run.
- Reuse prior conclusions instead of re-reading files.

## Search Limits
- Start with exact path or module-based search.
- Stop after locating the first authoritative implementation.
- Expand search radius gradually only when blocked.

## Patch Limits
- Change as few files as possible.
- Keep diffs minimal and local.
- Skip opportunistic cleanup unrelated to the task.

## Low-Token Prompt Examples
- "Fix null guard in `src/auth/session.ts` only. Do not refactor."
- "Inspect `server/auth` login flow and patch only failing branch."
- "Read only error handling in `supabase/functions/auth` and propose minimal fix."