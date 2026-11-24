#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "fixture", version: "0.0.0" });
const chats = [
  { id: "c1", title: "Sam", unread: 2 },
  { id: "c2", title: "Family", unread: 0 },
  { id: "c3", title: "Samira", unread: 5 },
];

server.registerTool(
  "search_chats",
  { description: "Find chats by title.\nMore detail here.", inputSchema: { query: z.string(), limit: z.number().optional() } },
  async ({ query, limit }) => ({
    content: [{ type: "text", text: JSON.stringify({ items: chats.filter((c) => c.title.toLowerCase().includes(query.toLowerCase())).slice(0, limit ?? 10) }) }],
  }),
);

server.registerTool(
  "count",
  { description: "How many chats there are.", inputSchema: {}, outputSchema: { total: z.number() } },
  async () => ({ content: [{ type: "text", text: "3" }], structuredContent: { total: chats.length } }),
);

server.registerTool("fail", { description: "Always fails.", inputSchema: {} }, async () => ({ content: [{ type: "text", text: "no such thing" }], isError: true }));

await server.connect(new StdioServerTransport());
