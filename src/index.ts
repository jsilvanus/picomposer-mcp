import { buildMcpApp } from "./app.js";

export * from "./pseudonymize.js";
export * from "./redact.js";
export * from "./client.js";
export * from "./mcp.js";
export * from "./app.js";

async function main(): Promise<void> {
  const host = process.env["PICOMPOSER_MCP_HOST"] ?? "127.0.0.1";
  const port = Number.parseInt(process.env["PICOMPOSER_MCP_PORT"] ?? "3461", 10);
  const { app } = buildMcpApp();
  await app.listen({ host, port });
  console.log(`picomposer-mcp listening on http://${host}:${port}/mcp`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("Fatal error starting picomposer-mcp:", err);
    process.exit(1);
  });
}
