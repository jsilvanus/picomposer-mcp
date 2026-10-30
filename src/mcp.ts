import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { PicomposerClient } from "./client.js";
import { defaultPseudonymizer, type SessionPseudonymizer } from "./pseudonymize.js";
import { redact } from "./redact.js";

export interface CreatePicomposerMcpOptions {
  client: PicomposerClient;
  pseudonymizer?: SessionPseudonymizer | undefined;
}

export function createPicomposerMcpServer(options: CreatePicomposerMcpOptions): McpServer {
  const { client } = options;
  const pseudonymizer = options.pseudonymizer ?? defaultPseudonymizer;

  const server = new McpServer(
    {
      name: "picomposer-mcp",
      version: "0.1.0",
    },
    {
      instructions:
        "Generative UI MCP server for the Pi broadcast ecosystem (picomposer). " +
        "Operators can select a component or draw a rectangle on any /gui/:name/:number screen while prompting a cloud AI (e.g. ChatGPT) on another screen. " +
        "Read ui://context/mouse, ui://context/broadcast, and ui://context/last-message resources (or call ui_get_context) when you need the operator's live selection or broadcast context. " +
        "All personal identifying information (PII) is strictly redacted and pseudonymized before leaving the Pi ecosystem.",
    }
  );

  function jsonResource(uri: URL, data: unknown): ReadResourceResult {
    const safe = redact(data, pseudonymizer);
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(safe, null, 2),
        },
      ],
    };
  }

  function jsonToolResult(data: unknown): CallToolResult {
    const safe = redact(data, pseudonymizer);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(safe, null, 2),
        },
      ],
    };
  }

  // ---------------------------------------------------------------------------
  // MCP Resources (Contexts, Pages/Views, Saved Components, Time-Series)
  // ---------------------------------------------------------------------------

  server.registerResource(
    "ui-context-mouse",
    "ui://context/mouse",
    {
      title: "Bound Mouse Selection Context",
      description:
        "Returns the component or rectangle area currently selected by the operator in UI Editing mode on /gui/:name/:number.",
      mimeType: "application/json",
    },
    async (uri) => jsonResource(uri, await client.getMouseContext())
  );

  server.registerResource(
    "ui-context-broadcast",
    "ui://context/broadcast",
    {
      title: "Redacted Broadcast Context",
      description:
        "Returns the live broadcast phase, rundown section/cue, completed sections, and hardware state with all PII redacted/pseudonymized.",
      mimeType: "application/json",
    },
    async (uri) => jsonResource(uri, await client.getBroadcastContext())
  );

  server.registerResource(
    "ui-context-last-message",
    "ui://context/last-message",
    {
      title: "Last UI Prompt Message Context",
      description:
        "Returns the previous generative UI prompt and summary for iterative fine-tuning of UI.",
      mimeType: "application/json",
    },
    async (uri) => jsonResource(uri, await client.getLastMessageContext())
  );

  server.registerResource(
    "ui-pages",
    "ui://pages",
    {
      title: "Named Pages & Numbered Views Registry",
      description:
        "Lists all named pages and their numbered views (e.g. /gui/1/1, /gui/john/1, /gui/john/2, /gui/john/3).",
      mimeType: "application/json",
    },
    async (uri) => jsonResource(uri, await client.listPages())
  );

  server.registerResource(
    "ui-page-view",
    new ResourceTemplate("ui://pages/{name}/{number}", { list: undefined }),
    {
      title: "Specific Page View Specification",
      description: "Returns the typed JSON UiScreenSpec for /gui/:name/:number.",
    },
    async (uri, vars) => {
      const name = String(vars["name"] ?? "1");
      const number = String(vars["number"] ?? "1");
      return jsonResource(uri, await client.getPageView(name, number));
    }
  );

  server.registerResource(
    "ui-saved-components",
    "ui://components/saved",
    {
      title: "Saved Named UI Components",
      description:
        "Lists reusable named UI components saved by the operator (e.g. 'sermon controls').",
      mimeType: "application/json",
    },
    async (uri) => jsonResource(uri, await client.listSavedComponents())
  );

  server.registerResource(
    "ui-timeseries",
    new ResourceTemplate("ui://timeseries/{metric}", { list: undefined }),
    {
      title: "Broadcast Telemetry Time-Series",
      description:
        "Reads time-series data for audio_rms_dbfs, caption_lag_ms, shot_dwell_sec, stream_bitrate_kbps, or camera_motion_speed.",
    },
    async (uri, vars) => {
      const metric = String(vars["metric"] ?? "audio_rms_dbfs");
      return jsonResource(uri, await client.getTimeSeries(metric));
    }
  );

  server.registerResource(
    "ui-catalog-components",
    "ui://catalog/components",
    {
      title: "PiUI Component & Layout Catalog",
      description:
        "Returns all typed atoms, molecules, and composer composite components available in the PiUI generative ecosystem.",
      mimeType: "application/json",
    },
    async (uri) => jsonResource(uri, await client.getComponentCatalog())
  );

  // ---------------------------------------------------------------------------
  // MCP Tools (Generative UI Composition, Selection Actions, Macros, Charts, Timers)
  // ---------------------------------------------------------------------------

  server.registerTool(
    "ui_get_context",
    {
      title: "Get Generative UI Contexts (Mouse, Broadcast, Last Message)",
      description:
        "Fetches the requested UI contexts (mouse selection on /gui/:name/:number, broadcast state, and/or last message) when the cloud AI needs them to fulfill an operator's prompt.",
      inputSchema: {
        includeMouse: z.boolean().default(true).describe("Include bound mouse component/rectangle context"),
        includeBroadcast: z.boolean().default(true).describe("Include redacted live broadcast & rundown context"),
        includeLastMessage: z.boolean().default(true).describe("Include last prompt/response context"),
      },
    },
    async (args) => {
      // Always prime pseudonymizer from broadcast context so speaker names are registered before redacting
      const broadcastRes = await client.getBroadcastContext();
      pseudonymizer.outbound(broadcastRes);

      const out: Record<string, unknown> = {};
      if (args.includeMouse) {
        out["mouseContext"] = await client.getMouseContext();
      }
      if (args.includeBroadcast) {
        out["broadcastContext"] = broadcastRes;
      }
      if (args.includeLastMessage) {
        out["lastMessageContext"] = await client.getLastMessageContext();
      }
      return jsonToolResult(out);
    }
  );

  server.registerTool(
    "ui_prompt_compose",
    {
      title: "Compose or Modify Generative UI via Prompt",
      description:
        "Prompts picomposer's UI Creator Agent to generate or refine UI on a named page and numbered view (/gui/:name/:number), automatically applying bound mouse context, broadcast context, and last message context as requested.",
      inputSchema: {
        prompt: z.string().min(1).describe("Operator natural-language UI instruction"),
        pageName: z.string().optional().describe("Target page name (defaults to bound mouse page or '1')"),
        viewNumber: z.number().int().min(1).optional().describe("Target view number (defaults to bound mouse view or 1)"),
        useBroadcastContext: z.boolean().default(true),
        useMouseContext: z.boolean().default(true),
        useLastMessageContext: z.boolean().default(false),
        durability: z.enum(["persistent", "broadcast"]).optional(),
      },
    },
    async (rawArgs) => {
      const broadcastRes = await client.getBroadcastContext();
      pseudonymizer.outbound(broadcastRes);

      const args = pseudonymizer.inbound(rawArgs);
      let pageName = args.pageName;
      let viewNumber = args.viewNumber;

      if ((!pageName || !viewNumber) && args.useMouseContext) {
        const mc = (await client.getMouseContext()) as {
          mouseContext?: { mode?: string; pageName?: string; viewNumber?: number };
        };
        if (mc.mouseContext && mc.mouseContext.mode !== "none") {
          pageName = pageName ?? mc.mouseContext.pageName;
          viewNumber = viewNumber ?? mc.mouseContext.viewNumber;
        }
      }

      const result = await client.promptCompose({
        prompt: args.prompt,
        pageName: pageName ?? "1",
        viewNumber: viewNumber ?? 1,
        useBroadcastContext: args.useBroadcastContext,
        useMouseContext: args.useMouseContext,
        useLastMessageContext: args.useLastMessageContext,
        durability: args.durability,
      });
      return jsonToolResult(result);
    }
  );

  server.registerTool(
    "ui_create_macro",
    {
      title: "Create Multi-Step Macro Button on UI",
      description:
        "Adds a macro button (e.g. turn off graphics and fade to black) to /gui/:name/:number with optional visibility condition ('after sermon') or timed duration ('show for 5 minutes').",
      inputSchema: {
        description: z.string().min(1).describe("Description of the macro (e.g. 'Button that turns off graphics and fades to black')"),
        pageName: z.string().default("1"),
        viewNumber: z.number().int().min(1).default(1),
        showAfterSection: z.string().optional().describe("Optional section that must pass before showing (e.g. 'sermon')"),
        showForSec: z.number().int().positive().optional().describe("Optional duration in seconds to show the button (e.g. 300 for 5 minutes)"),
      },
    },
    async (rawArgs) => {
      const args = pseudonymizer.inbound(rawArgs);
      const clauses = [args.description];
      if (args.showForSec) clauses.push(`show for ${args.showForSec} seconds`);
      if (args.showAfterSection) clauses.push(`show only after ${args.showAfterSection} has passed`);

      const result = await client.promptCompose({
        prompt: clauses.join(", "),
        pageName: args.pageName,
        viewNumber: args.viewNumber,
        useBroadcastContext: true,
        useMouseContext: true,
      });
      return jsonToolResult(result);
    }
  );

  server.registerTool(
    "ui_create_chart",
    {
      title: "Add Time-Series Telemetry Chart to UI",
      description:
        "Adds a live time-series chart for any broadcast metric (audio_rms_dbfs, caption_lag_ms, shot_dwell_sec, stream_bitrate_kbps, camera_motion_speed) to /gui/:name/:number.",
      inputSchema: {
        metric: z.enum([
          "audio_rms_dbfs",
          "caption_lag_ms",
          "shot_dwell_sec",
          "stream_bitrate_kbps",
          "camera_motion_speed",
        ]),
        pageName: z.string().default("1"),
        viewNumber: z.number().int().min(1).default(1),
      },
    },
    async (args) => {
      const metricPromptMap: Record<string, string> = {
        audio_rms_dbfs: "Add a time series chart of audio levels",
        caption_lag_ms: "Add a time series chart of caption lag",
        shot_dwell_sec: "Add a time series chart of shot dwell",
        stream_bitrate_kbps: "Add a time series chart of stream bitrate",
        camera_motion_speed: "Add a time series chart of camera motion speed",
      };
      const result = await client.promptCompose({
        prompt: metricPromptMap[args.metric] ?? "Add a time series chart of audio levels",
        pageName: args.pageName,
        viewNumber: args.viewNumber,
        useBroadcastContext: true,
        useMouseContext: true,
      });
      return jsonToolResult(result);
    }
  );

  server.registerTool(
    "ui_create_timer",
    {
      title: "Add Set-Time or Rundown Timer to UI",
      description:
        "Adds a timer display to /gui/:name/:number with either rundown timing (broadcast, section, or item) or a fixed set time (e.g. '10:00').",
      inputSchema: {
        mode: z.enum(["rundown", "set-time"]).default("rundown"),
        scope: z.enum(["broadcast", "section", "item"]).default("item"),
        setTimeMMSS: z.string().optional().describe("Target countdown in MM:SS when mode is 'set-time' (e.g. '05:00')"),
        pageName: z.string().default("1"),
        viewNumber: z.number().int().min(1).default(1),
      },
    },
    async (args) => {
      const prompt =
        args.mode === "set-time"
          ? `Add a countdown timer for ${args.setTimeMMSS ?? "05:00"}`
          : `Add a rundown timer for ${args.scope}`;
      const result = await client.promptCompose({
        prompt,
        pageName: args.pageName,
        viewNumber: args.viewNumber,
        useBroadcastContext: true,
        useMouseContext: true,
      });
      return jsonToolResult(result);
    }
  );

  server.registerTool(
    "ui_save_named_component",
    {
      title: "Save Selected UI Objects as a Named Reusable Component",
      description:
        "Saves the components/panels inside the operator's drawn mouse rectangle (or current view) as a named reusable UI component (e.g. 'sermon controls').",
      inputSchema: {
        name: z.string().min(1).describe("Name for the saved component (e.g. 'sermon controls')"),
        pageName: z.string().optional(),
        viewNumber: z.number().int().min(1).optional(),
      },
    },
    async (rawArgs) => {
      const args = pseudonymizer.inbound(rawArgs);
      const mc = (await client.getMouseContext()) as {
        mouseContext?: { pageName?: string; viewNumber?: number };
      };
      const result = await client.promptCompose({
        prompt: `save these as ${args.name}`,
        pageName: args.pageName ?? mc.mouseContext?.pageName ?? "1",
        viewNumber: args.viewNumber ?? mc.mouseContext?.viewNumber ?? 1,
        useMouseContext: true,
      });
      return jsonToolResult(result);
    }
  );

  server.registerTool(
    "ui_insert_named_component",
    {
      title: "Insert a Saved Named UI Component onto a View",
      description:
        "Mounts a previously saved named UI component (e.g. 'sermon controls') onto /gui/:name/:number.",
      inputSchema: {
        name: z.string().min(1).describe("Saved component name or slug (e.g. 'sermon controls')"),
        pageName: z.string().default("1"),
        viewNumber: z.number().int().min(1).default(1),
      },
    },
    async (rawArgs) => {
      const args = pseudonymizer.inbound(rawArgs);
      const result = await client.promptCompose({
        prompt: `insert ${args.name}`,
        pageName: args.pageName,
        viewNumber: args.viewNumber,
        useMouseContext: true,
      });
      return jsonToolResult(result);
    }
  );

  server.registerTool(
    "ui_create_ui_cue",
    {
      title: "Create a Phrase- or Section-Triggered UI Cue",
      description:
        "Creates a UI-cue (standing UI rule) that automatically mounts a button/panel on /gui/:name/:number when a specific spoken phrase or sermon section is detected.",
      inputSchema: {
        phrase: z.string().describe("Spoken phrase or keyword to listen for in STT transcript (e.g. 'resurrection')"),
        phraseHoldSec: z.number().positive().default(120).describe("Duration in seconds to hold the UI cue active after phrase is spoken"),
        actionLabel: z.string().default("Trigger Action").describe("Label for the mounted action button (e.g. 'Graveyard Graphic on DSK')"),
        section: z.string().optional().describe("Optional rundown section to constrain the cue to (e.g. 'sermon')"),
        pageName: z.string().default("1"),
        viewNumber: z.number().int().min(1).default(1),
      },
    },
    async (rawArgs) => {
      const args = pseudonymizer.inbound(rawArgs);
      const sectionClause = args.section ? ` during ${args.section}` : "";
      const prompt = `show button that puts ${args.actionLabel} if speaker speaks about ${args.phrase}${sectionClause}`;
      const result = await client.promptCompose({
        prompt,
        pageName: args.pageName,
        viewNumber: args.viewNumber,
        useBroadcastContext: true,
        useMouseContext: false,
      });
      return jsonToolResult(result);
    }
  );

  return server;
}
