# ts-kernel

Let your agent writes TypeScript to call MCP servers

Code mode gives you upto 2x better token efficienct and 4-10x faster tool usage for tasks that require >1 external service

## Setup

1. List your servers in `~/.config/ts-kernel/servers.json`, in the `mcpServers` shape Claude Code, Codex and Droid already use:

   ```json
   {
     "mcpServers": {
       "beeper": { "url": "http://127.0.0.1:23373/v0/mcp", "scope": "read write" },
       "files": { "command": "some-mcp-server", "args": ["--stdio"] }
     }
   }
   ```

2. Sign in once to each server that wants OAuth: `ts-kernel login <name>`. A server that takes a fixed token needs no sign-in: give it `"headers": { "Authorization": "Bearer ..." }`.

3. In the agent's MCP config, replace those servers with one entry:

   ```json
   { "mcpServers": { "ts": { "command": "ts-kernel" } } }
   ```
