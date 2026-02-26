# NanoClaw Skills Architecture - Simple Guide

Welcome to the team! This document explains how NanoClaw's skill system works in plain language. If you've read the other architecture docs and felt lost, this is for you.

---

## What is NanoClaw?

NanoClaw is a personal AI assistant. At its core, it connects to WhatsApp and routes your messages to Claude (an AI) running inside isolated containers. Think of it as a middleman between your chat apps and an AI brain.

## What are Groups?

A **group** is a registered conversation that NanoClaw listens to and responds in. Each group gets its own isolated workspace — think of it like giving each conversation its own private office.

When you register a WhatsApp group chat (or a Slack channel, or a Linear integration), NanoClaw creates a folder for it under `groups/{name}/`. That folder is the group's entire world:

```
groups/
├── global/                 # Shared memory (read by all groups, written by main only)
│   └── CLAUDE.md
├── main/                   # The admin group (your self-chat)
│   ├── CLAUDE.md           # Main channel's memory
│   └── logs/
├── family-chat/            # A registered WhatsApp group
│   ├── CLAUDE.md           # This group's memory
│   ├── logs/
│   └── notes.md            # Files created by the agent
└── dev-team/               # Another registered group
    ├── CLAUDE.md
    └── logs/
```

### What makes a group a group?

Each group has:
- **A JID** — a unique identifier from the messaging platform (e.g., `120363336345536173@g.us` for WhatsApp, `slack:C1234567890` for Slack)
- **A folder** — its isolated workspace under `groups/`
- **A trigger word** — typically `@Andy` (or whatever `ASSISTANT_NAME` is set to). Messages must start with this trigger for the agent to respond.
- **Its own CLAUDE.md** — persistent memory that survives across conversations. When you say "remember this," the agent writes it here.
- **Its own container** — when a message arrives, NanoClaw spawns a Linux container that can only see this group's folder (plus read-only access to global memory). The agent literally cannot access other groups' files.

### The main group is special

The "main" group (folder name `main`, typically your WhatsApp self-chat) has admin privileges:
- It can write to global memory (`groups/global/CLAUDE.md`)
- It can register and unregister other groups
- It can schedule tasks for any group
- It can send messages to any group's chat
- It gets read-only access to the project source code

Non-main groups can only see their own folder and the shared global memory. They can only send messages to their own chat and manage their own tasks.

### How groups get registered

Groups are registered through the main channel. You tell the agent (in your self-chat): `@Andy add group "Family Chat"`. The agent then:
1. Creates a row in the SQLite database (`registered_groups` table) mapping the group's JID to a folder name
2. Creates the folder under `groups/` with a `CLAUDE.md` and `logs/` directory
3. Starts listening for triggered messages in that group

Unregistered groups are completely ignored — messages from them are never processed.

---

## How Group Memory Works

Each group has several layers of memory, each with a different purpose and lifespan.

### Layer 1: CLAUDE.md (long-term, human-readable)

Every group has a `groups/{name}/CLAUDE.md` file. This is the agent's long-term memory — the first thing it reads at the start of every conversation. It's a plain markdown file you (or the agent) can read and edit directly.

When you tell the agent "remember that I prefer short responses" or "always reply in Portuguese," it writes that to `CLAUDE.md`. The next time a container starts for this group, it reads the file and picks up where it left off.

There are three flavors:

| File | Who reads it | Who writes it |
|------|-------------|---------------|
| `groups/{name}/CLAUDE.md` | That group's agent only | That group's agent |
| `groups/global/CLAUDE.md` | Every agent (read-only) | Main group agent only |
| `groups/main/CLAUDE.md` | Main agent only | Main agent |

The **global** memory is useful for things that apply everywhere — your name, your timezone, general preferences. The main agent can update it; all other agents can read it but not write to it.

### Layer 2: Auto-memory (long-term, managed by Claude)

Claude Code has a built-in memory feature that stores facts it has learned about you in a hidden `.claude/` directory. NanoClaw gives each group its own isolated `.claude/` directory stored at `data/sessions/{folder}/.claude/`, mounted into the container at `/home/node/.claude`.

This is separate from `CLAUDE.md` — it's managed by Claude Code itself, not by the agent's instructions. You won't normally need to touch it, but it's why Claude can remember things like your coding style or preferences without you having to explicitly tell it every time.

