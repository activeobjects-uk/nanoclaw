# Intent: src/config.ts modifications

## What changed
Added three new configuration exports for Linear channel support.

## Key sections
- **readEnvFile call**: Must include `LINEAR_API_KEY`, `LINEAR_USER_ID`, `LINEAR_POLL_INTERVAL` keys
- **LINEAR_API_KEY**: Personal API key for Linear (lin_api_...)
- **LINEAR_USER_ID**: UUID of the Linear user to watch for assignments
- **LINEAR_POLL_INTERVAL**: Polling interval in ms (default 30000)
- **LINEAR_ALLOWED_USERS**: Comma-separated Linear user IDs allowed to interact with the bot. Parsed into a string array. Empty = feature disabled (all users accepted).

## Invariants
- All existing config exports remain unchanged
- LINEAR_ALLOWED_USERS is additive — empty list preserves existing behavior
- New Linear keys added to `readEnvFile([...])` call alongside existing keys
- New exports appended at end of file
- No existing behavior modified — Linear config is additive only
- LINEAR_POLL_INTERVAL uses `parseInt()` with fallback to '30000'

## Must-keep
- All existing exports (ASSISTANT_NAME, POLL_INTERVAL, TRIGGER_PATTERN, etc.)
- The readEnvFile pattern — ALL config from .env must go through this function
