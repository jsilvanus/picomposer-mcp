import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { PicomposerClient } from "../src/client.js";
import { createPicomposerMcpServer } from "../src/mcp.js";
import { SessionPseudonymizer } from "../src/pseudonymize.js";
import { redact } from "../src/redact.js";

test("PII Redaction & Two-Way SessionPseudonymizer strip all personal names, emails, stream keys, and media", () => {
  const pseudonymizer = new SessionPseudonymizer();

  const rawBroadcastPayload = {
    assignedSpeaker: "Pastori Matti Virtanen",
    streamUrl: "rtmp://a.rtmp.youtube.com/live2/secret-stream-key-999",
    apiKey: "sk-live-123456789",
    contact: "Email matti.virtanen@keskuskirkko.fi or call +358 40 123 4567",
    thumbnail: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    steeringNotes: [
      {
        id: "note_1",
        text: "Keep tight framing on Pastori Matti Virtanen and Kanttori Liisa Korhonen during sermon",
      },
    ],
  };

  const redacted = redact(rawBroadcastPayload, pseudonymizer);
  const serialized = JSON.stringify(redacted);

  // Zero real names, emails, phone numbers, stream keys, API keys, or image payloads leave the Pi ecosystem
  assert.ok(!serialized.includes("Matti"));
  assert.ok(!serialized.includes("Virtanen"));
  assert.ok(!serialized.includes("Liisa"));
  assert.ok(!serialized.includes("Korhonen"));
  assert.ok(!serialized.includes("matti.virtanen@keskuskirkko.fi"));
  assert.ok(!serialized.includes("secret-stream-key-999"));
  assert.ok(!serialized.includes("sk-live-123456789"));
  assert.ok(!serialized.includes("data:image/png"));

  assert.equal(redacted.assignedSpeaker, "Celebrant / Liturgi (1)");
  assert.equal(redacted.apiKey, "***");
  assert.ok(redacted.streamUrl.endsWith("/***"));
  assert.ok(redacted.contact.includes("[EMAIL_REDACTED]"));

  // Inbound restoration maps pseudonym back to real name for local hardware/graphics execution
  const inboundArgs = pseudonymizer.inbound({
    title: "Saarna",
    subtitle: "Celebrant / Liturgi (1)",
    prompt: "Show lower third for Celebrant / Liturgi (1)",
  });
  assert.equal(inboundArgs.subtitle, "Pastori Matti Virtanen");
  assert.equal(inboundArgs.prompt, "Show lower third for Pastori Matti Virtanen");
});

