# Intent: src/container-runner.ts modifications

## What changed
1. Added `LINEAR_API_KEY` to the `readSecrets()` function so it gets passed to the container via stdin.
2. Added per-group skills sync after the global skills sync. This copies skills from `groups/{folder}/.claude/skills/` into the container's `.claude/skills/`, allowing group-specific skills that override global ones.

## Key sections
- **readSecrets()**: The array of secret keys passed to `readEnvFile()` — must include `LINEAR_API_KEY`
- **buildVolumeMounts() skills sync**: After the existing `container/skills/` sync block, a second sync copies from `groupDir/.claude/skills/` into the same `skillsDst`. Group skills override global skills with the same name.

## Invariants
- All existing secrets remain (`CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`)
- `LINEAR_API_KEY` is appended to the existing array
- The global skills sync from `container/skills/` remains unchanged and runs first
- Per-group skills sync runs second, so group-level skills override global ones
- `groupDir` variable is already available at the point of insertion

## Must-keep
- Existing readSecrets pattern
- Existing global skills sync block (container/skills/)
- All other container-runner functionality unchanged
