---
name: add-linear
description: Add Linear as a channel. Polls for assigned issues, processes them with a dedicated agent group, and provides MCP tools for issue management. Uses @linear/sdk.
---

# Add Linear Integration

This skill adds Linear issue tracking to NanoClaw. The agent can receive assigned issues, update issue status, and post comments — all via polling (no public URL needed).

## Prerequisites

Run `/setup` before this skill. The container must be built and Claude authentication completed.

## Phase 1: Pre-flight

### Check if already applied

Read `.nanoclaw/state.yaml`. If `linear` is in `applied_skills`, skip to Phase 3 (Setup).

### Ask the user

AskUserQuestion: Do you have your Linear API key ready?
- **Yes** — Collect it in the next question
- **No** — Guide them: Go to **Linear → Settings → API → Personal API keys** and create one

AskUserQuestion: What is your Linear API key?
(Starts with `lin_api_`. Found in Linear under **Settings → Account → API → Personal API keys**.)

AskUserQuestion: Do you know your Linear User ID?
- **Yes** — Collect it
- **No** — Help them find it. Run this query using the API key they provided (use `curl.exe` on Windows to avoid the PowerShell alias):

```bash
curl.exe -s -H "Authorization: <API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"query":"{ viewer { id displayName } }"}' \
  https://api.linear.app/graphql
```

## Phase 2: Apply Code Changes

### Initialize skills system (if needed)

If `.nanoclaw/` directory doesn't exist:

```bash
npx tsx scripts/apply-skill.ts --init
```

### Apply the skill

```bash
npx tsx scripts/apply-skill.ts .claude/skills/add-linear
```

This deterministically:
- Adds `src/channels/linear.ts` (LinearChannel class implementing the Channel interface)
- Adds `src/channels/linear.test.ts` (unit tests)
- Adds `container/agent-runner/src/linear-mcp.ts` (MCP server with Linear tools)
- Adds `groups/linear/CLAUDE.md` (dedicated group instructions)
- Merges Linear config into `src/config.ts` (`LINEAR_API_KEY`, `LINEAR_USER_ID`, `LINEAR_POLL_INTERVAL`)
- Merges Linear channel creation into `src/index.ts`
- Adds `LINEAR_API_KEY` to `readSecrets()` in `src/container-runner.ts`
- Registers Linear MCP server in `container/agent-runner/src/index.ts`
- Installs `@linear/sdk` npm dependency in both host and container
- Updates `.env.example`

### Validate

```bash
npm test
npm run build
```

## Phase 3: Setup

### Configure environment

Add to `.env`:

```bash
LINEAR_API_KEY=<your-api-key>
LINEAR_USER_ID=<your-user-id>
LINEAR_POLL_INTERVAL=30000
```

Sync to container environment:
```bash
mkdir -p data/env && cp .env data/env/env
```

### Register the Linear group

```bash
sqlite3 store/messages.db "INSERT OR REPLACE INTO registered_groups
  (jid, name, folder, trigger_pattern, added_at, requires_trigger)
  VALUES ('linear:__channel__', 'Linear Issues', 'linear', '@<ASSISTANT_NAME>',
  '$(date -u +%Y-%m-%dT%H:%M:%SZ)', 0)"
```

The sentinel JID `linear:__channel__` routes all Linear issues to the `linear` group folder. Individual issue identifiers are embedded in message content.

### Build and restart

```bash
npm run build
cd container && ./build.sh && cd ..
npx tsx setup/index.ts --step service
```

## Phase 4: Verification

### Test the connection

1. Start NanoClaw: `npm run dev`
2. Check logs for: `Linear client connected` and `watching assignments for <name>`
3. Assign a Linear issue to the configured user
4. Within 30 seconds, the agent should pick it up and post a comment

### Check logs

```bash
tail -f logs/nanoclaw.log | grep -i linear
```

## Phase 5: Troubleshooting

### Agent not picking up issues

1. Verify `LINEAR_API_KEY` and `LINEAR_USER_ID` in `.env`
2. Check user ID matches:
   ```bash
   curl -s -H "Authorization: <KEY>" -H "Content-Type: application/json" \
     -d '{"query":"{ viewer { id } }"}' https://api.linear.app/graphql
   ```
3. Ensure `linear:__channel__` group is registered: `sqlite3 store/messages.db "SELECT * FROM registered_groups WHERE jid = 'linear:__channel__'"`
4. Check logs for API errors

### MCP tools not available in container

1. Rebuild container: `cd container && ./build.sh`
2. Check `@linear/sdk` in `container/agent-runner/package.json`
3. Verify `LINEAR_API_KEY` is in `readSecrets()` in `src/container-runner.ts`

### Agent posting duplicate comments

- The channel tracks `botCommentIds` to prevent loops
- Comments from the watched user ID are also filtered
- Check `processedCommentIds` pruning if memory grows

### Rate limits

Linear allows ~1500 API requests/hour. At 30s polling with ~3-5 calls per cycle, you'll use ~360-600/hour — well within limits.

## Removal

1. Delete `src/channels/linear.ts` and `src/channels/linear.test.ts`
2. Delete `container/agent-runner/src/linear-mcp.ts`
3. Remove `LinearChannel` import and creation from `src/index.ts`
4. Remove Linear config exports from `src/config.ts` and `readEnvFile` call
5. Remove `LINEAR_API_KEY` from `readSecrets()` in `src/container-runner.ts`
6. Remove Linear MCP from `container/agent-runner/src/index.ts`
7. Remove `'mcp__linear__*'` from `allowedTools`
8. Remove Linear registration: `sqlite3 store/messages.db "DELETE FROM registered_groups WHERE jid = 'linear:__channel__'"`
9. Uninstall: `npm uninstall @linear/sdk` (in both root and container/agent-runner)
10. Rebuild: `npm run build && cd container && ./build.sh`
