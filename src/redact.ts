import { defaultPseudonymizer, type SessionPseudonymizer } from "./pseudonymize.js";

const SECRET_KEY = /(pass(word)?|token|secret|api_?key|stream_?key|authorization|mediamtxpassword)/i;
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_REGEX = /(?:\+\d{1,3}[\s-]?)?(?:\(\d{2,4}\)[\s-]?|\d{2,4}[\s-])\d{3,4}[\s-]?\d{3,4}/g;

/** Masks the last path segment of an RTMP(S)/RTSP URL, which is usually a stream key. */
function maskUrl(value: string): string {
  return value
    .replace(/^((?:rtmps?|rtsp):\/\/[^/]+\/.*\/)([^/?#]+)/i, "$1***")
    .replace(EMAIL_REGEX, "[EMAIL_REDACTED]")
    .replace(PHONE_REGEX, "[PHONE_REDACTED]");
}

/**
 * Checks if a value appears to be a raw binary buffer or base64 image/audio payload.
 * Enforces the strict "Never image or sound" policy for cloud AI safety.
 */
function isMediaPayload(key: string, value: unknown): boolean {
  if (Buffer.isBuffer(value)) return true;
  if (/^(thumbnail|image|photo|frame|audio|audioData|pcm|wave|jpeg|png)$/i.test(key)) {
    if (typeof value === "string" && (value.startsWith("data:image/") || value.length > 500)) {
      return true;
    }
  }
  return false;
}

/**
 * Deep copy with secrets masked, PII names/emails/phones redacted & pseudonymized,
 * and raw media stripped before leaving the Pi ecosystem.
 */
export function redact<T>(
  value: T,
  pseudonymizer: SessionPseudonymizer = defaultPseudonymizer
): T {
  // First harvest any speaker/operator PII fields across the entire payload
  pseudonymizer.outbound(value);

  function walk(node: unknown): unknown {
    if (typeof node === "string") {
      const masked = maskUrl(node);
      return pseudonymizer.outbound(masked);
    }
    if (Array.isArray(node)) {
      return node.map((entry) => walk(entry));
    }
    if (node && typeof node === "object") {
      if (Buffer.isBuffer(node)) {
        return "[Binary media stripped]";
      }
      const entries = Object.entries(node as Record<string, unknown>).map(([key, entry]) => {
        if (
          SECRET_KEY.test(key) &&
          entry !== null &&
          entry !== undefined &&
          typeof entry !== "boolean" &&
          typeof entry !== "number"
        ) {
          return [key, "***"];
        }
        if (isMediaPayload(key, entry)) {
          return [key, "[Media payload suppressed: zero image/sound to cloud]"];
        }
        return [key, walk(entry)];
      });
      return Object.fromEntries(entries);
    }
    return node;
  }

  return walk(value) as T;
}
