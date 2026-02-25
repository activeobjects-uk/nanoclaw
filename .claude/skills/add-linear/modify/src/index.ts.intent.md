# Intent: src/index.ts modifications

## What changed
Added Linear channel instantiation and import. Linear runs alongside existing channels.

## Key sections
- **Imports**: Add `LinearChannel` from `./channels/linear.js` and `LINEAR_API_KEY`, `LINEAR_USER_ID`, `LINEAR_POLL_INTERVAL` from `./config.js`
- **Channel creation**: After WhatsApp creation, conditionally create LinearChannel if `LINEAR_API_KEY && LINEAR_USER_ID` are set

## Invariants
- All existing message loop logic unchanged
- runAgent function completely unchanged
- State management unchanged
- All channels added to the `channels` array for proper shutdown
- Linear channel creation is fully conditional on env vars being set
- WhatsApp creation is NOT modified — Linear always runs alongside it

## Must-keep
- All existing imports and channel creation logic
- The channelOpts pattern (onMessage, onChatMetadata, registeredGroups)
- The channels.push() + connect() pattern
