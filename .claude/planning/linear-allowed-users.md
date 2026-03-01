# Plan: Linear Channel — Approved Users Filter

## Context

The Linear channel currently processes all assigned issues, comments, and @mentions without filtering by who triggered them. Anyone in the Linear workspace can interact with the bot. We need an opt-in filter: when `LINEAR_ALLOWED_USERS` is set (comma-separated Linear user IDs), only interactions from those users are delivered to the agent. When empty/unset, current behavior is preserved.

**Filtering at 3 points in polling** (before messages reach the agent):
1. **Issue assignments** — filter by `issue.creatorId` (sync getter on `@linear/sdk` `Issue`, no extra API call)
2. **Comments on tracked issues** — filter by `commentUser.id`
3. **@Mentions** — filter by `comment.user?.id`

---

## Important: Skills Architecture

Changes must be made in the **add-linear skill** (`.claude/skills/add-linear/`) so other users get the feature. The skill has two types of files:

- **`add/` files** — completely new files (e.g., `src/channels/linear.ts`). Edit these directly.
- **`modify/` files** — full copies of existing files with the skill's changes applied. Three-way merged via `git merge-file` against `.nanoclaw/base/`. Each has a companion `.intent.md` describing changes and invariants.
- **`manifest.yaml`** — lists all added/modified files, npm deps, env vars.

Since the skill is already applied to this project, the **live project files** and **base files** must also be updated to stay in sync.

### Files that must ALL stay identical:
- `src/config.ts` = `.claude/skills/add-linear/modify/src/config.ts` = `.nanoclaw/base/src/config.ts`
- `src/channels/linear.ts` = `.claude/skills/add-linear/add/src/channels/linear.ts`
- `.env.example` = `.claude/skills/add-linear/modify/.env.example` = `.nanoclaw/base/.env.example`

---

## Files to Change (12 files total)

### A. Skill files

#### 1. `.claude/skills/add-linear/manifest.yaml`
Add `LINEAR_ALLOWED_USERS` to the `env_additions` list (after `GITHUB_TOKEN`).

Current `env_additions`:
```yaml
  env_additions:
    - LINEAR_API_KEY
    - LINEAR_USER_ID
    - LINEAR_POLL_INTERVAL
    - GITHUB_TOKEN
```
Add:
```yaml
    - LINEAR_ALLOWED_USERS
```

#### 2. `.claude/skills/add-linear/modify/src/config.ts`
This is a **full file**. Two changes needed:

**Change 1**: Add `'LINEAR_ALLOWED_USERS'` to the `readEnvFile()` keys array (currently at line ~9-15):
```typescript
const envConfig = readEnvFile([
  'ASSISTANT_NAME',
  'ASSISTANT_HAS_OWN_NUMBER',
  'LINEAR_API_KEY',
  'LINEAR_USER_ID',
  'LINEAR_POLL_INTERVAL',
  'LINEAR_ALLOWED_USERS',  // ADD THIS
]);
```

**Change 2**: Append after the `GITHUB_TOKEN` export (currently last line ~84):
```typescript
// Linear user filter — when set, only these user IDs can trigger the bot
const rawAllowedUsers = process.env.LINEAR_ALLOWED_USERS || envConfig.LINEAR_ALLOWED_USERS || '';
export const LINEAR_ALLOWED_USERS: string[] = rawAllowedUsers
  ? rawAllowedUsers.split(',').map(id => id.trim()).filter(Boolean)
  : [];
```

#### 3. `.claude/skills/add-linear/modify/src/config.ts.intent.md`
Add to "Key sections":
```
- **LINEAR_ALLOWED_USERS**: Comma-separated Linear user IDs allowed to interact with the bot. Parsed into a string array. Empty = feature disabled (all users accepted).
```
Add to "Invariants":
```
- LINEAR_ALLOWED_USERS is additive — empty list preserves existing behavior
```

#### 4. `.claude/skills/add-linear/add/src/channels/linear.ts`
This is the full channel implementation. Three changes needed:

**Change 1**: Add to imports (currently line 3 imports `ASSISTANT_NAME`):
```typescript
import { ASSISTANT_NAME, LINEAR_ALLOWED_USERS } from '../config.js';
```

**Change 2**: Add private helper method to `LinearChannel` class (after the existing `private loadState()`/`private saveState()` methods, around line ~63):
```typescript
  /**
   * Check if a Linear user ID is in the allowed list.
   * Returns true if the filter is disabled (empty list) or the user is allowed.
   */
  private isUserAllowed(userId: string | undefined): boolean {
    if (LINEAR_ALLOWED_USERS.length === 0) return true;
    if (!userId) return false;
    return LINEAR_ALLOWED_USERS.includes(userId);
  }
```

**Change 3a**: In `poll()` method, inside the `if (!this.processedIssues.has(issueId))` block (~line 108-113). Currently:
```typescript
        if (!this.processedIssues.has(issueId)) {
          // New assignment
          this.processedIssues.set(issueId, updatedAt);
          // Mark all existing comments as seen to avoid flooding
          await this.markExistingComments(issue);
          await this.deliverIssue(issue, 'assigned');
```
Change to:
```typescript
        if (!this.processedIssues.has(issueId)) {
          // New assignment
          this.processedIssues.set(issueId, updatedAt);
          // Mark all existing comments as seen to avoid flooding
          await this.markExistingComments(issue);
          if (!this.isUserAllowed(issue.creatorId)) {
            logger.debug({ issueId: issue.id, creatorId: issue.creatorId }, 'Skipping issue from non-allowed creator');
            continue;
          }
          await this.deliverIssue(issue, 'assigned');
```