### Layer 3: Files in the group folder (working memory)

The agent can create any files it wants inside its group folder (`groups/{name}/`). These persist between sessions just like `CLAUDE.md` does. The Linear agent, for example, stores notes in `issues/ENG-123.md` files inside the `groups/linear/` folder.

This is useful for work-in-progress state — research notes, plans, drafts — that you want to survive a container restart but that don't belong in `CLAUDE.md`.

### Layer 4: Session IDs (conversation continuity)

Every time a container runs, it produces a **session ID** from the Claude Agent SDK. NanoClaw stores this in SQLite (`sessions` table). The next time a container starts for the same group, it passes the session ID back in — which lets the agent resume the same conversation thread rather than starting fresh.

This is the "short-term" memory layer. It means you don't have to re-explain context on every message, as long as the conversation session is still active.

### How they fit together

```
New message arrives for a group
    │
    ▼
Container starts, reads:
  ├── groups/global/CLAUDE.md   (shared global context)
  ├── groups/{name}/CLAUDE.md   (this group's persistent memory)
  ├── data/sessions/{name}/.claude/  (Claude's auto-memory)
  └── groups/{name}/*.md        (any files the agent created)
    │
    ▼
Agent runs with prior session ID → conversation feels continuous
    │
    ▼
Agent may write to CLAUDE.md or create/update files → persists for next time
```

### What gets cleared vs. what persists

| When | What's lost | What survives |
|------|------------|---------------|
| Container exits | Everything in RAM | CLAUDE.md, files in group folder, session ID, auto-memory |
| Session expires | Conversation thread | CLAUDE.md, files in group folder, auto-memory |
| Group deleted | Everything | Nothing (folder is deleted) |
| NanoClaw restarts | Nothing | Everything (all memory is on disk) |

---

## What are Channels?

A **channel** is a connection to a messaging platform. If groups are "where" conversations happen, channels are "how" messages get in and out.

NanoClaw can connect to multiple messaging platforms simultaneously. Each one is a channel:

| Channel | Platform | JID Format | Example |
|---------|----------|------------|---------|
| WhatsApp | WhatsApp Web (via baileys) | `120363336345536173@g.us` | Group chats, DMs |
| Slack | Slack (via Socket Mode) | `slack:C1234567890` | Slack channels |
| Linear | Linear (via API polling) | `linear:__channel__` | Assigned issues |

### What a channel does

Every channel implements the same interface:
1. **Connect** — authenticate and establish a connection to the platform
2. **Receive messages** — listen for incoming messages and store them in SQLite
3. **Send messages** — deliver outbound messages back through the platform
4. **Own JIDs** — each channel knows which JIDs belong to it (WhatsApp owns `@g.us` JIDs, Slack owns `slack:` JIDs, etc.)

### How channels relate to groups

The relationship is simple: a group's JID determines which channel handles it. When a message needs to be sent to a group, NanoClaw asks each channel "do you own this JID?" — the one that says yes delivers the message.

```
Incoming message from WhatsApp
    │
    ▼
WhatsApp channel stores it in SQLite
    │
    ▼
Message loop picks it up, checks: is this JID registered?
    │
    ├── Yes → spawn container, run agent, get response
    │         → ask channels "who owns this JID?" → WhatsApp delivers response
    │
    └── No → ignore
```

This means you can have groups spread across different platforms — some on WhatsApp, some on Slack, one on Linear — and NanoClaw routes everything through the right channel automatically.

### Adding new channels

Channels are added via skills (like `/add-slack`, `/add-telegram`). Each skill adds a new channel implementation under `src/channels/` and wires it into the startup sequence in `src/index.ts`. The core system doesn't need to change because all channels use the same interface.

---

## What are Skills?

Skills are **add-ons** that give NanoClaw new abilities. For example:

- **add-telegram** - lets NanoClaw work with Telegram (not just WhatsApp)
- **add-slack** - connects NanoClaw to Slack
- **add-voice-transcription** - lets NanoClaw understand voice messages

The core of NanoClaw is kept small on purpose. Instead of shipping with every feature built in, users pick the skills they want.

## Why not just use plugins?

You might be thinking: "Why not just have a plugin system where skills hook into predefined extension points?"

