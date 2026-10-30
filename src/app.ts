import Fastify, { type FastifyInstance } from "fastify";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { PicomposerClient, type PicomposerClientOptions } from "./client.js";
import { createPicomposerMcpServer } from "./mcp.js";
import { SessionPseudonymizer } from "./pseudonymize.js";

export interface BuildMcpAppOptions extends PicomposerClientOptions {
  pseudonymizer?: SessionPseudonymizer | undefined;
}

export function buildMcpApp(options: BuildMcpAppOptions = {}): {
  app: FastifyInstance;
  client: PicomposerClient;
  pseudonymizer: SessionPseudonymizer;
} {
  const app = Fastify({ logger: false });
  const client = new PicomposerClient(options);
  const pseudonymizer = options.pseudonymizer ?? new SessionPseudonymizer();

  app.get("/health", async () => ({
    status: "ok",
    service: "picomposer-mcp",
    piiRedaction: "enforced",
  }));

  app.post("/mcp", async (request, reply) => {
    const server = createPicomposerMcpServer({ client, pseudonymizer });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    await server.connect(transport as unknown as Transport);

    reply.hijack();
    reply.raw.on("close", () => {
      transport.close().catch(() => undefined);
      server.close().catch(() => undefined);
    });
    await transport.handleRequest(request.raw, reply.raw, request.body);
  });

  return { app, client, pseudonymizer };
}
