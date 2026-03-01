import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// --- Mocks ---

const mockAllowedUsers = vi.hoisted(() => ({ value: [] as string[] }));

vi.mock('../config.js', () => ({
  ASSISTANT_NAME: 'Andy',
  TRIGGER_PATTERN: /^@Andy\b/i,
  get LINEAR_ALLOWED_USERS() { return mockAllowedUsers.value; },
}));

vi.mock('../logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const mockRouterState = vi.hoisted(() => new Map<string, string>());

vi.mock('../db.js', () => ({
  getRouterState: vi.fn((key: string) => mockRouterState.get(key)),
  setRouterState: vi.fn((key: string, value: string) => {
    mockRouterState.set(key, value);
  }),
}));

// --- @linear/sdk mock ---

const mockIssues = vi.hoisted(() => ({
  nodes: [] as any[],
}));

const mockViewer = vi.hoisted(() => ({
  displayName: 'NanoClaw Bot',
  id: 'user-bot-123',
}));

const mockCreateComment = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    success: true,
    comment: Promise.resolve({ id: 'comment-new-1' }),
  }),
);

vi.mock('@linear/sdk', () => ({
  LinearClient: class MockLinearClient {
    viewer = Promise.resolve(mockViewer);

    user = vi.fn().mockReturnValue({
      assignedIssues: vi.fn().mockResolvedValue(mockIssues),
    });

    createComment = mockCreateComment;
  },
}));

import { LinearChannel, LinearChannelOpts, LINEAR_CHANNEL_JID } from './linear.js';

// --- Test helpers ---

function createTestOpts(overrides?: Partial<LinearChannelOpts>): LinearChannelOpts {
  return {
    onMessage: vi.fn(),
    onChatMetadata: vi.fn(),
    registeredGroups: vi.fn(() => ({
      [LINEAR_CHANNEL_JID]: {
        name: 'Linear Issues',
        folder: 'linear',
        trigger: '@Andy',
        added_at: '2024-01-01T00:00:00.000Z',
        requiresTrigger: false,
      },
    })),
    ...overrides,
  };
}

function createMockIssue(overrides?: Partial<{
  id: string;
  identifier: string;
  title: string;
  description: string;
  url: string;
  priority: number;
  creatorId: string;
  updatedAt: Date;
  state: { name: string };
  labels: { nodes: { name: string }[] };
  comments: { nodes: any[] };
}>) {
  const defaults = {
    id: 'issue-1',
    identifier: 'ENG-123',
    title: 'Fix the login bug',
    description: 'The login page crashes on Safari',
    url: 'https://linear.app/team/issue/ENG-123',
    priority: 2,
    creatorId: 'creator-user-1',
    updatedAt: new Date('2024-06-01T12:00:00Z'),
  };

  const merged = { ...defaults, ...overrides };

  return {
    id: merged.id,
    identifier: merged.identifier,
    title: merged.title,
    description: merged.description,
    url: merged.url,
    priority: merged.priority,
    creatorId: merged.creatorId,
    updatedAt: merged.updatedAt,
    state: Promise.resolve(overrides?.state ?? { name: 'Todo' }),
    labels: vi.fn().mockResolvedValue(
      overrides?.labels ?? { nodes: [{ name: 'bug' }] },
    ),
    comments: vi.fn().mockResolvedValue(
      overrides?.comments ?? { nodes: [] },
    ),
  };
}

// --- Tests ---

