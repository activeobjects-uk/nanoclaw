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

Read `.nanoclaw/state.yaml`. If `linear` is in `applied_skills`, skip to Phase 3 (Setup). The code changes are already in place.

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

Or call `initSkillsSystem()` from `skills-engine/migrate.ts`.

### Apply the skill

```bash
npx tsx scripts/apply-skill.ts .claude/skills/add-linear
```

This deterministically:
- Adds `src/channels/linear.ts` (LinearChannel class implementing the Channel interface)
- Adds `src/channels/linear.test.ts` (unit tests)
- Adds `container/agent-runner/src/linear-mcp.ts` (MCP server with Linear tools)
- Adds `groups/linear/CLAUDE.md` (dedicated group instructions)
- Adds `groups/linear/.claude/skills/create-mockup/SKILL.md` (mockup publishing skill for the Linear agent)
- Adds `scripts/register-group.ts` (cross-platform group registration utility)
- Three-way merges Linear config into `src/config.ts` (`LINEAR_API_KEY`, `LINEAR_USER_ID`, `LINEAR_POLL_INTERVAL`)
- Three-way merges Linear channel creation into `src/index.ts`
- Three-way merges Linear secrets into `src/container-runner.ts` (`LINEAR_API_KEY`, `GITHUB_TOKEN`)
- Three-way merges Linear MCP server into `container/agent-runner/src/index.ts`
- Three-way merges Linear dependency into `container/agent-runner/package.json`
- Installs `@linear/sdk` npm dependency
- Three-way merges Linear env vars into `.env.example`
- Records the application in `.nanoclaw/state.yaml`

If the apply reports merge conflicts, read the intent files:
- `modify/src/index.ts.intent.md` — what changed and invariants for index.ts
- `modify/src/config.ts.intent.md` — what changed for config.ts
- `modify/src/container-runner.ts.intent.md` — what changed for container-runner.ts
- `modify/container/agent-runner/src/index.ts.intent.md` — what changed for the agent-runner entry point

### Validate

```bash
npm test
npm run build
```

All tests must pass (including the new Linear tests) and build must be clean before proceeding.

## Phase 3: Setup

### Configure environment

Add to `.env`:

```bash
LINEAR_API_KEY=<your-api-key>
LINEAR_USER_ID=<your-user-id>
LINEAR_POLL_INTERVAL=30000
GITHUB_TOKEN=<your-github-token>
```

`LINEAR_ALLOWED_USERS` is optional — when set, only issues/comments from these Linear user IDs are processed. To find user IDs for your workspace:

```bash
curl.exe -s -H "Authorization: <API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"query":"{ users { nodes { id displayName email } } }"}' \
  https://api.linear.app/graphql
```

Copy the `id` values for each team member you want to allow and set:
```bash
LINEAR_ALLOWED_USERS=uuid1,uuid2,uuid3
```

When empty or unset, all workspace users can interact with the bot (default).

`GITHUB_TOKEN` is optional but recommended — the Linear agent uses it to publish HTML mockups as GitHub Gists via the `create-mockup` skill. Create a [Personal Access Token](https://github.com/settings/tokens) with the `gist` scope. If omitted, mockups will be attached as files to the Linear issue instead.

Sync to container environment:

```bash
mkdir -p data/env && cp .env data/env/env
```

The container reads environment from `data/env/env`, not `.env` directly.

### Register the Linear group

```bash
npx tsx scripts/register-group.ts "linear:__channel__" "Linear Issues" linear "@<ASSISTANT_NAME>" --no-trigger-required
```

The sentinel JID `linear:__channel__` routes all Linear issues to the `linear` group folder. Individual issue identifiers are embedded in message content.

### Build and restart

```bash
npm run build
cd container && ./build.sh && cd ..
```

Restart the service:

```bash
# macOS (launchd)
launchctl kickstart -k gui/$(id -u)/com.nanoclaw

# Linux (systemd)
systemctl --user restart nanoclaw

# Windows (or if service not yet configured)
npx tsx setup/index.ts --step service
```

## Phase 4: Verify

### Test the connection

1. Start NanoClaw: `npm run dev`
2. Check logs for: `Linear client connected` and `watching assignments for <name>`
3. Assign a Linear issue to the configured user
4. Within 30 seconds, the agent should pick it up and post a comment

### Check logs

```bash
tail -f logs/nanoclaw.log | grep -i linear
```

## After Setup

If running `npm run dev` while the service is active:

```bash
# macOS:
launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist
npm run dev
# When done testing:
launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist

# Linux:
# systemctl --user stop nanoclaw
# npm run dev
# systemctl --user start nanoclaw

# Windows:
# Stop the service before running dev, then restart after
```

## Troubleshooting

### Agent not picking up issues

1. Verify `LINEAR_API_KEY` and `LINEAR_USER_ID` in `.env`
2. Check user ID matches:
   ```bash
   curl -s -H "Authorization: <KEY>" -H "Content-Type: application/json" \
     -d '{"query":"{ viewer { id } }"}' https://api.linear.app/graphql
   ```
3. Ensure `linear:__channel__` group is registered — re-run: `npx tsx scripts/register-group.ts "linear:__channel__" "Linear Issues" linear "" --no-trigger-required`
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
3. Delete `groups/linear/` directory (includes `CLAUDE.md` and `create-mockup` skill)
4. Remove `LinearChannel` import and creation from `src/index.ts`
5. Remove Linear config exports from `src/config.ts` and `readEnvFile` call
6. Remove `LINEAR_API_KEY` from `readSecrets()` in `src/container-runner.ts`
7. Remove Linear MCP from `container/agent-runner/src/index.ts`
8. Remove `'mcp__linear__*'` from `allowedTools`
9. Remove Linear registration — delete from DB via: `npx tsx -e 'import { db } from "./src/db.js"; db.prepare("DELETE FROM registered_groups WHERE jid = ?").run("linear:__channel__")'`
10. Delete `scripts/register-group.ts`
11. Uninstall: `npm uninstall @linear/sdk` (in both root and container/agent-runner)
12. Rebuild: `npm run build && cd container && ./build.sh`