The answer is that plugins are limited - they can only do what the plugin system allows. NanoClaw skills can change **any file in the codebase**. A skill can add new routes, modify the message router, change how containers work, add dependencies - anything. This is powerful but creates a problem: when two skills change the same file, their changes can conflict. The architecture described below is how we solve that problem.

---

## The Big Idea: Three-Way Merging

The entire system is built on a concept called **three-way merging**. Here's the analogy:

Imagine you and a coworker both have a copy of the same document. You each make different edits. Now you need to combine both sets of edits into one document. To figure out what each person changed, you compare both edited copies against the **original** document.

That's exactly what `git merge-file` does:

1. **Base** - the original, unmodified file (stored in `.nanoclaw/base/`)
2. **Current** - the file as it exists now (maybe already changed by another skill or the user)
3. **Skill's version** - the file as the skill wants it to look

Git compares both the current file and the skill's version against the base to figure out what changed, then combines both sets of changes. Most of the time, this works automatically.

---

## What Happens When There's a Conflict?

Sometimes two skills change the **same lines** of the same file. Git can't automatically combine those changes. When that happens, NanoClaw follows a three-step escalation:

### Level 1: Git handles it automatically
Most of the time, skills change different parts of a file and git merges them cleanly. No AI needed.

### Level 2: Claude Code resolves it
When git can't figure it out, Claude Code (the AI tool you're using right now) reads the skill's documentation and intent files to understand what each skill is trying to do, then resolves the conflict. It also caches the solution so the same conflict never needs resolving again.

### Level 3: Ask the user
In rare cases where the conflict is actually a product decision (e.g., "which service should get port 3000?"), Claude Code asks the user to decide.

The goal is that Level 1 handles almost everything. Level 2 is for edge cases. Level 3 is rare.

---

## The Shared Base

The `.nanoclaw/base/` folder holds a clean, unmodified copy of the core codebase. This is the "original document" from the analogy above. It never changes except during core updates.

Why does this matter? Because every three-way merge needs that original to compare against. Without it, the system wouldn't know what anyone changed.

---

## Two Types of File Changes

Not all files are treated the same way:

### Source code files (merged)
Files like `src/server.ts` or `src/config.ts` contain logic that skills weave into. These get three-way merged as described above.

### Config/data files (not merged - handled programmatically)
Files like `package.json`, `docker-compose.yml`, and `.env.example` are structured data. Instead of doing text merging on these, skills **declare** what they need and the system adds it programmatically.

For example, a skill doesn't edit `package.json` directly. Instead, its manifest says:

```yaml
structured:
  npm_dependencies:
    grammy: "^1.39.3"
  env_additions:
    - TELEGRAM_BOT_TOKEN
```

The system reads this and handles the `package.json` update, `npm install`, and `.env.example` update automatically. This avoids messy merge conflicts in JSON/YAML files.

---

## What's Inside a Skill Package?

Each skill is a folder under `skills/` with a specific structure:

```
skills/add-telegram/
  SKILL.md              -- Describes what the skill does (human-readable)
  manifest.yaml         -- Machine-readable metadata (dependencies, files, etc.)
  tests/                -- Tests that verify the skill works
    telegram.test.ts
  add/                  -- Brand new files the skill introduces
    src/channels/telegram.ts
  modify/               -- Modified versions of existing files (for merging)
    src/
      index.ts          -- The full file with the skill's changes applied
      index.ts.intent.md -- Explains what changes were made and why
```

Key things to note:
- **`add/`** contains entirely new files that get copied in
- **`modify/`** contains full copies of existing files with the skill's changes baked in (not diffs/patches)
- **`.intent.md`** files explain the purpose of changes so Claude Code can resolve conflicts intelligently

---

## The State File

`.nanoclaw/state.yaml` is the single source of truth for what's installed. It records:

- Which skills are applied (and in what order)
- File hashes (so we can detect if someone edited files manually)
- What structured operations were applied (npm packages, env vars, etc.)
- Any custom modifications the user made

This file makes it possible to **replay** an entire installation from scratch - apply the same skills in the same order on a clean codebase and get the same result.

---

## How Applying a Skill Works (Step by Step)

When you run a skill's slash command (like `/add-telegram`):

