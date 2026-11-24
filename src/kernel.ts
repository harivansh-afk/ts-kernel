import { Checker } from "./check.ts";
import type { Config } from "./config.ts";
import { declarations, globals, makeHelp } from "./prelude.ts";
import { connect } from "./servers.ts";
import { Session } from "./session.ts";

export type Kernel = { session: Session; description: string; types: string; close(): Promise<void> };

const INTRODUCTION = [
  "Run TypeScript in a session that lasts. Top-level await works, the names a cell declares stay for later cells, and the value of the last expression is returned after what console.log printed.",
  "A cell is type-checked first and does not run if it has a type error.",
  "Each connected server is a global whose methods are its tools. Filter, join and loop in the cell, and return only what you need.",
  "help('server.tool') shows one tool's description and signature. The tools:",
];

export async function start(config: Config): Promise<Kernel> {
  const servers = await Promise.all(Object.entries(config.mcpServers).map(([name, spec]) => connect(name, spec)));
  const types = declarations(servers);
  return {
    session: new Session(globals(servers), new Checker(types)),
    description: [...INTRODUCTION, "", makeHelp(servers)()].join("\n"),
    types,
    close: async () => {
      await Promise.all(servers.map((server) => server.kind === "up" && server.client.close()));
    },
  };
}
