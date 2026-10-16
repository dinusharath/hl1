import type { DriftSignal } from "../mapping/suggest";

/**
 * Detects schema drift in a raw payload by comparing it against the agreed ingested schema — the
 * input to the suggestion engine. Pure and PII-free (it passes field names and, for a rename
 * candidate, a sample value only so the engine can shape-match; callers must not persist raw values).
 */

/** Required top-level fields of the agreed schema. */
const REQUIRED = ["name", "email", "gender", "date_of_birth", "mobile_number", "address"];
/** Every field we recognise at the top level (required + optional). */
const KNOWN = new Set([...REQUIRED, "session_id", "application_reference", "phone_number"]);
/** The gender vocabulary the provider originally agreed to send. */
const GENDER_VOCAB = new Set(["male", "female", "other"]);

export function detectDrift(raw: unknown): DriftSignal[] {
  if (!raw || typeof raw !== "object") return [];
  const obj = raw as Record<string, unknown>;
  const present = new Set(Object.keys(obj));
  const unknownFields = Object.keys(obj).filter((k) => !KNOWN.has(k));
  const signals: DriftSignal[] = [];

  // Rename: a required field is missing while unknown field(s) arrived — likely the new name.
  for (const required of REQUIRED) {
    if (present.has(required)) continue;
    const candidates = unknownFields.map((field) => ({
      field,
      sampleValue: typeof obj[field] === "string" ? (obj[field] as string) : undefined,
    }));
    if (candidates.length > 0) signals.push({ kind: "rename", missingField: required, candidates });
  }

  // Unmapped enum: a gender value outside the agreed vocabulary.
  const gender = obj.gender;
  if (typeof gender === "string" && !GENDER_VOCAB.has(gender.trim().toLowerCase())) {
    signals.push({ kind: "enum", field: "gender", value: gender });
  }

  return signals;
}