describe('LinearChannel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: false });
    mockIssues.nodes = [];
    mockRouterState.clear();
    mockAllowedUsers.value = [];
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // --- Connection lifecycle ---

  describe('connection lifecycle', () => {
    it('resolves connect() and marks as connected', async () => {
      const opts = createTestOpts();
      const channel = new LinearChannel('lin_api_key', 'user-bot-123', 30000, opts);

      await channel.connect();

      expect(channel.isConnected()).toBe(true);
    });

    it('isConnected() returns false before connect', () => {
      const opts = createTestOpts();
      const channel = new LinearChannel('lin_api_key', 'user-bot-123', 30000, opts);

      expect(channel.isConnected()).toBe(false);
    });

    it('disconnects cleanly', async () => {
      const opts = createTestOpts();
      const channel = new LinearChannel('lin_api_key', 'user-bot-123', 30000, opts);

      await channel.connect();
      expect(channel.isConnected()).toBe(true);

      await channel.disconnect();
      expect(channel.isConnected()).toBe(false);
    });

    it('validates connection by fetching viewer on connect', async () => {
      const opts = createTestOpts();
      const channel = new LinearChannel('lin_api_key', 'user-bot-123', 30000, opts);

      await channel.connect();

      // Viewer is resolved during connect — no error means validation passed
      expect(channel.isConnected()).toBe(true);
    });
  });

  // --- Polling and issue detection ---

  describe('polling', () => {
    it('first poll delivers new issues when no persisted state exists', async () => {
      const issue = createMockIssue();
      mockIssues.nodes = [issue];

      const opts = createTestOpts();
      const channel = new LinearChannel('lin_api_key', 'user-bot-123', 30000, opts);

      await channel.connect();

      // With no persisted state, the first poll delivers issues as new assignments
      expect(opts.onMessage).toHaveBeenCalledTimes(1);
    });

    it('first poll skips already-persisted issues', async () => {
      const issue = createMockIssue();
      mockIssues.nodes = [issue];

      // Pre-populate persisted state with this issue
      mockRouterState.set(
        'linear:processedIssues',
        JSON.stringify({ 'issue-1': '2024-06-01T12:00:00.000Z' }),
      );

      const opts = createTestOpts();
      const channel = new LinearChannel('lin_api_key', 'user-bot-123', 30000, opts);

      await channel.connect();

      // Issue was already in persisted state with same updatedAt — no delivery
      expect(opts.onMessage).not.toHaveBeenCalled();
    });

    it('detects new assignment and delivers issue message', async () => {
      const opts = createTestOpts();
      const channel = new LinearChannel('lin_api_key', 'user-bot-123', 60000, opts);

      // Start with no issues
      mockIssues.nodes = [];
      await channel.connect();

      // Add a new issue and advance the timer
      const issue = createMockIssue();
      mockIssues.nodes = [issue];

      await vi.advanceTimersByTimeAsync(60000);

      expect(opts.onMessage).toHaveBeenCalledWith(
        LINEAR_CHANNEL_JID,
        expect.objectContaining({
          chat_jid: LINEAR_CHANNEL_JID,
          sender: 'linear',
          sender_name: 'Linear',
          is_from_me: false,
        }),
      );

      // Content should include issue details
      const call = (opts.onMessage as any).mock.calls[0];
      const content: string = call[1].content;
      expect(content).toContain('@Andy');
      expect(content).toContain('ENG-123');
      expect(content).toContain('Fix the login bug');
      expect(content).toContain('Todo');

      await channel.disconnect();
    });

    it('does not re-deliver already processed issues', async () => {
      const opts = createTestOpts();
      const channel = new LinearChannel('lin_api_key', 'user-bot-123', 60000, opts);

      // Start empty, then add issue after connect
      mockIssues.nodes = [];
      await channel.connect();

      const issue = createMockIssue();
      mockIssues.nodes = [issue];

      // First poll: new assignment detected
      await vi.advanceTimersByTimeAsync(60000);
      expect(opts.onMessage).toHaveBeenCalledTimes(1);

      // Second poll: same issue, same updatedAt — no re-delivery
      await vi.advanceTimersByTimeAsync(60000);
      expect(opts.onMessage).toHaveBeenCalledTimes(1);

      await channel.disconnect();
    });

    it('detects updated issue and checks for new comments', async () => {
      const opts = createTestOpts();
      const channel = new LinearChannel('lin_api_key', 'user-bot-123', 60000, opts);

      // Start empty
      mockIssues.nodes = [];
      await channel.connect();

      // Add issue — first poll detects new assignment
      const issue = createMockIssue();
      mockIssues.nodes = [issue];
      await vi.advanceTimersByTimeAsync(60000);
      expect(opts.onMessage).toHaveBeenCalledTimes(1);

      // Update the issue's updatedAt to simulate an update with new comment
      const updatedIssue = createMockIssue({
        updatedAt: new Date('2024-06-02T12:00:00Z'),
        comments: {
          nodes: [
            {
              id: 'comment-ext-1',
              body: 'Any progress on this?',
              createdAt: new Date('2024-06-02T12:00:00Z'),
              user: Promise.resolve({
                id: 'user-other-456',
                displayName: 'Alice',
                name: 'alice',
              }),
            },
          ],
        },
      });
      mockIssues.nodes = [updatedIssue];

      await vi.advanceTimersByTimeAsync(60000);

      // Should deliver the new comment
      expect(opts.onMessage).toHaveBeenCalledTimes(2);
      const commentCall = (opts.onMessage as any).mock.calls[1];
      expect(commentCall[1].content).toContain('New comment on ENG-123');
      expect(commentCall[1].content).toContain('Any progress on this?');

      await channel.disconnect();
    });

    it('prunes completed issues from tracking', async () => {
      const opts = createTestOpts();
      const channel = new LinearChannel('lin_api_key', 'user-bot-123', 60000, opts);

      // Start empty
      mockIssues.nodes = [];
      await channel.connect();

      // Add issue — first poll detects new assignment
      const issue = createMockIssue();
      mockIssues.nodes = [issue];
      await vi.advanceTimersByTimeAsync(60000);
      expect(opts.onMessage).toHaveBeenCalledTimes(1);

      // Remove the issue (simulating completion)
      mockIssues.nodes = [];
      await vi.advanceTimersByTimeAsync(60000);

      // Re-add the same issue — should trigger as new since it was pruned
      mockIssues.nodes = [issue];
      await vi.advanceTimersByTimeAsync(60000);

      // Delivered twice: once on first add, once after prune + re-add
      expect(opts.onMessage).toHaveBeenCalledTimes(2);

      await channel.disconnect();
    });
  });

  // --- Comment deduplication ---

  describe('comment deduplication', () => {
    it('skips comments from the watched user (bot)', async () => {
      const opts = createTestOpts();
      const channel = new LinearChannel('lin_api_key', 'user-bot-123', 60000, opts);

      // Start empty
      mockIssues.nodes = [];
      await channel.connect();

      // Add issue — first poll detects assignment
      const initialIssue = createMockIssue();
      mockIssues.nodes = [initialIssue];
      await vi.advanceTimersByTimeAsync(60000);
      expect(opts.onMessage).toHaveBeenCalledTimes(1);

      // Now update with a comment from the bot user
      const issueWithBotComment = createMockIssue({
        updatedAt: new Date('2024-06-02T12:00:00Z'),
        comments: {
          nodes: [
            {
              id: 'comment-bot-1',
              body: 'I posted this',
              createdAt: new Date('2024-06-02T12:00:00Z'),
              user: Promise.resolve({
                id: 'user-bot-123', // Same as the watched userId
                displayName: 'NanoClaw Bot',
                name: 'nanoclaw',
              }),
            },
          ],
        },
      });
      mockIssues.nodes = [issueWithBotComment];
      await vi.advanceTimersByTimeAsync(60000);

      // No new message should be delivered (bot's own comment ignored)
      expect(opts.onMessage).toHaveBeenCalledTimes(1);

      await channel.disconnect();
    });

    it('does not deliver the same comment twice', async () => {
      const commentNode = {
        id: 'comment-once',
        body: 'Hello',
        createdAt: new Date('2024-06-02T12:00:00Z'),
        user: Promise.resolve({
          id: 'user-other',
          displayName: 'Alice',
          name: 'alice',
        }),
      };

      const opts = createTestOpts();
      const channel = new LinearChannel('lin_api_key', 'user-bot-123', 60000, opts);

      // Start empty
      mockIssues.nodes = [];
      await channel.connect();

      // Add issue — first poll: new assignment
      const initialIssue = createMockIssue();
      mockIssues.nodes = [initialIssue];
      await vi.advanceTimersByTimeAsync(60000);
      expect(opts.onMessage).toHaveBeenCalledTimes(1);

      // First poll with comment
      const issueWithComment = createMockIssue({
        updatedAt: new Date('2024-06-02T12:00:00Z'),
        comments: { nodes: [commentNode] },
      });
      mockIssues.nodes = [issueWithComment];
      await vi.advanceTimersByTimeAsync(60000);
      expect(opts.onMessage).toHaveBeenCalledTimes(2);

      // Second poll with same comment (different updatedAt to trigger check)
      const issueWithComment2 = createMockIssue({
        updatedAt: new Date('2024-06-03T12:00:00Z'),
        comments: { nodes: [commentNode] },
      });
      mockIssues.nodes = [issueWithComment2];
      await vi.advanceTimersByTimeAsync(60000);

      // Comment should only be delivered once (still 2 total)
      expect(opts.onMessage).toHaveBeenCalledTimes(2);

      await channel.disconnect();
    });
  });

  // --- sendMessage ---

  describe('sendMessage', () => {
    it('is a no-op (agents use MCP tools to comment)', async () => {
      const issue = createMockIssue();

      const opts = createTestOpts();
      const channel = new LinearChannel('lin_api_key', 'user-bot-123', 60000, opts);

      // Connect and deliver an issue
      mockIssues.nodes = [];
      await channel.connect();
      mockIssues.nodes = [issue];
      await vi.advanceTimersByTimeAsync(60000);

      // sendMessage should not post a comment — agents use MCP tools instead
      await channel.sendMessage(LINEAR_CHANNEL_JID, 'Working on this now!');
      expect(mockCreateComment).not.toHaveBeenCalled();

      await channel.disconnect();
    });
  });

  // --- ownsJid ---

  describe('ownsJid', () => {
    it('owns linear: JIDs', () => {
      const channel = new LinearChannel('key', 'user', 30000, createTestOpts());
      expect(channel.ownsJid('linear:__channel__')).toBe(true);
    });

    it('owns linear:ABC-123 style JIDs', () => {
      const channel = new LinearChannel('key', 'user', 30000, createTestOpts());
      expect(channel.ownsJid('linear:ABC-123')).toBe(true);
    });

    it('does not own WhatsApp JIDs', () => {
      const channel = new LinearChannel('key', 'user', 30000, createTestOpts());
      expect(channel.ownsJid('12345@g.us')).toBe(false);
    });

    it('does not own Slack JIDs', () => {
      const channel = new LinearChannel('key', 'user', 30000, createTestOpts());
      expect(channel.ownsJid('slack:C012AB3CD')).toBe(false);
    });

    it('does not own unknown JID formats', () => {
      const channel = new LinearChannel('key', 'user', 30000, createTestOpts());
      expect(channel.ownsJid('random-string')).toBe(false);
    });
  });

  // --- setTyping ---

  describe('setTyping', () => {
    it('is a no-op', async () => {
      const channel = new LinearChannel('key', 'user', 30000, createTestOpts());
      await channel.connect();

      await expect(
        channel.setTyping(LINEAR_CHANNEL_JID, true),
      ).resolves.toBeUndefined();
      await expect(
        channel.setTyping(LINEAR_CHANNEL_JID, false),
      ).resolves.toBeUndefined();
    });
  });

  // --- Channel properties ---

  describe('channel properties', () => {
    it('has name "linear"', () => {
      const channel = new LinearChannel('key', 'user', 30000, createTestOpts());
      expect(channel.name).toBe('linear');
    });

    it('exports LINEAR_CHANNEL_JID constant', () => {
      expect(LINEAR_CHANNEL_JID).toBe('linear:__channel__');
    });
  });

  // --- Error handling ---

  describe('error handling', () => {
    it('poll errors are caught and logged, not thrown', async () => {
      const opts = createTestOpts();
      const channel = new LinearChannel('lin_api_key', 'user-bot-123', 60000, opts);

      mockIssues.nodes = [];
      await channel.connect();

      // Make the user() call throw
      const { LinearClient } = await import('@linear/sdk');
      const mockClient = new LinearClient({ apiKey: 'test' });
      (mockClient.user as any).mockRejectedValueOnce(new Error('Rate limited'));

      // Advance timer — poll should not throw
      await vi.advanceTimersByTimeAsync(60000);

      // Channel should still be connected
      expect(channel.isConnected()).toBe(true);

      await channel.disconnect();
    });
  });

  // --- Allowed users filtering ---

  describe('allowed users filtering', () => {
    it('delivers issue when LINEAR_ALLOWED_USERS is empty (feature disabled)', async () => {
      mockAllowedUsers.value = [];

      const issue = createMockIssue({ creatorId: 'any-user' });
      mockIssues.nodes = [issue];

      const opts = createTestOpts();
      const channel = new LinearChannel('lin_api_key', 'user-bot-123', 30000, opts);
      await channel.connect();

      expect(opts.onMessage).toHaveBeenCalledTimes(1);
      await channel.disconnect();
    });

    it('delivers issue when creator is in LINEAR_ALLOWED_USERS', async () => {
      mockAllowedUsers.value = ['allowed-user-1'];

      const issue = createMockIssue({ creatorId: 'allowed-user-1' });
      mockIssues.nodes = [issue];

      const opts = createTestOpts();
      const channel = new LinearChannel('lin_api_key', 'user-bot-123', 30000, opts);
      await channel.connect();

      expect(opts.onMessage).toHaveBeenCalledTimes(1);
      await channel.disconnect();
    });

    it('skips issue when creator is NOT in LINEAR_ALLOWED_USERS', async () => {
      mockAllowedUsers.value = ['allowed-user-1'];

      const issue = createMockIssue({ creatorId: 'blocked-user-2' });
      mockIssues.nodes = [issue];

      const opts = createTestOpts();
      const channel = new LinearChannel('lin_api_key', 'user-bot-123', 30000, opts);
      await channel.connect();

      expect(opts.onMessage).not.toHaveBeenCalled();
      await channel.disconnect();
    });

    it('still tracks filtered issues in processedIssues', async () => {
      mockAllowedUsers.value = ['allowed-user-1'];

      const issue = createMockIssue({ creatorId: 'blocked-user-2' });
      mockIssues.nodes = [issue];

      const opts = createTestOpts();
      const channel = new LinearChannel('lin_api_key', 'user-bot-123', 60000, opts);
      await channel.connect();

      // First poll: filtered (not delivered)
      expect(opts.onMessage).not.toHaveBeenCalled();

      // Second poll: same issue — should NOT re-process
      await vi.advanceTimersByTimeAsync(60000);
      expect(opts.onMessage).not.toHaveBeenCalled();

      await channel.disconnect();
    });

    it('skips comment from user not in LINEAR_ALLOWED_USERS', async () => {
      const opts = createTestOpts();
      const channel = new LinearChannel('lin_api_key', 'user-bot-123', 60000, opts);

      // Start with empty allowed list (all users accepted)
      mockAllowedUsers.value = [];
      mockIssues.nodes = [];
      await channel.connect();

      // Deliver an issue first (from allowed creator)
      const issue = createMockIssue({ creatorId: 'allowed-user-1' });
      mockIssues.nodes = [issue];
      await vi.advanceTimersByTimeAsync(60000);
      expect(opts.onMessage).toHaveBeenCalledTimes(1);

      // Now enable filtering
      mockAllowedUsers.value = ['allowed-user-1'];

      // Add a comment from a non-allowed user
      const updatedIssue = createMockIssue({
        updatedAt: new Date('2024-06-02T12:00:00Z'),
        creatorId: 'allowed-user-1',
        comments: {
          nodes: [
            {
              id: 'comment-blocked-1',
              body: 'Comment from blocked user',
              createdAt: new Date('2024-06-02T12:00:00Z'),
              user: Promise.resolve({
                id: 'blocked-user-2',
                displayName: 'Blocked',
                name: 'blocked',
              }),
            },
          ],
        },
      });
      mockIssues.nodes = [updatedIssue];
      await vi.advanceTimersByTimeAsync(60000);

      // Only the original issue delivery — comment was filtered
      expect(opts.onMessage).toHaveBeenCalledTimes(1);

      await channel.disconnect();
    });

    it('delivers comment from allowed user when filter is active', async () => {
      mockAllowedUsers.value = ['allowed-user-1'];

      const opts = createTestOpts();
      const channel = new LinearChannel('lin_api_key', 'user-bot-123', 60000, opts);

      mockIssues.nodes = [];
      await channel.connect();

      // Deliver issue from allowed creator
      const issue = createMockIssue({ creatorId: 'allowed-user-1' });
      mockIssues.nodes = [issue];
      await vi.advanceTimersByTimeAsync(60000);
      expect(opts.onMessage).toHaveBeenCalledTimes(1);

      // Add comment from the allowed user
      const updatedIssue = createMockIssue({
        updatedAt: new Date('2024-06-02T12:00:00Z'),
        creatorId: 'allowed-user-1',
        comments: {
          nodes: [
            {
              id: 'comment-allowed-1',
              body: 'Comment from allowed user',
              createdAt: new Date('2024-06-02T12:00:00Z'),
              user: Promise.resolve({
                id: 'allowed-user-1',
                displayName: 'Allowed',
                name: 'allowed',
              }),
            },
          ],
        },
      });
      mockIssues.nodes = [updatedIssue];
      await vi.advanceTimersByTimeAsync(60000);

      // Issue + comment = 2 deliveries
      expect(opts.onMessage).toHaveBeenCalledTimes(2);

      await channel.disconnect();
    });
  });
});
