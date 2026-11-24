import { identifier, inputOptional, key, typeOf } from "./schema.ts";
import { call, type Server, type Tool } from "./servers.ts";

const METHOD_PAD = "    ";

const toolsOf = (server: Server): Tool[] => (server.kind === "up" ? server.tools : []);

const firstLine = (text = ""): string => text.trim().split("\n")[0] ?? "";

function signature(tool: Tool, pad = ""): string {
  const optional = inputOptional(tool.inputSchema) ? "?" : "";
  const output = tool.outputSchema ? typeOf(tool.outputSchema, pad) : "any";
  return `${key(tool.name)}(input${optional}: ${typeOf(tool.inputSchema, pad)}): Promise<${output}>`;
}

export function declarations(servers: readonly Server[]): string {
  const blocks = servers.map((server) => {
    const methods = toolsOf(server).map((tool) => `${METHOD_PAD}${signature(tool, METHOD_PAD)};`);
    return `  const ${identifier(server.name)}: {\n${methods.join("\n")}\n  };`;
  });
  return ["declare global {", ...blocks, "  function help(name?: string): string;", "}", "export {};", ""].join("\n");
}

function overview(servers: readonly Server[]): string {
  return servers
    .map((server) => {
      const name = identifier(server.name);
      if (server.kind === "down") return `${name} (not connected: ${server.why})`;
      return [name, ...server.tools.map((tool) => `  ${name}.${tool.name}: ${firstLine(tool.description)}`)].join("\n");
    })
    .join("\n");
}

export function instructions(servers: readonly Server[]): string {
  const reachable = servers.map((server) => `${identifier(server.name)} (${server.kind === "up" ? `${server.tools.length} tools` : "not connected"})`);
  return [
    `The ts tool is the only way to reach: ${reachable.join(", ")}. They have no other tool and no CLI.`,
    "Call ts with TypeScript. Each of them is a global whose methods are its tools: `await server.tool({ ... })`.",
    "`help()` lists every tool; `help('server.tool')` shows one tool's arguments. Arguments are typed, so pass them plainly.",
  ].join(" ");
}

export function makeHelp(servers: readonly Server[]): (name?: string) => string {
  return (name) => {
    if (!name) return overview(servers);
    const [serverName, toolName] = name.split(".");
    const server = servers.find((candidate) => identifier(candidate.name) === serverName);
    if (!server) return `no server ${serverName}; there are: ${servers.map((s) => identifier(s.name)).join(", ")}`;
    const tools = toolsOf(server).filter((tool) => !toolName || tool.name === toolName);
    if (!tools.length) return `no ${name}; ${serverName} has: ${toolsOf(server).map((tool) => tool.name).join(", ") || "no tools"}`;
    return tools.map((tool) => `${(tool.description ?? "").trim()}\n${serverName}.${signature(tool)}`).join("\n\n");
  };
}

export function globals(servers: readonly Server[]): Record<string, unknown> {
  const methods = (server: Server) => {
    if (server.kind === "down") return {};
    return Object.fromEntries(server.tools.map((tool) => [tool.name, (input?: unknown) => call(server.client, tool.name, input)]));
  };
  return { help: makeHelp(servers), ...Object.fromEntries(servers.map((server) => [identifier(server.name), methods(server)])) };
}
