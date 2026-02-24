# Intent: src/config.ts modifications

## What changed
Added four new configuration exports for Linear channel support.

## Key sections
- **readEnvFile call**: Must include `LINEAR_API_KEY`, `LINEAR_USER_ID`, `LINEAR_POLL_INTERVAL`, `LINEAR_ONLY` keys
- **LINEAR_API_KEY**: Personal API key for Linear (lin_api_...)
- **LINEAR_USER_ID**: UUID of the Linear user to watch for assignments
- **LINEAR_POLL_INTERVAL**: Polling interval in ms (default 30000)
- **LINEAR_ONLY**: Boolean flag — suppress other channels when true

## Invariants
- All existing config exports remain unchanged
- New Linear keys added to `readEnvFile([...])` call alongside existing keys
- New exports appended at end of file after Slack config
- No existing behavior modified — Linear config is additive only
- LINEAR_POLL_INTERVAL uses `parseInt()` with fallback to '30000'
- LINEAR_ONLY uses `=== 'true'` boolean pattern

## Must-keep
- All existing exports (ASSISTANT_NAME, POLL_INTERVAL, TRIGGER_PATTERN, SLACK_*, etc.)
- The readEnvFile pattern — ALL config from .env must go through this function
