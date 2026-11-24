# Design

```
agent ──MCP stdio──▶ main.ts ──▶ Session.run(code)
                                   │ 1. compile (session.ts)
                                   │ 2. Checker.check (check.ts)
                                   │ 3. run as an async function
                                   ▼
                          globals: one object per server (prelude.ts)
                                   │ server.call(tool, input)
                                   ▼
                          Server (servers.ts) ──MCP──▶ each configured server
```

## Start

`kernel.ts` connects to every server in parallel, gives each 8 seconds to respond, and lists its tools. Each server is `up`
with its tools or `down` with the reason (`servers.ts`), and a down server has no methods on the session. `prelude.ts` turns the
lists into one `declare global` block, and `schema.ts` turns each JSON Schema into a TypeScript type. A tool without an output schema returns `any`.

## A cell

1. `compile` parses the cell. A static `import` or an `export` is refused. The last statement, if it is an
   expression, is the cell's value. The rest is transpiled to JavaScript by TypeScript.
2. `Checker.check` type-checks the cell as a module against three in-memory files: the prelude, `session.d.ts`
   (names declared by earlier cells), and the cell. Errors refuse the cell with their lines.
3. The JavaScript is run as the body of an async function. Every name the session holds is a parameter, unless the
   cell declares it again. The function returns every name, old and new; the session keeps them.
4. Only then are the cell's types kept: each new name is written to `session.d.ts` as `declare const name: T` with
   `T` printed by the checker. If the checker can't read the new lines back, the cell's names become `any`. Interfaces and type aliases are kept as
   written. Classes and enums are kept as `any`.

A cell that throws or outlasts its timeout keeps no names, so types and values never disagree. A timed-out cell
cannot be stopped: it runs on in the process and its result is dropped.

Cells run one at a time, in the order they arrive.

## Sign-in

`auth.ts` is the MCP SDK's OAuth provider over one file per server, `$TS_KERNEL_STATE/auth/<server>.json`: the
registered client, the tokens, the PKCE verifier. `ts-kernel login` (`servers.ts`) registers the client, prints the address to
approve, and listens on `127.0.0.1:8976` (`$TS_KERNEL_LOGIN_PORT`) for the code. After that the server refreshes tokens itself. Without a token the kernel does not start a sign-in; it says which command to run.

## Not here

- No sandbox. A cell runs as the user, with Bun's whole API.
- No effects, cache or trace of calls. A caller that needs them puts its own MCP server in front and lists that.
