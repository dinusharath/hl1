import type { Flag, Gender } from "./transformed-form";

/** Built-in remapping from the ingested vocabulary to the transformed enum. */
const BUILT_IN: Record<string, Gender> = {
  male: "male",
  female: "female",
  other: "prefer-not-to-say", // the brief's enum renames this value
};

export interface MappedGender {
  gender: Gender;
  flags: Flag[];
}

/**
 * Map an incoming gender value to the transformed enum.
 *
 * Known values map directly. An unknown value that drift introduces (e.g. "nonbinary") is
 * coerced to "prefer-not-to-say" and soft-flagged — the form keeps flowing (no human needed)
 * while the original value is recorded for audit. A DB `enum` mapping can later give it a
 * precise home without a code change.
 *
 * @param extraMap optional overrides from approved `field_mappings` (kind = "enum").
 */
export function mapGender(raw: string, extraMap: Record<string, Gender> = {}): MappedGender {
  const key = raw.trim().toLowerCase();
  const mapped = extraMap[key] ?? BUILT_IN[key];

  if (mapped) {
    return { gender: mapped, flags: [] };
  }

  return {
    gender: "prefer-not-to-say",
    // PII-free detail — the original value is preserved in the stored raw payload for audit,
    // not echoed into flags/logs.
    flags: [{ code: "coerced_gender", detail: "unrecognised gender value coerced to prefer-not-to-say" }],
  };
}
