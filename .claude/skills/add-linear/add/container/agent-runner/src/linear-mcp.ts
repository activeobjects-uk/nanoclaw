/**
 * Linear MCP Server for NanoClaw
 * Standalone process that provides Linear tools to the container agent.
 * Reads LINEAR_API_KEY from environment variable.
 */

import fs from 'fs';
import path from 'path';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { LinearClient } from '@linear/sdk';

const LINEAR_API_KEY = process.env.LINEAR_API_KEY;
if (!LINEAR_API_KEY) {
  console.error('[linear-mcp] LINEAR_API_KEY not set');
  process.exit(1);
}

const client = new LinearClient({ apiKey: LINEAR_API_KEY });

/**
 * Resolve an issue identifier (e.g., "ENG-123") to an Issue object.
 */
async function resolveIssue(identifier: string) {
  const results = await client.searchIssues(identifier, { first: 5 });
  // Find exact match by identifier
  const exact = results.nodes.find(
    (i) => i.identifier.toLowerCase() === identifier.toLowerCase(),
  );
  const match = exact || results.nodes[0];
  if (!match) return null;
  // Fetch the full Issue object (IssueSearchResult lacks relations like labels/comments)
  return client.issue(match.id);
}

const server = new McpServer({
  name: 'linear',
  version: '1.0.0',
});

