import { parseFullName } from "parse-full-name";
import type { Flag } from "./transformed-form";

export interface SplitName {
  firstName: string;
  lastName: string;
  flags: Flag[];
}

/**
 * Split a single `name` string into first/last for the transformed schema.
 *
 * Uses `parse-full-name`, which handles the cases a naive `split(" ")` gets wrong:
 * comma form ("Smith, John"), titles ("Dr"), suffixes ("Jr"), and extra whitespace.
 *
 * The split is inherently lossy — the transformed schema has no middle-name field, and a
 * single-token name has no surname — so those cases raise a soft flag rather than failing.
 * The original `name` is always preserved in the stored raw payload.
 */
export function splitName(name: string): SplitName {
  const parsed = parseFullName(name.trim());
  const flags: Flag[] = [];

  let firstName = parsed.first;
  let lastName = parsed.last;

  // A single-token name ("Madonna") is placed in `last` by parse-full-name. Treat the lone
  // token as the first name — there is no surname to give.
  if (!firstName && lastName) {
    firstName = lastName;
    lastName = "";
  }

  // Nothing parsable (e.g. empty/punctuation): fall back to the raw string as the first name.
  if (!firstName && !lastName) {
    firstName = name.trim();
  }

  if (!lastName) {
    // No surname could be derived. Flag detail is PII-free (no name value) — this is healthcare
    // data, so soft flags carry shapes/codes, never the raw values.
    flags.push({ code: "lossy_name_split", detail: "no surname could be derived (single-token name)" });
  }

  if (parsed.middle) {
    flags.push({
      code: "lossy_name_split",
      detail: "a middle name was present and dropped (no field in the transformed schema)",
    });
  }

  return { firstName, lastName, flags };
}