**Change 3b**: In `checkNewComments()` method (~line 308-312). Currently:
```typescript
        // Skip comments from the bot's own Linear account to prevent loops
        if (commentUser.id === this.userId) continue;
```
Add after:
```typescript
        if (!this.isUserAllowed(commentUser.id)) continue;
```

**Change 3c**: In `pollMentions()` method (~line 261). Currently:
```typescript
        if (comment.user?.id === this.userId) continue;
```
Add after:
```typescript
        if (!this.isUserAllowed(comment.user?.id)) continue;
```

#### 5. `.claude/skills/add-linear/add/src/channels/linear.test.ts`
Add a `describe('allowed users filtering')` block. The test file uses vitest with this mock pattern:

```typescript
vi.mock('../config.js', () => ({
  ASSISTANT_NAME: 'Andy',
  LINEAR_ALLOWED_USERS: [],  // ADD THIS to the existing mock
}));
```

For the new test group, use `vi.mocked()` to change `LINEAR_ALLOWED_USERS` per test:
```typescript
import { LINEAR_ALLOWED_USERS } from '../config.js';

describe('allowed users filtering', () => {
  // The mock issue creator has creatorId available via the Mock setup
  // MockLinearClient is already defined at the top of the test file

  it('delivers issue when LINEAR_ALLOWED_USERS is empty (feature disabled)', async () => {
    // LINEAR_ALLOWED_USERS is [] by default in mock — issue should be delivered
  });

  it('delivers issue when creator is in LINEAR_ALLOWED_USERS', async () => {
    // Temporarily set LINEAR_ALLOWED_USERS to include the mock creator ID
  });

  it('skips issue when creator is NOT in LINEAR_ALLOWED_USERS', async () => {
    // Set LINEAR_ALLOWED_USERS to a different ID — issue should NOT be delivered
  });

  it('still tracks filtered issues in processedIssues', async () => {
    // After filtering, a second poll should NOT re-deliver the issue
  });

  it('skips comment from user not in LINEAR_ALLOWED_USERS', async () => {
    // Create a comment from a non-allowed user — should be skipped
  });

  it('skips @mention from user not in LINEAR_ALLOWED_USERS', async () => {
    // Mention from non-allowed user — should be skipped
  });
});
```

**Key mock details** (from reading the existing test file):
- `MockLinearClient` is defined at file top with `vi.hoisted()`
- Mock issues are created via `createMockIssue()` helper
- The mock issue needs a `creatorId` property added to the helper
- Comments are mocked with `{ id, body, createdAt, user: { id, name, displayName } }`
- `onMessage` callback tracks calls for assertions

To modify `LINEAR_ALLOWED_USERS` per test, use the pattern:
```typescript
const configModule = await import('../config.js');
Object.defineProperty(configModule, 'LINEAR_ALLOWED_USERS', { value: ['allowed-uuid'], writable: true });
```
Or use `vi.spyOn` / direct property override on the mocked module.

#### 6. `.claude/skills/add-linear/modify/.env.example`
Add after the `LINEAR_POLL_INTERVAL=30000` line (currently ~line 41):
```
# Comma-separated list of Linear user IDs allowed to interact with the bot.
# When empty, all users can trigger the bot (default).
# Find user IDs by running:
#   curl.exe -s -H "Authorization: <API_KEY>" -H "Content-Type: application/json" \
#     -d '{"query":"{ users { nodes { id displayName email } } }"}' https://api.linear.app/graphql
# Example: LINEAR_ALLOWED_USERS=uuid1,uuid2,uuid3
LINEAR_ALLOWED_USERS=
```

#### 7. `.claude/skills/add-linear/SKILL.md`
In **Phase 3: Setup → Configure environment** section (after the `.env` code block at ~line 93-101), add:

```markdown
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
```

---

### B. Live project files (skill already applied — mirror skill changes)

#### 8. `src/config.ts`
Exact same changes as #2 (add to readEnvFile keys + append export)

#### 9. `src/channels/linear.ts`
Exact same changes as #4 (import, helper method, 3 filter checks)

#### 10. `.env.example`
Exact same changes as #6 (add LINEAR_ALLOWED_USERS with discovery instructions)

---

### C. Base files (keep in sync)

#### 11. `.nanoclaw/base/src/config.ts`
Exact same changes as #2

#### 12. `.nanoclaw/base/.env.example`
Exact same changes as #6

---

## Key Details

- **Tracked but filtered**: Filtered issues are still added to `processedIssues` and their comments marked as seen. This prevents re-processing every poll cycle. The issue just isn't delivered to the agent.
- **`creatorId`**: Synchronous getter on `@linear/sdk` `Issue` (confirmed: `get creatorId(): string | undefined` in SDK types at `node_modules/@linear/sdk/dist/index.d.cts:466`). No async call needed.
- **Empty = disabled**: `isUserAllowed()` returns `true` when the list is empty — full backward compatibility.
- **Import change in linear.ts**: Currently imports only `ASSISTANT_NAME` from config. Must add `LINEAR_ALLOWED_USERS` to the same import.
- **Logger**: Use `logger` (already imported in linear.ts) for debug-level skip messages.

## Verification

1. `npm run typecheck` — no TS errors
2. `npx vitest run src/channels/linear.test.ts` — existing + new filter tests pass
3. `npm run test` — full suite passes
4. Manual: set `LINEAR_ALLOWED_USERS=<uuid>` in `.env`, run `npm run dev`, verify only allowed users' issues/comments are processed

## Implementation Order

1. Start with config changes (#2, #8, #11) — they're identical across 3 files
2. Then linear.ts changes (#4, #9) — the core filtering logic
3. Then .env.example changes (#6, #10, #12) — identical across 3 files
4. Then manifest (#1), intent (#3), SKILL.md (#7), tests (#5)
5. Run verification steps
