import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type HttpSpec = { url: string; headers?: Record<string, string>; scope?: string };
export type StdioSpec = { command: string; args?: string[]; env?: Record<string, string> };
export type ServerSpec = HttpSpec | StdioSpec;
export type Config = { mcpServers: Record<string, ServerSpec> };

const home = (variable: string, ...fallback: string[]): string => process.env[variable] ?? join(homedir(), ...fallback);

export const stateDir = (): string => process.env.TS_KERNEL_STATE ?? join(home("XDG_STATE_HOME", ".local", "state"), "ts-kernel");

export const defaultConfigPath = (): string =>
  process.env.TS_KERNEL_CONFIG ?? join(home("XDG_CONFIG_HOME", ".config"), "ts-kernel", "servers.json");

export function loadConfig(path: string): Config {
  if (!existsSync(path)) throw new Error(`no config at ${path}: write {"mcpServers": {...}} there or pass --config`);
  const { mcpServers } = JSON.parse(readFileSync(path, "utf8")) as Partial<Config>;
  if (typeof mcpServers !== "object" || mcpServers === null) throw new Error(`${path} has no "mcpServers" record`);
  const unreachable = Object.entries(mcpServers).find(([, spec]) => !("url" in spec) && !("command" in spec));
  if (unreachable) throw new Error(`${path}: server ${unreachable[0]} needs a "url" or a "command"`);
  return { mcpServers };
}