server.tool(
  'linear_get_issue',
  'Get full details of a Linear issue including title, description, status, priority, labels, assignee, and recent comments.',
  {
    identifier: z.string().describe('Issue identifier (e.g., "ENG-123")'),
  },
  async (args) => {
    try {
      const issue = await resolveIssue(args.identifier);
      if (!issue) {
        return {
          content: [{ type: 'text' as const, text: `Issue "${args.identifier}" not found.` }],
          isError: true,
        };
      }

      const state = await issue.state;
      const assignee = await issue.assignee;
      const labels = await issue.labels();
      const comments = await issue.comments({ first: 10 });

      const result = {
        identifier: issue.identifier,
        title: issue.title,
        description: issue.description || null,
        status: state?.name || 'Unknown',
        priority: issue.priority,
        priorityLabel: issue.priorityLabel,
        assignee: assignee ? { id: assignee.id, name: assignee.displayName || assignee.name } : null,
        labels: labels.nodes.map((l) => l.name),
        url: issue.url,
        createdAt: issue.createdAt.toISOString(),
        updatedAt: issue.updatedAt.toISOString(),
        comments: await Promise.all(
          comments.nodes.map(async (c) => {
            const user = await c.user;
            const parent = await c.parent;
            return {
              id: c.id,
              parentId: parent?.id || null,
              body: c.body,
              author: user?.displayName || user?.name || 'Unknown',
              createdAt: c.createdAt.toISOString(),
            };
          }),
        ),
      };

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Error getting issue: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  'linear_update_issue',
  'Update fields on a Linear issue such as status, priority, title, or description.',
  {
    identifier: z.string().describe('Issue identifier (e.g., "ENG-123")'),
    stateId: z.string().optional().describe('New workflow state ID (use linear_list_states to find IDs)'),
    priority: z.number().optional().describe('Priority: 0=None, 1=Urgent, 2=High, 3=Medium, 4=Low'),
    title: z.string().optional().describe('New title'),
    description: z.string().optional().describe('New description (markdown)'),
    assigneeId: z.string().optional().describe('New assignee user ID'),
  },
  async (args) => {
    try {
      const issue = await resolveIssue(args.identifier);
      if (!issue) {
        return {
          content: [{ type: 'text' as const, text: `Issue "${args.identifier}" not found.` }],
          isError: true,
        };
      }

      const updates: Record<string, unknown> = {};
      if (args.stateId) updates.stateId = args.stateId;
      if (args.priority !== undefined) updates.priority = args.priority;
      if (args.title) updates.title = args.title;
      if (args.description) updates.description = args.description;
      if (args.assigneeId) updates.assigneeId = args.assigneeId;

      if (Object.keys(updates).length === 0) {
        return {
          content: [{ type: 'text' as const, text: 'No updates provided.' }],
          isError: true,
        };
      }

      await client.updateIssue(issue.id, updates);

      return {
        content: [{ type: 'text' as const, text: `Issue ${args.identifier} updated: ${Object.keys(updates).join(', ')}` }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Error updating issue: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  'linear_add_comment',
  'Add a comment to a Linear issue. Use parentId to reply in a thread.',
  {
    identifier: z.string().describe('Issue identifier (e.g., "ENG-123")'),
    body: z.string().describe('Comment body (markdown supported)'),
    parentId: z.string().optional().describe('Parent comment ID to reply to (creates a threaded reply)'),
  },
  async (args) => {
    try {
      const issue = await resolveIssue(args.identifier);
      if (!issue) {
        return {
          content: [{ type: 'text' as const, text: `Issue "${args.identifier}" not found.` }],
          isError: true,
        };
      }

      const commentInput: Record<string, string> = {
        issueId: issue.id,
        body: args.body,
      };
      if (args.parentId) {
        // Linear only allows replies to top-level comments.
        // If the target comment is itself a reply, walk up to the root.
        let topLevelId = args.parentId;
        try {
          const parentComment = await client.comment({ id: args.parentId });
          const grandparent = await parentComment.parent;
          if (grandparent) {
            topLevelId = grandparent.id;
          }
        } catch {
          // If we can't fetch the parent, use the ID as-is
        }
        commentInput.parentId = topLevelId;
      }

      await client.createComment(commentInput);

      return {
        content: [{ type: 'text' as const, text: `Comment added to ${args.identifier}${args.parentId ? ' (threaded reply)' : ''}.` }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Error adding comment: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  'linear_search_issues',
  'Search for Linear issues by text query. Returns matching issues with their status and assignee.',
  {
    query: z.string().describe('Search text (matches title, description, identifier)'),
    limit: z.number().optional().default(10).describe('Max results (default 10)'),
  },
  async (args) => {
    try {
      const results = await client.searchIssues(args.query, {
        first: Math.min(args.limit ?? 10, 50),
      });

      const issues = await Promise.all(
        results.nodes.map(async (issue) => {
          const state = await issue.state;
          const assignee = await issue.assignee;
          return {
            identifier: issue.identifier,
            title: issue.title,
            status: state?.name || 'Unknown',
            priority: issue.priorityLabel,
            assignee: assignee?.displayName || assignee?.name || 'Unassigned',
            url: issue.url,
          };
        }),
      );

      if (issues.length === 0) {
        return {
          content: [{ type: 'text' as const, text: `No issues found for "${args.query}".` }],
        };
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(issues, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Error searching issues: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  'linear_create_issue',
  'Create a new Linear issue.',
  {
    title: z.string().describe('Issue title'),
    teamId: z.string().describe('Team ID (use linear_list_teams to find)'),
    description: z.string().optional().describe('Issue description (markdown)'),
    priority: z.number().optional().describe('Priority: 0=None, 1=Urgent, 2=High, 3=Medium, 4=Low'),
    stateId: z.string().optional().describe('Initial workflow state ID'),
    assigneeId: z.string().optional().describe('Assignee user ID'),
  },
  async (args) => {
    try {
      const input: Record<string, unknown> = {
        title: args.title,
        teamId: args.teamId,
      };
      if (args.description) input.description = args.description;
      if (args.priority !== undefined) input.priority = args.priority;
      if (args.stateId) input.stateId = args.stateId;
      if (args.assigneeId) input.assigneeId = args.assigneeId;

      const payload = await client.createIssue(input as any);
      const issue = await payload.issue;

      return {
        content: [{
          type: 'text' as const,
          text: issue
            ? `Issue created: ${issue.identifier} — ${issue.title}\nURL: ${issue.url}`
            : 'Issue created.',
        }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Error creating issue: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  'linear_list_teams',
  'List all Linear teams. Use this to find team IDs for creating issues.',
  {},
  async () => {
    try {
      const teams = await client.teams();
      const result = teams.nodes.map((t) => ({
        id: t.id,
        name: t.name,
        key: t.key,
      }));

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Error listing teams: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  'linear_list_states',
  'List workflow states for a team. Use this to find state IDs for updating issue status.',
  {
    teamId: z.string().describe('Team ID'),
  },
  async (args) => {
    try {
      const team = await client.team(args.teamId);
      const states = await team.states();
      const result = states.nodes.map((s) => ({
        id: s.id,
        name: s.name,
        type: s.type,
        position: s.position,
      }));

      // Sort by position for natural ordering
      result.sort((a, b) => a.position - b.position);

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Error listing states: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  },
);

function getContentType(filename: string): string {
  const types: Record<string, string> = {
    '.md': 'text/markdown',
    '.txt': 'text/plain',
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.json': 'application/json',
    '.csv': 'text/csv',
    '.html': 'text/html',
    '.zip': 'application/zip',
  };
  return types[path.extname(filename).toLowerCase()] ?? 'application/octet-stream';
}

server.tool(
  'linear_upload_file',
  'Upload a file from the workspace and attach it to a Linear issue. File path is relative to /workspace/group/ or absolute.',
  {
    identifier: z.string().describe('Issue identifier (e.g., "ENG-123")'),
    filePath: z.string().describe('File path relative to /workspace/group/ (e.g., "planning.md") or absolute'),
    title: z.string().optional().describe('Attachment title (defaults to filename)'),
  },
  async (args) => {
    try {
      const resolvedPath = args.filePath.startsWith('/')
        ? args.filePath
        : path.join('/workspace/group', args.filePath);

      if (!fs.existsSync(resolvedPath)) {
        return {
          content: [{ type: 'text' as const, text: `File not found: ${resolvedPath}` }],
          isError: true,
        };
      }

      const fileContent = fs.readFileSync(resolvedPath);
      const fileName = path.basename(resolvedPath);
      const contentType = getContentType(fileName);
      const title = args.title ?? fileName;

      // Step 1: Get presigned upload credentials from Linear
      const uploadRes = await fetch('https://api.linear.app/graphql', {
        method: 'POST',
        headers: { Authorization: LINEAR_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `mutation FileUpload($contentType: String!, $size: Int!, $filename: String!) {
            fileUpload(contentType: $contentType, size: $size, filename: $filename) {
              success
              uploadFile { uploadUrl assetUrl headers { key value } }
            }
          }`,
          variables: { contentType, size: fileContent.length, filename: fileName },
        }),
      });
      const uploadData = await uploadRes.json() as any;
      if (!uploadData.data?.fileUpload?.success) {
        return {
          content: [{ type: 'text' as const, text: `Failed to get upload credentials: ${JSON.stringify(uploadData.errors ?? uploadData)}` }],
          isError: true,
        };
      }

      const { uploadUrl, assetUrl, headers: uploadHeaders } = uploadData.data.fileUpload.uploadFile;

      // Step 2: PUT file to S3
      const putHeaders: Record<string, string> = { 'Content-Type': contentType };
      for (const h of uploadHeaders) putHeaders[h.key] = h.value;

      const putRes = await fetch(uploadUrl, { method: 'PUT', headers: putHeaders, body: fileContent });
      if (!putRes.ok) {
        return {
          content: [{ type: 'text' as const, text: `S3 upload failed: ${putRes.status} ${putRes.statusText}` }],
          isError: true,
        };
      }

      // Step 3: Create attachment on the issue
      const issue = await resolveIssue(args.identifier);
      if (!issue) {
        return {
          content: [{ type: 'text' as const, text: `Issue "${args.identifier}" not found.` }],
          isError: true,
        };
      }

      const attachRes = await fetch('https://api.linear.app/graphql', {
        method: 'POST',
        headers: { Authorization: LINEAR_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `mutation AttachmentCreate($input: AttachmentCreateInput!) {
            attachmentCreate(input: $input) {
              success
              attachment { id url title }
            }
          }`,
          variables: { input: { issueId: issue.id, url: assetUrl, title } },
        }),
      });
      const attachData = await attachRes.json() as any;
      if (!attachData.data?.attachmentCreate?.success) {
        return {
          content: [{ type: 'text' as const, text: `File uploaded but attachment creation failed: ${JSON.stringify(attachData.errors ?? attachData)}` }],
          isError: true,
        };
      }

      return {
        content: [{ type: 'text' as const, text: `Attached "${fileName}" to ${args.identifier}.\nURL: ${assetUrl}` }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Error uploading file: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  },
);

// Start the stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);
