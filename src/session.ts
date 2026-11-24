import ts from "typescript";
import { Checker, declared } from "./check.ts";

export type Answer = { text: string; error: boolean };
type Compiled = { kind: "refused"; why: string } | { kind: "compiled"; js: string; names: string[] };
type Outcome = { kind: "done"; names: Record<string, unknown> } | { kind: "threw"; error: unknown } | { kind: "late" };
type Result = { value?: unknown };

const OUTPUT_LIMIT = 40_000;
export const DEFAULT_TIMEOUT_MS = 120_000;
const RESULT = "__cell";
const CONSOLE_METHODS = ["log", "info", "warn", "error", "debug"] as const;
const TRANSPILE: ts.TranspileOptions = { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } };
const MODULE_SYNTAX = "Not run: a cell cannot use `import ... from` or `export`. Write `const fs = await import('node:fs')`.";

type Run = (...values: unknown[]) => Promise<Record<string, unknown>>;
const AsyncFunction = (async () => {}).constructor as new (...parameters: string[]) => Run;

const show = (value: unknown): string => (typeof value === "string" ? value : Bun.inspect(value, { depth: 8 }));

const clip = (text: string): string =>
  text.length <= OUTPUT_LIMIT ? text : `${text.slice(0, OUTPUT_LIMIT)}\n[cut: ${text.length - OUTPUT_LIMIT} more characters. Narrow the result in the cell.]`;

const isModuleSyntax = (statement: ts.Statement): boolean =>
  ts.isImportDeclaration(statement) ||
  ts.isExportDeclaration(statement) ||
  ts.isExportAssignment(statement) ||
  (ts.canHaveModifiers(statement) && (ts.getModifiers(statement) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword));

function returningLastExpression(source: string, file: ts.SourceFile): string {
  const last = file.statements.at(-1);
  if (!last || !ts.isExpressionStatement(last)) return source;
  return `${source.slice(0, last.getStart())}${RESULT}.value = (${last.expression.getText()});${source.slice(last.end)}`;
}

export function compile(source: string): Compiled {
  const file = ts.createSourceFile("cell.ts", source, ts.ScriptTarget.ESNext, true);
  if (file.statements.some(isModuleSyntax)) return { kind: "refused", why: MODULE_SYNTAX };
  const names = declared(file).flatMap((d) => (d.kind === "type" ? [] : [d.name]));
  return { kind: "compiled", js: ts.transpileModule(returningLastExpression(source, file), TRANSPILE).outputText, names: [...new Set(names)] };
}

function capturing(logs: string[]): Console {
  const log = (...parts: unknown[]) => void logs.push(parts.map(show).join(" "));
  return { ...console, ...Object.fromEntries(CONSOLE_METHODS.map((method) => [method, log])) };
}

export class Session {
  private readonly scope: Map<string, unknown>;
  private last: Promise<unknown> = Promise.resolve();

  constructor(
    globals: Record<string, unknown>,
    private readonly checker: Checker,
  ) {
    this.scope = new Map(Object.entries(globals));
  }

  run(source: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Answer> {
    const answer = this.last.then(() => this.cell(source, timeoutMs));
    this.last = answer.catch(() => undefined);
    return answer;
  }

  private execute(js: string, names: readonly string[], result: Result, logs: string[], timeoutMs: number): Promise<Outcome> {
    const carried = [...this.scope.keys()].filter((name) => !names.includes(name));
    const body = `"use strict";\n${js}\n;return {${[...carried, ...names].join(",")}};`;
    const values = carried.map((name) => this.scope.get(name));
    const ran = Promise.resolve()
      .then(() => new AsyncFunction(...carried, RESULT, "console", body)(...values, result, capturing(logs)))
      .then(
        (kept): Outcome => ({ kind: "done", names: kept }),
        (error): Outcome => ({ kind: "threw", error }),
      );
    const late = new Promise<Outcome>((resolve) => setTimeout(() => resolve({ kind: "late" }), timeoutMs).unref());
    return Promise.race([ran, late]);
  }

  private async cell(source: string, timeoutMs: number): Promise<Answer> {
    const compiled = compile(source);
    if (compiled.kind === "refused") return { text: compiled.why, error: true };
    const verdict = this.checker.check(source);
    if (verdict.kind === "refused") return { text: verdict.why, error: true };

    const logs: string[] = [];
    const result: Result = {};
    const outcome = await this.execute(compiled.js, compiled.names, result, logs, timeoutMs);
    const report = (ending: string, error: boolean): Answer => ({ text: clip([...logs, ending].filter(Boolean).join("\n")) || "(no output)", error });

    switch (outcome.kind) {
      case "late":
        return report(`Stopped waiting after ${timeoutMs} ms. The cell's names were not kept. Pass a larger timeout_ms or do less in one cell.`, true);
      case "threw": {
        const thrown = outcome.error instanceof Error ? `${outcome.error.name}: ${outcome.error.message}` : `Thrown: ${show(outcome.error)}`;
        return report(`${thrown}\nThe cell's names were not kept.`, true);
      }
      case "done":
        for (const [name, value] of Object.entries(outcome.names)) this.scope.set(name, value);
        verdict.commit();
        return report(result.value === undefined ? "" : show(result.value), false);
    }
  }
}