1. **Pre-flight checks** - Make sure the skill is compatible and all prerequisites are met
2. **Backup** - Copy all files that will be changed to `.nanoclaw/backup/` (safety net)
3. **Copy new files** - Files from `add/` get copied into the project
4. **Merge modified files** - Files from `modify/` get three-way merged with the current codebase
5. **Resolve any conflicts** - Using the three-level system (git -> Claude Code -> user)
6. **Handle structured operations** - Install npm packages, update env vars, etc.
7. **Update state** - Record what was done in `state.yaml`
8. **Run tests** - Even if everything merged cleanly (clean merge doesn't mean working code!)
9. **Clean up** - If tests pass, delete the backup. If they fail, restore from backup.

The backup/restore mechanism means **you can never end up in a broken state**. If anything goes wrong, you're back to where you started.

---

## How Removing a Skill Works

You might think removing a skill means "undo the changes it made." But that's hard to do cleanly. Instead, NanoClaw takes a different approach:

**Uninstall = replay everything except that skill.**

1. Read `state.yaml` to see what's installed
2. Remove the target skill from the list
3. Start from a clean base and re-apply all remaining skills in order
4. Run tests to make sure everything still works

This is slower but much more reliable than trying to reverse individual changes.

---

## How Core Updates Work

When NanoClaw itself gets updated:

- **Small fixes** merge automatically through the three-way merge (same as skills)
- **Breaking changes** (like switching default container runtime) come with a **migration skill** that automatically preserves your existing setup

For example, if a core update changes the default from Apple Containers to Docker, the update will automatically apply a migration skill that keeps Apple Containers for you. Your setup doesn't change. If you later want Docker, you remove the migration skill.

The key principle: **updates should never surprise you by changing your working setup.**

---

## The Resolution Cache

When a conflict is resolved (by Claude Code or a maintainer), the solution gets cached so nobody else has to resolve the same conflict. These cached resolutions live in `.nanoclaw/resolutions/` and ship with the project.

They have **hash enforcement** - a cached resolution only applies if the input files match exactly. This prevents stale or incorrect resolutions from being applied.

---

## Glossary

| Term | What it means |
|------|---------------|
| **Group** | A registered conversation (WhatsApp group, Slack channel, etc.) with its own isolated folder, memory, and container |
| **Channel** | A connection to a messaging platform (WhatsApp, Slack, Linear) that handles sending and receiving messages |
| **JID** | A unique identifier for a conversation, format varies by channel (e.g., `120363...@g.us` for WhatsApp) |
| **Main group** | The admin group (typically self-chat) with elevated privileges like global memory writes and cross-group messaging |
| **Skill** | An add-on package that modifies the NanoClaw codebase |
| **Three-way merge** | Combining two sets of changes by comparing both against the original |
| **Base** | The clean, unmodified core codebase (stored in `.nanoclaw/base/`) |
| **Manifest** | A YAML file declaring what a skill needs (dependencies, files, etc.) |
| **Intent file** | A markdown file explaining what changes a skill makes to a file and why |
| **Structured operations** | Programmatic changes to config files (package.json, .env, etc.) |
| **State file** | `.nanoclaw/state.yaml` - records everything about the installation |
| **Resolution cache** | Pre-computed solutions to known merge conflicts |
| **Replay** | Rebuilding the entire installation from scratch using `state.yaml` |
| **Migration skill** | A skill that preserves old behavior when the core makes a breaking change |
| **Rebase** | Flattening all accumulated changes into a clean starting point |
| **`git merge-file`** | Git command that does three-way merge on individual files |
| **`git rerere`** | Git feature that remembers how you resolved a conflict and auto-applies it next time |

---

## Key Takeaways

1. **Skills modify actual source code** - not a plugin API. This is powerful but requires merge machinery.
2. **Three-way merging is the foundation** - every code change uses base + current + new to combine changes.
3. **Three levels of conflict resolution** - git (automatic) -> Claude Code (AI) -> user (rare).
4. **Everything is safe** - backup before every operation, restore on failure.
5. **Tests always run** - a clean merge doesn't guarantee working code.
6. **State is tracked** - `state.yaml` knows exactly what's installed and can replay it.
7. **Uninstall = replay without that skill** - cleaner than trying to reverse changes.
8. **Core updates preserve your setup** - breaking changes come with migration skills that auto-apply.
