export interface PicomposerClientOptions {
  baseUrl?: string | undefined;
  fetchFn?: typeof fetch | undefined;
}

export class PicomposerClient {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;

  constructor(options: PicomposerClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? process.env["PICOMPOSER_URL"] ?? "http://127.0.0.1:3460").replace(
      /\/+$/,
      ""
    );
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
  }

  private async requestJson<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await this.fetchFn(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      throw new Error(`picomposer ${init?.method ?? "GET"} ${path} failed (${res.status}): ${errText}`);
    }
    return (await res.json()) as T;
  }

  async getStatus(): Promise<Record<string, unknown>> {
    return this.requestJson("/api/v1/status");
  }

  async getBroadcastContext(): Promise<Record<string, unknown>> {
    return this.requestJson("/api/v1/context/broadcast");
  }

  async getMouseContext(): Promise<Record<string, unknown>> {
    return this.requestJson("/api/v1/context/mouse");
  }

  async setMouseContext(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.requestJson("/api/v1/context/mouse", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async clearMouseContext(): Promise<Record<string, unknown>> {
    return this.requestJson("/api/v1/context/mouse", {
      method: "DELETE",
    });
  }

  async getLastMessageContext(): Promise<Record<string, unknown>> {
    return this.requestJson("/api/v1/context/last-message");
  }

  async listPages(): Promise<Record<string, unknown>> {
    return this.requestJson("/api/v1/pages");
  }

  async getPageView(name: string, number: string | number): Promise<Record<string, unknown>> {
    return this.requestJson(
      `/api/v1/pages/${encodeURIComponent(name)}/${encodeURIComponent(String(number))}`
    );
  }

  async listSavedComponents(): Promise<Record<string, unknown>> {
    return this.requestJson("/api/v1/components/saved");
  }

  async getTimeSeries(metric: string, windowSec?: number): Promise<Record<string, unknown>> {
    const qs = windowSec ? `?windowSec=${encodeURIComponent(String(windowSec))}` : "";
    return this.requestJson(`/api/v1/timeseries/${encodeURIComponent(metric)}${qs}`);
  }

  async listAllTimeSeries(): Promise<Record<string, unknown>> {
    return this.requestJson("/api/v1/timeseries");
  }

  async promptCompose(payload: {
    prompt: string;
    pageName?: string | undefined;
    viewNumber?: number | undefined;
    targetScreenId?: string | undefined;
    durability?: "persistent" | "broadcast" | undefined;
    useBroadcastContext?: boolean | undefined;
    useMouseContext?: boolean | undefined;
    useLastMessageContext?: boolean | undefined;
  }): Promise<Record<string, unknown>> {
    return this.requestJson("/api/v1/prompt", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async addStandingRule(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.requestJson("/api/v1/rules", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async getComponentCatalog(): Promise<Record<string, unknown>> {
    return this.requestJson("/api/v1/catalog/components");
  }
}
