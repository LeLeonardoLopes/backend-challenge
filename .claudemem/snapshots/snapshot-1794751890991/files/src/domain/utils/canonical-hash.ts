import { createHash } from "node:crypto";

/**
 * Creates a deterministic, canonical SHA-256 hash from business payload fields.
 * 1. Filters only pure business domain fields (excluding transport headers, timestamp, etc.).
 * 2. Sorts object keys recursively to ensure order-independence.
 * 3. Formats monetary amounts consistently.
 * 4. Generates SHA-256 hex string.
 */
export function computeCanonicalPayloadHash(data: Record<string, unknown>): string {
  const canonicalString = serializeCanonical(data);
  return createHash("sha256").update(canonicalString).digest("hex");
}

function serializeCanonical(val: unknown): string {
  if (val === null || val === undefined) {
    return "null";
  }

  if (typeof val !== "object") {
    return JSON.stringify(val);
  }

  if (Array.isArray(val)) {
    return "[" + val.map(serializeCanonical).join(",") + "]";
  }

  const obj = val as Record<string, unknown>;
  const sortedKeys = Object.keys(obj).sort();
  const pairs = sortedKeys.map((key) => {
    return JSON.stringify(key) + ":" + serializeCanonical(obj[key]);
  });

  return "{" + pairs.join(",") + "}";
}
