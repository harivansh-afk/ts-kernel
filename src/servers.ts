import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { authorizationCode, FileAuth } from "./auth.ts";
import type { HttpSpec, ServerSpec } from "./config.ts";

export type Tool = { name: string; description?: string; inputSchema?: unknown; outputSchema?: unknown };
export type Server = { name: string } & ({ kind: "up"; tools: Tool[]; client: Client } | { kind: "down"; why: string });

const CONNECT_MS = 8_000;
const CALL_MS = 300_000;
const IDENTITY = { name: "ts-kernel", version: "0.1.0" };

const httpTransport = (name: string, spec: HttpSpec, redirect: ((url: URL) => void) | null) =>
  new StreamableHTTPClientTransport(new URL(spec.url), {
    authProvider: new FileAuth(name, spec.scope, redirect),
    requestInit: { headers: spec.headers },
  });

function transport(name: string, spec: ServerSpec) {
  if ("url" in spec) return httpTransport(name, spec, null);
  const env = { ...(process.env as Record<string, string>), ...spec.env };
  return new StdioClientTransport({ command: spec.command, args: spec.args, env, stderr: "ignore" });
}

export async function connect(name: string, spec: ServerSpec): Promise<Server> {
  const client = new Client(IDENTITY);
  try {
    await client.connect(transport(name, spec), { timeout: CONNECT_MS });
    const { tools } = await client.listTools(undefined, { timeout: CONNECT_MS });
    return { name, kind: "up", tools, client };
  } catch (error) {
    await client.close().catch(() => undefined);
    return { name, kind: "down", why: error instanceof Error ? error.message : String(error) };
  }
}

export function decode(result: Record<string, unknown>): unknown {
  const content = Array.isArray(result.content) ? (result.content as { type?: string; text?: string }[]) : [];
  const text = content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
  if (result.isError) throw new Error(text || "the tool reported an error");
  if (result.structuredContent !== undefined) return result.structuredContent;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function call(client: Client, tool: string, input: unknown): Promise<unknown> {
  const request = { name: tool, arguments: (input ?? {}) as Record<string, unknown> };
  return decode(await client.callTool(request, undefined, { timeout: CALL_MS }));
}

export async function login(name: string, spec: ServerSpec, say: (line: string) => void): Promise<void> {
  if (!("url" in spec)) throw new Error(`${name} is a local command: it has no sign-in`);
  let approval: URL | undefined;
  const asking = httpTransport(name, spec, (url) => {
    approval = url;
  });
  const signedIn = await new Client(IDENTITY).connect(asking).then(
    () => true,
    (error) => {
      if (error instanceof UnauthorizedError && approval) return false;
      throw error;
    },
  );
  if (!signedIn) {
    say(`Open this address in a browser on this machine and approve:\n\n${approval}\n`);
    await asking.finishAuth(await authorizationCode());
  }
  const server = await connect(name, spec);
  if (server.kind === "down") throw new Error(server.why);
  say(`${name} is signed in: ${server.tools.length} tools`);
  await server.client.close();
}
