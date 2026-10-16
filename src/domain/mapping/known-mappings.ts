import type { MappingRule } from "./mapping-resolver";

/**
 * Built-in, high-confidence mappings that are ALWAYS applied at transform time (the top
 * confidence tier). These cover the obvious, safe drift the provider is known to produce, so
 * on-call is never paged for them. Applying one yields at most a soft flag (`alias_applied` for
 * aliases; gender synonyms map cleanly) — never a review.
 *
 * DB `field_mappings` are layered on top of these and can override them (see load-mappings.ts).
 *
 * Alias sources are listed primary-first with the rest as ordered fallbacks, so e.g. `email` is
 * filled from `work_email`, then `home_email`.
 */
export const KNOWN_MAPPINGS: MappingRule[] = [
  { kind: "alias", sourcePath: "work_email", targetPath: "email", fallback: ["home_email"] },
  { kind: "alias", sourcePath: "mobile", targetPath: "mobile_number" },
  { kind: "alias", sourcePath: "phone", targetPath: "phone_number", fallback: ["telephone"] },
  { kind: "alias", sourcePath: "county", targetPath: "address_line_3", fallback: ["city", "town"] },

  // Providers that split the name into separate fields: reassemble into the single `name` the
  // schema expects (then splitName re-derives first/last). Covers camelCase and snake_case.
  { kind: "composite", sourcePaths: ["firstName", "lastName"], targetPath: "name" },
  { kind: "composite", sourcePaths: ["first_name", "last_name"], targetPath: "name" },

  {
    kind: "enum",
    sourcePath: "gender",
    // Keys are compared case-insensitively by the gender mapper.
    valueMap: {
      m: "male",
      man: "male",
      f: "female",
      woman: "female",
      "non-binary": "prefer-not-to-say",
      nonbinary: "prefer-not-to-say",
      nb: "prefer-not-to-say",
      other: "prefer-not-to-say",
    },
  },
];
