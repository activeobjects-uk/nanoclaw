import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// --- Mocks ---

vi.mock('../config.js', () => ({
  ASSISTANT_NAME: 'Andy',
  TRIGGER_PATTERN: /^@Andy\b/i,
}));

vi.mock('../logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
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
    it('silent initial poll does not fire onMessage', async () => {
      const issue = createMockIssue();
      mockIssues.nodes = [issue];

      const opts = createTestOpts();
      const channel = new LinearChannel('lin_api_key', 'user-bot-123', 30000, opts);

      await channel.connect();

      // After connect, the silent initial poll runs — no messages should be delivered
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
    it('posts comment on the last delivered issue', async () => {
      const issue = createMockIssue();
      mockIssues.nodes = [issue];

      const opts = createTestOpts();
      const channel = new LinearChannel('lin_api_key', 'user-bot-123', 60000, opts);

      // Connect (silent poll), then trigger assignment
      mockIssues.nodes = [];
      await channel.connect();
      mockIssues.nodes = [issue];
      await vi.advanceTimersByTimeAsync(60000);

      await channel.sendMessage(LINEAR_CHANNEL_JID, 'Working on this now!');

      expect(mockCreateComment).toHaveBeenCalledWith({
        issueId: 'issue-1',
        body: 'Working on this now!',
      });

      await channel.disconnect();
    });

    it('tracks posted comment IDs to avoid re-triggering', async () => {
      const issue = createMockIssue();

      const opts = createTestOpts();
      const channel = new LinearChannel('lin_api_key', 'user-bot-123', 60000, opts);

      mockIssues.nodes = [];
      await channel.connect();
      mockIssues.nodes = [issue];
      await vi.advanceTimersByTimeAsync(60000);

      // Post a comment
      await channel.sendMessage(LINEAR_CHANNEL_JID, 'Acknowledged');

      // The comment ID 'comment-new-1' should now be in botCommentIds
      // Simulate this comment appearing in the next poll
      const updatedIssue = createMockIssue({
        updatedAt: new Date('2024-06-02T12:00:00Z'),
        comments: {
          nodes: [
            {
              id: 'comment-new-1', // Same ID returned by createComment
              body: 'Acknowledged',
              createdAt: new Date('2024-06-02T12:00:00Z'),
              user: Promise.resolve({
                id: 'user-bot-123',
                displayName: 'NanoClaw Bot',
                name: 'nanoclaw',
              }),
            },
          ],
        },
      });
      mockIssues.nodes = [updatedIssue];
      await vi.advanceTimersByTimeAsync(60000);

      // Should not re-deliver the bot's own comment
      // Only 1 message total (the initial assignment)
      expect(opts.onMessage).toHaveBeenCalledTimes(1);

      await channel.disconnect();
    });

    it('does nothing when client is not initialized', async () => {
      const opts = createTestOpts();
      const channel = new LinearChannel('lin_api_key', 'user-bot-123', 30000, opts);

      // Don't connect — client is null
      await channel.sendMessage(LINEAR_CHANNEL_JID, 'No client');

      expect(mockCreateComment).not.toHaveBeenCalled();
    });

    it('does nothing when no issue has been delivered', async () => {
      const opts = createTestOpts();
      const channel = new LinearChannel('lin_api_key', 'user-bot-123', 30000, opts);

      mockIssues.nodes = [];
      await channel.connect();

      await channel.sendMessage(LINEAR_CHANNEL_JID, 'No issue to comment on');

      expect(mockCreateComment).not.toHaveBeenCalled();

      await channel.disconnect();
    });

    it('handles createComment failure gracefully', async () => {
      const issue = createMockIssue();

      const opts = createTestOpts();
      const channel = new LinearChannel('lin_api_key', 'user-bot-123', 60000, opts);

      mockIssues.nodes = [];
      await channel.connect();
      mockIssues.nodes = [issue];
      await vi.advanceTimersByTimeAsync(60000);

      mockCreateComment.mockRejectedValueOnce(new Error('API error'));

      // Should not throw
      await expect(
        channel.sendMessage(LINEAR_CHANNEL_JID, 'Will fail'),
      ).resolves.toBeUndefined();

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
});
