import { LinearClient, Issue, Comment } from '@linear/sdk';

import { ASSISTANT_NAME } from '../config.js';
import { getRouterState, setRouterState } from '../db.js';
import { logger } from '../logger.js';
import {
  Channel,
  OnChatMetadata,
  OnInboundMessage,
  RegisteredGroup,
} from '../types.js';

export const LINEAR_CHANNEL_JID = 'linear:__channel__';

export interface LinearChannelOpts {
  onMessage: OnInboundMessage;
  onChatMetadata: OnChatMetadata;
  registeredGroups: () => Record<string, RegisteredGroup>;
}

export class LinearChannel implements Channel {
  name = 'linear';

  private client: LinearClient | null = null;
  private opts: LinearChannelOpts;
  private apiKey: string;
  private userId: string;
  private pollInterval: number;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private connected = false;

  // Deduplication state
  private processedIssues: Map<string, string> = new Map(); // issueId → updatedAt ISO
  private processedCommentIds: Set<string> = new Set();
  private botCommentIds: Set<string> = new Set();
  private lastDeliveredIssueId: string | null = null;

  constructor(
    apiKey: string,
    userId: string,
    pollInterval: number,
    opts: LinearChannelOpts,
  ) {
    this.apiKey = apiKey;
    this.userId = userId;
    this.pollInterval = pollInterval;
    this.opts = opts;
  }

