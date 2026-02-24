# Intent: container/agent-runner/src/index.ts modifications

## What changed
Added Linear MCP server registration and `mcp__linear__*` to allowed tools.

## Key sections
- **allowedTools**: Must include `'mcp__linear__*'` in the array
- **mcpServers**: Must include conditional Linear MCP server:
  ```typescript
  ...(sdkEnv.LINEAR_API_KEY ? {
    linear: {
      command: 'node',
      args: [path.join(path.dirname(mcpServerPath), 'linear-mcp.js')],
      env: { LINEAR_API_KEY: sdkEnv.LINEAR_API_KEY },
    },
  } : {}),
  ```

## Invariants
- All existing MCP servers (nanoclaw) remain unchanged
- Linear MCP server is conditional on `sdkEnv.LINEAR_API_KEY` being present
- Uses `path.dirname(mcpServerPath)` to locate linear-mcp.js (NOT `__dirname` which is unavailable in runQuery scope)
- All existing allowed tools remain
- No other changes to the agent-runner

## Must-keep
- Existing nanoclaw MCP server config
- All existing allowedTools entries
- The sdkEnv pattern for environment variables
