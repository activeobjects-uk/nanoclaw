# Manage Linear Issues

Use this skill when working with Linear issues — triaging, updating status, creating sub-issues, or bulk operations.

## Triage a new issue

1. Fetch full details: `mcp__linear__linear_get_issue` with the identifier
2. Read the description and any existing comments
3. Determine priority based on content (Urgent/High/Medium/Low)
4. Set priority and move to the appropriate state: `mcp__linear__linear_update_issue`
5. Add a comment summarizing your triage assessment: `mcp__linear__linear_add_comment`

## Update issue status

1. List available workflow states for the team: `mcp__linear__linear_list_states`
2. Find the target state ID (e.g., "In Progress", "Done", "In Review")
3. Update: `mcp__linear__linear_update_issue` with `stateId`

## Create sub-issues

1. Get the parent issue details to understand the team: `mcp__linear__linear_get_issue`
2. List teams if needed: `mcp__linear__linear_list_teams`
3. Create each sub-issue: `mcp__linear__linear_create_issue` with the teamId
4. Reference the parent issue identifier in the description

## Search and link related issues

1. Search by keywords: `mcp__linear__linear_search_issues`
2. Review results for duplicates or related work
3. Add a comment on the current issue linking to related ones

## Reply to comments

1. Get the issue to see recent comments: `mcp__linear__linear_get_issue`
2. Find the comment ID you want to reply to
3. Use `mcp__linear__linear_add_comment` with `parentId` set to the comment ID

## Track your work

- Save notes per issue in `issues/{IDENTIFIER}.md`
- Update `context.md` with patterns, team conventions, or recurring decisions
