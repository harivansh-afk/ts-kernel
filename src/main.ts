#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { defaultConfigPath, loadConfig, type Config } from "./config.ts";
import { start } from "./kernel.ts";
import { login } from "./servers.ts";
import { DEFAULT_TIMEOUT_MS } from "./session.ts";

type Command = (config: Config, args: string[]) => Promise<number>;

const USAGE = `ts-kernel [--config servers.json] [command]

  serve            the MCP server on stdio, with one tool, ts (the default)
  run <code>       run one cell and print its answer; with no code, reads stdin
  login <server>   sign in to a server that wants OAuth`;

const serve: Command = async (config) => {
  const kernel = await start(config);
  const server = new McpServer({ name: "ts-kernel", version: "0.1.0" });
  const inputSchema = {
    code: z.string().describe("TypeScript to run as a cell"),
    timeout_ms: z.number().optional().describe(`stop waiting for the cell after this long; default ${DEFAULT_TIMEOUT_MS}`),
  };
  server.registerTool("ts", { description: kernel.description, inputSchema }, async ({ code, timeout_ms }) => {
    const answer = await kernel.session.run(code, timeout_ms);
    return { content: [{ type: "text", text: answer.text }], isError: answer.error };
  });
  await server.connect(new StdioServerTransport());
  await new Promise((closed) => process.stdin.on("close", closed));
  await kernel.close();
  return 0;
};

const run: Command = async (config, args) => {
  const kernel = await start(config);
  const answer = await kernel.session.run(args.length ? args.join(" ") : await Bun.stdin.text());
  console.log(answer.text);
  await kernel.close();
  return answer.error ? 1 : 0;
};

const signIn: Command = async (config, [name]) => {
  const spec = name === undefined ? undefined : config.mcpServers[name];
  if (name === undefined || !spec) throw new Error(`login needs one of: ${Object.keys(config.mcpServers).join(", ")}`);
  await login(name, spec, console.log);
  return 0;
};

const COMMANDS: Record<string, Command> = { serve, run, login: signIn };

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({ options: { config: { type: "string" }, help: { type: "boolean", short: "h" } }, allowPositionals: true });
  const [name = "serve", ...args] = positionals;
  const command = COMMANDS[name];
  if (values.help || !command) {
    console.error(USAGE);
    return values.help ? 0 : 2;
  }
  return command(loadConfig(values.config ?? defaultConfigPath()), args);
}

process.exit(
  await main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }),
);
