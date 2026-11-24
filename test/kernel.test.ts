import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { start, type Kernel } from "../src/kernel.ts";
import { typeOf } from "../src/schema.ts";

let kernel: Kernel;

beforeAll(async () => {
  process.env.TS_KERNEL_STATE = mkdtempSync(join(tmpdir(), "ts-kernel-"));
  kernel = await start({ mcpServers: { "my-chats": { command: "bun", args: [join(import.meta.dir, "fixture.ts")] }, gone: { command: "/nonexistent/server" } } });
}, 60_000);

afterAll(() => kernel.close());

const run = (code: string) => kernel.session.run(code);

test("a tool list becomes typed methods", () => {
  expect(kernel.types).toContain("const my_chats: {");
  expect(kernel.types).toContain("search_chats(input: {");
  expect(kernel.types).toContain("query: string;");
  expect(kernel.types).toContain("count(input?: Record<string, unknown>): Promise<{");
  expect(kernel.description).toContain("my_chats.search_chats: Find chats by title.");
  expect(kernel.description).toContain("gone (not connected");
});

test("a cell calls a tool and returns its last expression", async () => {
  const answer = await run("const found = await my_chats.search_chats({ query: 'sam' });\nfound.items.map((c: { title: string }) => c.title)");
  expect(answer.error).toBe(false);
  expect(answer.text).toContain("Sam");
  expect(answer.text).toContain("Samira");
});

test("names and their types last across cells", async () => {
  expect((await run("found.items.length")).text).toBe("2");
  expect((await run("const total = (await my_chats.count()).total; let seen = 1; function twice(n: number) { return n * 2; }")).error).toBe(false);
  expect((await run("seen = twice(total); seen")).text).toBe("6");
  expect((await run("seen")).text).toBe("6");
  const wrong = await run("const s: string = total;");
  expect(wrong.error).toBe(true);
  expect(wrong.text).toContain("line 1");
});

test("a type error stops the cell before it runs", async () => {
  const answer = await run("console.log('ran');\nawait my_chats.search_chats({ querry: 'x' });");
  expect(answer.error).toBe(true);
  expect(answer.text).toContain("Not run");
  expect(answer.text).toContain("line 2");
  expect(answer.text).not.toContain("ran\n");
});

test("a tool's error is thrown, and a thrown cell keeps no names", async () => {
  const answer = await run("const before = 1;\nawait my_chats.fail();");
  expect(answer.error).toBe(true);
  expect(answer.text).toContain("no such thing");
  expect((await run("before")).text).toContain("Not run");
});

test("console output, redeclared names, interfaces and help", async () => {
  expect((await run("const total = 'now a string'; console.log({ a: 1 }); total.toUpperCase()")).text).toBe("{\n  a: 1,\n}\nNOW A STRING");
  expect((await run("interface Chat { id: string }\nconst first: Chat = { id: 'c1' };")).error).toBe(false);
  expect((await run("const again: Chat = first; again.id")).text).toBe("c1");
  expect((await run("help('my_chats.search_chats')")).text).toContain("More detail here.");
  expect((await run("import fs from 'node:fs';")).text).toContain("await import");
  expect((await run("export const leaked = 1;")).text).toContain("await import");
  expect((await run("const os = await import('node:os'); typeof os.hostname()")).text).toBe("string");
});

test("a cell that outlasts its timeout is reported", async () => {
  const answer = await kernel.session.run("await new Promise((r) => setTimeout(r, 2000));", 100);
  expect(answer.error).toBe(true);
  expect(answer.text).toContain("Stopped waiting after 100 ms");
});

test("schemas become types", () => {
  expect(typeOf({ type: "array", items: { enum: ["a", "b"] } })).toBe('Array<"a" | "b">');
  expect(typeOf({ anyOf: [{ type: "string" }, { type: "null" }] })).toBe("string | null");
  expect(typeOf({ $ref: "#/$defs/id", $defs: { id: { type: "integer" } } })).toBe("number");
  expect(typeOf({ type: "object", properties: { "a-b": { type: "boolean" } }, required: ["a-b"] })).toBe('{\n  "a-b": boolean;\n}');
  expect(typeOf({ $ref: "#/$defs/n", $defs: { n: { type: "object", properties: { next: { $ref: "#/$defs/n" } } } } })).toContain("next?:");
});
