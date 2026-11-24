# ts-kernel

One MCP tool, `ts`, in front of all your MCP servers. The agent writes TypeScript, and each server is a global whose methods are its tools, typed from the server's own schemas.

```ts
const chats = await beeper.search_chats({ query: "sam", limit: 3 });
const last = await beeper.list_messages({ chatID: chats.items[0].id });
last.items.slice(-5).map((m) => m.text)
```

Cells share one session: a name declared in one is there in the next, with its type. A cell is type-checked before it runs. The value of the last expression comes back after anything `console.log` printed.

## Set up

1. List your servers in `~/.config/ts-kernel/servers.json`, in the `mcpServers` shape Claude Code, Codex and Droid already use:

   ```json
   {
     "mcpServers": {
       "beeper": { "url": "http://127.0.0.1:23373/v0/mcp", "scope": "read write" },
       "files": { "command": "some-mcp-server", "args": ["--stdio"] }
     }
   }
   ```

2. Sign in once to each server that wants OAuth: `ts-kernel login beeper`. A server that takes a fixed token needs no sign-in: give it `"headers": { "Authorization": "Bearer ..." }`.

3. In the agent's MCP config, replace those servers with one entry:

   ```json
   { "mcpServers": { "ts": { "command": "ts-kernel" } } }
   ```

[docs/design.md](docs/design.md) says how the parts fit.