test("MCP Resources & Tools: operator draws on /gui/john/1 in one screen and uses picomposer-mcp with cloud AI on another screen with strict PII redaction", async () => {
  // Simulated local picomposer state backing the mock fetch
  const mouseState = {
    mode: "rectangle",
    pageName: "john",
    viewNumber: 1,
    rect: { x: 100, y: 140, width: 320, height: 200 },
    overlappingPanelIds: ["panel-wireless-mics-1-2-5"],
    overlappingComponentIds: ["comp-wireless-bank-1-2-5"],
  };

  const broadcastState = {
    phase: "live",
    rundown: {
      title: "Messu",
      currentSection: "Saarna",
      currentCueTitle: "Saarna",
      assignedSpeaker: "Pastori Matti Virtanen",
      completedSections: ["Johdanto"],
    },
    director: {
      mode: "advisory",
      steeringNotes: [
        {
          id: "n1",
          text: "Wait for Pastori Matti Virtanen to reach pulpit",
          scope: "section",
          enabled: true,
          expired: false,
        },
      ],
    },
  };

  const promptsReceived: Array<Record<string, unknown>> = [];

  const mockFetch: typeof fetch = async (url, init) => {
    const u = new URL(String(url));
    if (u.pathname === "/api/v1/context/mouse" && (!init?.method || init.method === "GET")) {
      return new Response(JSON.stringify({ mouseContext: mouseState }), { status: 200 });
    }
    if (u.pathname === "/api/v1/context/broadcast") {
      return new Response(JSON.stringify({ broadcastContext: broadcastState }), { status: 200 });
    }
    if (u.pathname === "/api/v1/context/last-message") {
      return new Response(
        JSON.stringify({
          lastMessageContext: {
            prompt: "Add lower third for Pastori Matti Virtanen",
            responseSummary: "Added lower third for Pastori Matti Virtanen",
            targetPage: "john",
            targetView: 1,
            targetScreenId: "john/1",
            intent: "screen_layout",
            timestamp: new Date().toISOString(),
          },
        }),
        { status: 200 }
      );
    }
    if (u.pathname === "/api/v1/pages") {
      return new Response(
        JSON.stringify({
          pages: [
            {
              pageName: "john",
              views: [
                { viewNumber: 1, screenId: "john/1", route: "/gui/john/1" },
                { viewNumber: 2, screenId: "john/2", route: "/gui/john/2" },
                { viewNumber: 3, screenId: "john/3", route: "/gui/john/3" },
              ],
            },
          ],
        }),
        { status: 200 }
      );
    }
    if (u.pathname === "/api/v1/timeseries/caption_lag_ms") {
      return new Response(
        JSON.stringify({
          series: {
            metric: "caption_lag_ms",
            label: "Caption / Subtitle Lag",
            unit: "ms",
            points: [{ ts: "2026-10-30T10:00:00Z", value: 920 }],
          },
        }),
        { status: 200 }
      );
    }
    if (u.pathname === "/api/v1/catalog/components") {
      return new Response(
        JSON.stringify({
          catalog: [
            { kind: "button", layer: "atom", actionable: true },
            { kind: "live-captions-feed", layer: "molecule", actionable: false },
          ],
        }),
        { status: 200 }
      );
    }
    if (u.pathname === "/api/v1/prompt" && init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      promptsReceived.push(body);
      return new Response(
        JSON.stringify({
          ok: true,
          targetScreenId: `${body.pageName ?? "1"}/${body.viewNumber ?? 1}`,
          summary: `Executed "${body.prompt}" for Pastori Matti Virtanen`,
          contextUsed: {
            broadcast: body.useBroadcastContext ?? true,
            mouse: body.useMouseContext ?? true,
            lastMessage: body.useLastMessageContext ?? false,
          },
        }),
        { status: 200 }
      );
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  const pseudonymizer = new SessionPseudonymizer();
  const picomposerClient = new PicomposerClient({
    baseUrl: "http://127.0.0.1:3402",
    fetchFn: mockFetch,
  });
  const mcpServer = createPicomposerMcpServer({
    client: picomposerClient,
    pseudonymizer,
  });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client({ name: "chatgpt-cloud-client", version: "1.0.0" });

  await mcpServer.connect(serverTransport);
  await mcpClient.connect(clientTransport);

  // 1. Read MCP Resources (ui://context/mouse, ui://context/broadcast, ui://pages, ui://timeseries/caption_lag_ms)
  const mouseRes = await mcpClient.readResource({ uri: "ui://context/mouse" });
  const mouseJson = JSON.parse((mouseRes.contents[0] as { text: string }).text);
  assert.equal(mouseJson.mouseContext.mode, "rectangle");
  assert.equal(mouseJson.mouseContext.pageName, "john");
  assert.equal(mouseJson.mouseContext.viewNumber, 1);

  const bcastRes = await mcpClient.readResource({ uri: "ui://context/broadcast" });
  const bcastText = (bcastRes.contents[0] as { text: string }).text;
  assert.ok(!bcastText.includes("Matti"));
  assert.ok(!bcastText.includes("Virtanen"));
  assert.ok(bcastText.includes("Celebrant / Liturgi (1)"));

  const tsRes = await mcpClient.readResource({ uri: "ui://timeseries/caption_lag_ms" });
  const tsJson = JSON.parse((tsRes.contents[0] as { text: string }).text);
  assert.equal(tsJson.series.metric, "caption_lag_ms");

  // 2. Cloud AI calls ui_get_context tool
  const ctxToolRes = await mcpClient.callTool({
    name: "ui_get_context",
    arguments: {
      includeMouse: true,
      includeBroadcast: true,
      includeLastMessage: true,
    },
  });
  const ctxToolText = ((ctxToolRes.content as Array<{ text: string }>)[0]!).text;
  assert.ok(!ctxToolText.includes("Matti Virtanen"));
  assert.ok(ctxToolText.includes("Celebrant / Liturgi (1)"));

  // 3. Cloud AI calls ui_prompt_compose using the bound mouse rectangle on john/1
  // Notice it uses the pseudonym "Celebrant / Liturgi (1)" which picomposer-mcp restores to "Pastori Matti Virtanen" locally,
  // and redacts again on the outbound tool response!
  const composeToolRes = await mcpClient.callTool({
    name: "ui_prompt_compose",
    arguments: {
      prompt: "add here sound controls for wireless mics 1,2,5 for Celebrant / Liturgi (1)",
      useMouseContext: true,
      useBroadcastContext: true,
    },
  });
  assert.equal(promptsReceived.length, 1);
  // Local picomposer received the restored real name and the bound page/view from mouse context
  assert.equal(promptsReceived[0]!.pageName, "john");
  assert.equal(promptsReceived[0]!.viewNumber, 1);
  assert.ok(
    String(promptsReceived[0]!.prompt).includes("Pastori Matti Virtanen")
  );
  // Outbound response back to Cloud AI has PII redacted again
  const composeOutText = ((composeToolRes.content as Array<{ text: string }>)[0]!).text;
  assert.ok(!composeOutText.includes("Matti Virtanen"));

  // 4. Cloud AI calls ui_save_named_component, ui_create_macro, ui_create_chart, ui_create_timer
  await mcpClient.callTool({
    name: "ui_save_named_component",
    arguments: { name: "sermon controls" },
  });
  assert.equal(promptsReceived[1]!.prompt, "save these as sermon controls");

  await mcpClient.callTool({
    name: "ui_create_macro",
    arguments: {
      description: "Button that turns off graphics and fades to black",
      pageName: "john",
      viewNumber: 2,
      showAfterSection: "sermon",
      showForSec: 300,
    },
  });
  assert.ok(String(promptsReceived[2]!.prompt).includes("show for 300 seconds"));
  assert.ok(String(promptsReceived[2]!.prompt).includes("show only after sermon has passed"));

  // 5. Read UI component catalog resource
  const catalogRes = await mcpClient.readResource({ uri: "ui://catalog/components" });
  const catalogText = ((catalogRes.contents as Array<{ text: string }>)[0]!).text;
  assert.ok(catalogText.includes("button"));
  assert.ok(catalogText.includes("live-captions-feed"));

  // 6. Cloud AI calls ui_create_ui_cue (e.g. resurrection phrase cue)
  await mcpClient.callTool({
    name: "ui_create_ui_cue",
    arguments: {
      phrase: "resurrection",
      phraseHoldSec: 120,
      actionLabel: "Graveyard Graphic on DSK",
      section: "sermon",
      pageName: "john",
      viewNumber: 1,
    },
  });
  assert.ok(String(promptsReceived[3]!.prompt).includes("resurrection"));
  assert.ok(String(promptsReceived[3]!.prompt).includes("Graveyard Graphic on DSK"));

  await mcpClient.close();
  await mcpServer.close();
});
