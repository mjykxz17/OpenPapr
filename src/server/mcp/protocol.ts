import { z } from "zod";

// The Model Context Protocol, the part OpenPapr needs: a stateless server
// that answers JSON-RPC over plain HTTP POSTs ("Streamable HTTP" with JSON
// replies and no event stream). Every request carries the key, nothing is
// kept between requests, and the only capability is tools — all of them
// read-only. Small enough that the SDK, written for long-lived Node
// servers, would be more code to adapt than this is to keep.

export const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

export type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
export type ToolResult = { content: Content[]; isError?: boolean };

// A failure the caller should read ("no module called CS9999"), as opposed
// to a bug. It goes back as the tool's answer, so the model can correct itself.
export class ToolError extends Error {}

export type Tool<Ctx> = {
  name: string;
  title: string;
  description: string;
  input: z.ZodObject;
  run: (args: never, ctx: Ctx) => Promise<ToolResult> | ToolResult;
};

export const text = (s: string): ToolResult => ({ content: [{ type: "text", text: s }] });

type Rpc = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };
type Reply = { jsonrpc: "2.0"; id: string | number | null; result?: unknown; error?: { code: number; message: string } };

const ok = (id: Reply["id"], result: unknown): Reply => ({ jsonrpc: "2.0", id, result });
const fail = (id: Reply["id"], code: number, message: string): Reply => ({ jsonrpc: "2.0", id, error: { code, message } });

export function toolList<Ctx>(tools: Tool<Ctx>[]) {
  return tools.map((t) => {
    const inputSchema = z.toJSONSchema(t.input) as Record<string, unknown>;
    delete inputSchema.$schema;
    return { name: t.name, title: t.title, description: t.description, inputSchema, annotations: { readOnlyHint: true, openWorldHint: false } };
  });
}

// One JSON-RPC message in, its reply out — or null for a notification,
// which gets none.
export async function handleRpc<Ctx>(
  msg: unknown, tools: Tool<Ctx>[], ctx: Ctx,
  server: { name: string; version: string; instructions: string },
): Promise<Reply | null> {
  if (!msg || typeof msg !== "object" || Array.isArray(msg)) return fail(null, -32600, "expected one JSON-RPC request");
  const m = msg as Rpc;
  const id = typeof m.id === "string" || typeof m.id === "number" ? m.id : null;
  if (m.jsonrpc !== "2.0" || typeof m.method !== "string") return fail(id, -32600, "not a JSON-RPC 2.0 request");
  if (m.id === undefined) return null;
  const params = (m.params && typeof m.params === "object" ? m.params : {}) as Record<string, unknown>;

  switch (m.method) {
    case "initialize": {
      const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      return ok(id, {
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: server.name, version: server.version },
        instructions: server.instructions,
      });
    }
    case "ping":
      return ok(id, {});
    case "tools/list":
      return ok(id, { tools: toolList(tools) });
    case "tools/call": {
      const tool = tools.find((t) => t.name === params.name);
      if (!tool) return fail(id, -32602, `no tool called ${String(params.name)}`);
      const args = tool.input.safeParse(params.arguments ?? {});
      if (!args.success) return ok(id, { ...text(`Bad arguments: ${z.prettifyError(args.error)}`), isError: true });
      try {
        return ok(id, await tool.run(args.data as never, ctx));
      } catch (err) {
        if (err instanceof ToolError) return ok(id, { ...text(err.message), isError: true });
        console.error(`mcp ${tool.name} failed`, err);
        return ok(id, { ...text("Something went wrong on the OpenPapr server. Try again, or try another tool."), isError: true });
      }
    }
    default:
      return fail(id, -32601, `method not found: ${m.method}`);
  }
}
