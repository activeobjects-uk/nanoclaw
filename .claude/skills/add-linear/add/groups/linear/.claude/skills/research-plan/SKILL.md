---
name: research-plan
description: Research a topic or requirement and produce a structured plan document, then attach it to the current Linear issue. Use when asked to investigate, plan, analyse, or produce a requirements document for a Linear issue.
---

# Research & Plan

You are producing a structured research/planning document for a Linear issue.

## Inputs

The skill is invoked with an issue identifier and topic, e.g.:
- `/research-plan ENG-123`
- `/research-plan ENG-123 focus on authentication approach`

If no identifier is given, use the issue from the most recent delivered message.

## Workflow

### 1. Load the issue

Use `mcp__linear__linear_get_issue` to fetch the full issue: title, description, existing comments, labels, status.

### 2. Clarify scope

Read the issue description and any comments carefully. Identify:
- The core question or requirement to research
- Any constraints mentioned (tech stack, deadlines, existing systems)
- What a good output looks like (design doc, options analysis, step-by-step plan, etc.)

### 3. Research

Use the tools available to investigate thoroughly:
- `WebSearch` / `WebFetch` — look up relevant documentation, best practices, prior art
- `Read` / `Glob` / `Grep` — search the codebase if the issue is about existing code
- `Bash` — run commands to inspect the environment if relevant
- `Task` — spawn subagents for parallel research threads if the topic is broad

Be thorough. Cite sources (URLs) for any external information.

### 4. Write the document

Save the output to:
```
issues/{IDENTIFIER}-plan.md
```

e.g. `issues/ENG-123-plan.md` relative to `/workspace/group/`.

Use this structure (adapt sections to the type of work):

```markdown
# {IDENTIFIER}: {Issue Title}

**Date:** {today}
**Status:** Draft

## Summary

One paragraph describing what was researched and the key conclusion.

## Background

Context from the issue: what problem is being solved and why it matters.

## Research Findings

### {Finding or Option A}
...

### {Finding or Option B}
...

## Recommended Approach

The recommended path forward, with reasoning.

## Implementation Plan

Step-by-step breakdown if applicable:
1. ...
2. ...

## Open Questions

- [ ] Question 1
- [ ] Question 2

## References

- [Title](URL)
```

Remove sections that aren't relevant. Add sections that are.

### 5. Attach to Linear

Use `mcp__linear__linear_create_document` to create the document directly in Linear (shows as a document icon in the issue Resources section, not a URL link):
```
identifier: {IDENTIFIER}
title: Research Plan — {Issue Title}
filePath: issues/{IDENTIFIER}-plan.md
```

### 6. Post a summary comment

Use `mcp__linear__linear_add_comment` to post a brief comment on the issue:

```
Research complete. Plan document attached above.

**Key finding:** {one sentence}

**Recommended approach:** {one sentence}

See attached document for full details.
```

## Notes

- Keep the document factual and concise — avoid padding
- If the codebase is relevant, always grep/read before making claims about it
- If the research reveals the issue is blocked on an open question, say so clearly in the document and in the comment
- Do not update the issue status — leave that to the human
