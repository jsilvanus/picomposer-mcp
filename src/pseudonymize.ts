/**
 * Two-way Pseudonymizer for picomposer-mcp
 *
 * Outbound: Masks/pseudonymizes personal identifying information (PII) such as person names,
 * speakers, operators, and liturgical roles before any UI or broadcast context leaves the Pi
 * ecosystem to external cloud AI clients (e.g. ChatGPT).
 *
 * Inbound: Translates role pseudonyms back into local real names when executing generative UI
 * tools on local picomposer.
 *
 * Enforces zero raw image/audio leakage.
 */

export const KNOWN_ROLES: Record<string, string> = {
  liturgi: "Celebrant / Liturgi",
  liturgist: "Celebrant / Liturgi",
  pastori: "Celebrant / Liturgi",
  pappi: "Celebrant / Liturgi",
  celebrant: "Celebrant / Liturgi",
  saarnaaja: "Preacher / Saarnaaja",
  preacher: "Preacher / Saarnaaja",
  lukija: "Lector / Lukija",
  tekstinlukija: "Lector / Lukija",
  lector: "Lector / Lukija",
  reader: "Lector / Lukija",
  kanttori: "Cantor / Kanttori",
  cantor: "Cantor / Kanttori",
  muusikko: "Musician / Muusikko",
  musician: "Musician / Muusikko",
  urkuri: "Organist / Urkuri",
  organist: "Organist / Urkuri",
  avustaja: "Assistant / Avustaja",
  assistant: "Assistant / Avustaja",
  diakoni: "Deacon / Diakoni",
  deacon: "Deacon / Diakoni",
  suntio: "Verger / Suntio",
  vahtimestari: "Verger / Suntio",
  verger: "Verger / Suntio",
  kuoro: "Choir / Kuoro",
  choir: "Choir / Kuoro",
};

const PII_FIELD_NAME = /^(assignedSpeaker|speaker|person|celebrant|preacher|operatorName|author|performer|actor)$/i;

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export class SessionPseudonymizer {
  private realToPseudo = new Map<string, string>();
  private pseudoToReal = new Map<string, string>();
  private counter = 1;

  constructor(initialMappings?: Record<string, string>) {
    if (initialMappings) {
      for (const [real, pseudo] of Object.entries(initialMappings)) {
        this.register(real, pseudo);
      }
    }
  }

  register(realName: string, pseudonymOrRole: string): void {
    const trimmedReal = realName.trim();
    if (!trimmedReal) return;
    const lowerRole = pseudonymOrRole.toLowerCase().trim();
    const mappedTitle = KNOWN_ROLES[lowerRole] ?? pseudonymOrRole;
    this.realToPseudo.set(trimmedReal, mappedTitle);
    this.pseudoToReal.set(mappedTitle, trimmedReal);
  }

  getPseudonym(realName: string, roleHint?: string): string {
    const trimmed = realName.trim();
    if (!trimmed) return trimmed;

    // Do not pseudonymize system actors
    if (/^(pidirector|pirundown|picomposer|system|auto)$/i.test(trimmed)) {
      return trimmed;
    }

    const existing = this.realToPseudo.get(trimmed);
    if (existing) return existing;

    // Check if the name starts with a known role prefix (e.g. "Pastori Matti Virtanen")
    const parts = trimmed.split(/\s+/);
    const firstWord = parts[0]?.toLowerCase() ?? "";
    const detectedRole = roleHint ? KNOWN_ROLES[roleHint.toLowerCase().trim()] : KNOWN_ROLES[firstWord];

    const assigned = detectedRole
      ? `${detectedRole} (${this.counter++})`
      : `Person_${this.counter++}`;
    this.register(trimmed, assigned);

    // If prefixed with a title like "Pastori Matti", also register the bare personal name ("Matti")
    if (KNOWN_ROLES[firstWord] && parts.length > 1) {
      const bareName = parts.slice(1).join(" ");
      if (bareName.length >= 3 && !this.realToPseudo.has(bareName)) {
        this.realToPseudo.set(bareName, assigned);
      }
    }

    return assigned;
  }

  getRealName(pseudonym: string): string {
    return this.pseudoToReal.get(pseudonym.trim()) ?? pseudonym;
  }

  pseudonymizeText(text: string): string {
    let result = text;
    // Also detect inline "Pastori <Name>" / "Kanttori <Name>" / "Liturgi <Name>" patterns in free text
    const titleRegex = /\b(Pastori|Pappi|Liturgi|Saarnaaja|Kanttori|Diakoni|Pastor|Preacher|Celebrant)\s+([A-ZÄÖÅ][a-zäöå]+(?:\s+[A-ZÄÖÅ][a-zäöå]+)?)\b/g;
    result = result.replace(titleRegex, (fullMatch) => {
      return this.getPseudonym(fullMatch);
    });

    for (const [real, pseudo] of this.realToPseudo.entries()) {
      if (real.length < 3) continue;
      const regex = new RegExp(`\\b${escapeRegExp(real)}\\b`, "gi");
      result = result.replace(regex, pseudo);
    }
    return result;
  }

  restoreText(text: string): string {
    let result = text;
    for (const [pseudo, real] of this.pseudoToReal.entries()) {
      const regex = new RegExp(escapeRegExp(pseudo), "g");
      result = result.replace(regex, real);
    }
    return result;
  }

  /**
   * First pass: harvest any explicit speaker/actor fields in the payload so their names
   * are also replaced if they appear inside free-text subtitles, steering notes, or logs.
   */
  private harvestPiiFields(value: unknown): void {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) this.harvestPiiFields(item);
      return;
    }
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v === "string" && PII_FIELD_NAME.test(k) && v.trim().length > 0) {
        this.getPseudonym(v);
      } else if (v && typeof v === "object") {
        this.harvestPiiFields(v);
      }
    }
  }

  outbound<T>(value: T): T {
    this.harvestPiiFields(value);
    return this.outboundTransform(value);
  }

  private outboundTransform<T>(value: T): T {
    if (typeof value === "string") return this.pseudonymizeText(value) as unknown as T;
    if (Array.isArray(value)) return value.map((v) => this.outboundTransform(v)) as unknown as T;
    if (value && typeof value === "object") {
      const entries = Object.entries(value as Record<string, unknown>).map(([k, v]) => {
        if (typeof v === "string" && PII_FIELD_NAME.test(k)) {
          return [k, this.getPseudonym(v)];
        }
        return [k, this.outboundTransform(v)];
      });
      return Object.fromEntries(entries) as T;
    }
    return value;
  }

  inbound<T>(value: T): T {
    if (typeof value === "string") return this.restoreText(value) as unknown as T;
    if (Array.isArray(value)) return value.map((v) => this.inbound(v)) as unknown as T;
    if (value && typeof value === "object") {
      const entries = Object.entries(value as Record<string, unknown>).map(([k, v]) => {
        if (typeof v === "string" && /^(name|speaker|assignedSpeaker|title|subtitle|prompt)$/i.test(k)) {
          return [k, this.restoreText(this.getRealName(v))];
        }
        return [k, this.inbound(v)];
      });
      return Object.fromEntries(entries) as T;
    }
    return value;
  }
}

export const defaultPseudonymizer = new SessionPseudonymizer();