  private loadState(): void {
    const raw = getRouterState('linear:processedIssues');
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, string>;
      this.processedIssues = new Map(Object.entries(parsed));
    }
  }

  private saveState(): void {
    setRouterState(
      'linear:processedIssues',
      JSON.stringify(Object.fromEntries(this.processedIssues)),
    );
  }

  async connect(): Promise<void> {
    this.client = new LinearClient({ apiKey: this.apiKey });

    // Validate connection
    const viewer = await this.client.viewer;
    logger.info(
      { userId: this.userId, viewerName: viewer.displayName },
      'Linear client connected',
    );
    console.log(`\n  Linear: watching assignments for ${viewer.displayName}`);
    console.log(`  JID: ${LINEAR_CHANNEL_JID}\n`);

    this.connected = true;

    // Load persisted state so we can detect new issues assigned during downtime
    this.loadState();

    // First poll — delivers any issues assigned while offline
    await this.poll();

    // Start polling loop
    this.pollTimer = setInterval(() => this.poll(), this.pollInterval);
  }

  private async poll(): Promise<void> {
    if (!this.client) return;

    try {
      const user = await this.client.user(this.userId);
      const assignedIssues = await user.assignedIssues({
        filter: {
          state: { type: { nin: ['completed', 'canceled'] } },
        },
        first: 50,
      });

      const currentIssueIds = new Set<string>();

      for (const issue of assignedIssues.nodes) {
        const issueId = issue.id;
        const updatedAt = issue.updatedAt.toISOString();
        currentIssueIds.add(issueId);

        if (!this.processedIssues.has(issueId)) {
          // New assignment
          this.processedIssues.set(issueId, updatedAt);
          // Mark all existing comments as seen to avoid flooding
          await this.markExistingComments(issue);
          await this.deliverIssue(issue, 'assigned');
        } else if (updatedAt !== this.processedIssues.get(issueId)) {
          // Issue updated — check for new comments
          this.processedIssues.set(issueId, updatedAt);
          await this.checkNewComments(issue);
        }
      }

      // Prune issues that are no longer assigned (completed/canceled/unassigned)
      for (const [issueId] of this.processedIssues) {
        if (!currentIssueIds.has(issueId)) {
          this.processedIssues.delete(issueId);
        }
      }

      // Prune old comment IDs to prevent unbounded memory growth (keep last 5000)
      if (this.processedCommentIds.size > 5000) {
        const arr = [...this.processedCommentIds];
        this.processedCommentIds = new Set(arr.slice(-2500));
      }
      if (this.botCommentIds.size > 1000) {
        const arr = [...this.botCommentIds];
        this.botCommentIds = new Set(arr.slice(-500));
      }

      this.saveState();
    } catch (err) {
      logger.error({ err }, 'Linear poll error');
    }
  }

  private async markExistingComments(issue: Issue): Promise<void> {
    try {
      const comments = await issue.comments({ first: 50 });
      for (const comment of comments.nodes) {
        this.processedCommentIds.add(comment.id);
      }
    } catch (err) {
      logger.warn({ err, issueId: issue.id }, 'Failed to mark existing comments');
    }
  }

  private async deliverIssue(issue: Issue, trigger: 'assigned' | 'comment'): Promise<void> {
    const state = await issue.state;
    const labels = await issue.labels();
    const timestamp = new Date().toISOString();

    this.lastDeliveredIssueId = issue.id;

    // Record chat metadata for discovery
    this.opts.onChatMetadata(
      LINEAR_CHANNEL_JID,
      timestamp,
      `Linear: ${issue.identifier}`,
      'linear',
      false,
    );

    const labelNames = labels.nodes.map((l) => l.name).join(', ');
    const triggerLabel = trigger === 'assigned' ? 'Issue Assigned' : 'Issue Updated';

    const content = [
      `@${ASSISTANT_NAME} [Linear ${triggerLabel}]`,
      `Issue: ${issue.identifier} — ${issue.title}`,
      `Status: ${state?.name || 'Unknown'}`,
      `Priority: ${issue.priority ?? 'None'}`,
      labelNames ? `Labels: ${labelNames}` : null,
      `URL: ${issue.url}`,
      ``,
      issue.description || '(no description)',
    ]
      .filter(Boolean)
      .join('\n');

    this.opts.onMessage(LINEAR_CHANNEL_JID, {
      id: `${issue.id}-${trigger}-${Date.now()}`,
      chat_jid: LINEAR_CHANNEL_JID,
      sender: 'linear',
      sender_name: 'Linear',
      content,
      timestamp,
      is_from_me: false,
      is_bot_message: false,
    });

    logger.info(
      { identifier: issue.identifier, trigger },
      'Linear issue delivered',
    );
  }

  private async checkNewComments(issue: Issue): Promise<void> {
    try {
      const comments = await issue.comments({ first: 20 });

      for (const comment of comments.nodes) {
        if (this.processedCommentIds.has(comment.id)) continue;
        if (this.botCommentIds.has(comment.id)) continue;
        this.processedCommentIds.add(comment.id);

        const commentUser = await comment.user;
        if (!commentUser) continue;

        // Skip comments from the bot's own Linear account to prevent loops
        if (commentUser.id === this.userId) continue;

        this.lastDeliveredIssueId = issue.id;
        const timestamp = comment.createdAt.toISOString();

        this.opts.onMessage(LINEAR_CHANNEL_JID, {
          id: comment.id,
          chat_jid: LINEAR_CHANNEL_JID,
          sender: commentUser.id,
          sender_name: commentUser.displayName || commentUser.name,
          content: `@${ASSISTANT_NAME} [New comment on ${issue.identifier} (commentId: ${comment.id})]\n\n${comment.body}`,
          timestamp,
          is_from_me: false,
          is_bot_message: false,
        });

        logger.info(
          { identifier: issue.identifier, commentUser: commentUser.name },
          'Linear comment delivered',
        );
      }
    } catch (err) {
      logger.warn({ err, issueId: issue.id }, 'Failed to check comments');
    }
  }

  async sendMessage(_jid: string, _text: string): Promise<void> {
    // Linear agents communicate exclusively via MCP tools (mcp__linear__linear_add_comment).
    // Posting the agent's text output as an auto-comment causes duplicate/narration noise.
  }

  isConnected(): boolean {
    return this.connected;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith('linear:');
  }

  async disconnect(): Promise<void> {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.client = null;
    this.connected = false;
    logger.info('Linear channel disconnected');
  }

  async setTyping(_jid: string, _isTyping: boolean): Promise<void> {
    // Linear has no typing indicator concept
  }
}
