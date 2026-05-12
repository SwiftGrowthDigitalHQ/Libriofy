# AGENTS Rules

## Scope Rules
- Work only on files directly related to the requested task.
- Do not scan entire repository unless explicitly required.
- Never read or index `node_modules`, `dist`, `dist-server`, `coverage`, `graphify-out`, or logs.

## Minimal Context Policy
- Start with 1-3 target files.
- Expand scope only when blocked.
- Prefer symbol or keyword search in specific directories.
- Avoid loading large docs unless they are required for the task.

## Focused Search Policy
- Use targeted path constraints for searches.
- Stop recursive search once the relevant source is found.
- Avoid architecture-wide analysis for feature-local issues.

## Low-Token Debugging Workflow
1. Reproduce with smallest command/input.
2. Inspect nearest module only.
3. Read minimal code slice around failing path.
4. Patch only the root-cause file(s).
5. Validate with focused test or command.

## Modular Debugging Strategy
- Debug by layer: UI -> API -> service -> storage.
- Isolate one subsystem at a time.
- Keep hypotheses short and testable.
- Avoid mixing unrelated fixes in one change.

## Minimal Patch Strategy
- Apply smallest safe diff that resolves the issue.
- Preserve interfaces and behavior unless requested.
- Avoid broad refactors during incident fixes.
- Do not rewrite stable systems.

## Architecture Preservation
- Keep existing React + Vite + TypeScript frontend structure.
- Keep existing Supabase + Redis + Node backend structure.
- Keep auth logic in existing auth modules unless asked to migrate.
- Do not change environment files.

## Safety Rules
- No business logic rewrites without explicit request.
- No breaking changes.
- Maintain backward compatibility.
- Keep changes production-safe and reversible.