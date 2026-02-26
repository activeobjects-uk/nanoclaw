# Persist Linear State Across Restarts

## Context

Currently when NanoClaw starts, the Linear channel does a "silent initial poll" that marks all existing assigned issues as already processed. This means any issues assigned while NanoClaw was offline are silently ignored. The user wants NanoClaw to detect and deliver new Linear issues that were assigned during downtime.

## Approach

Persist the `processedIssues` Map (issueId → updatedAt) to SQLite using the existing `router_state` key-value table (`getRouterState`/`setRouterState` from `src/db.ts`). On startup, load the persisted state so the first poll can compare and detect truly new assignments.

## File to Modify

### `src/channels/linear.ts`

1. **Import** `getRouterState` and `setRouterState` from `../db.js`

2. **Add `loadState()` method** — loads `processedIssues` from `router_state` key `linear:processedIssues`:
   ```typescript
   private loadState(): void {
     const raw = getRouterState('linear:processedIssues');
     if (raw) {
       const parsed = JSON.parse(raw) as Record<string, string>;
       this.processedIssues = new Map(Object.entries(parsed));
     }
   }
   ```

3. **Add `saveState()` method** — persists `processedIssues` after each poll:
   ```typescript
   private saveState(): void {
     setRouterState('linear:processedIssues', JSON.stringify(Object.fromEntries(this.processedIssues)));
   }
   ```

4. **Modify `connect()`** — call `loadState()` before the initial poll, remove the `silent` flag:
   ```typescript
   async connect(): Promise<void> {
     this.client = new LinearClient({ apiKey: this.apiKey });
     const viewer = await this.client.viewer;
     // ... logging ...
     this.connected = true;

     // Load persisted state so we can detect new issues assigned during downtime
     this.loadState();

     // First poll — delivers any issues assigned while offline
     await this.poll(false);

     this.pollTimer = setInterval(() => this.poll(false), this.pollInterval);
   }
   ```

5. **Modify `poll()`** — call `saveState()` at the end of each successful poll (after pruning), remove the `silent` parameter entirely:
   - Change signature from `poll(silent: boolean)` to `poll()`
   - Remove all `if (!silent)` guards — always deliver
   - Add `this.saveState()` at end

## Verification

1. `npx vitest run src/channels/linear.test.ts` — tests pass (will need updates for removed `silent` param)
2. `npm run dev` — start NanoClaw, verify Linear connects
3. Assign an issue in Linear, verify it's picked up
4. Stop NanoClaw, assign another issue, restart — verify the new issue is delivered but old ones aren't re-delivered
