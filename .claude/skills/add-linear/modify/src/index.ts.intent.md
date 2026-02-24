# Intent: src/index.ts modifications

## What changed
Added Linear channel instantiation and import. Linear runs alongside existing channels.

## Key sections
- **Imports**: Add `LinearChannel` from `./channels/linear.js` and `LINEAR_API_KEY`, `LINEAR_USER_ID`, `LINEAR_POLL_INTERVAL`, `LINEAR_ONLY` from `./config.js`
- **Channel creation**: After the Slack block, conditionally create LinearChannel if `LINEAR_API_KEY && LINEAR_USER_ID` are set
- **WhatsApp guard**: Update to `if (!SLACK_ONLY && !LINEAR_ONLY)` so LINEAR_ONLY also suppresses WhatsApp

## Invariants
- All existing message loop logic unchanged
- runAgent function completely unchanged
- State management unchanged
- All channels added to the `channels` array for proper shutdown
- Linear channel creation is fully conditional on env vars being set
- WhatsApp guard includes both SLACK_ONLY and LINEAR_ONLY

## Must-keep
- All existing imports and channel creation logic
- The channelOpts pattern (onMessage, onChatMetadata, registeredGroups)
- The channels.push() + connect() pattern used by Slack
