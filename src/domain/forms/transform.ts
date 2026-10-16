import { ingestedFormSchema } from "./ingested-form.schema";
import { splitName } from "./name";
import { mapGender } from "./gender";
import { parseDateOfBirth } from "./date-of-birth";
import { MappingResolver } from "../mapping/mapping-resolver";
import type { Flag, Gender, TransformOutcome } from "./transformed-form";

const VALID_GENDERS: readonly Gender[] = ["male", "female", "prefer-not-to-say"];

/**
 * Pure transform: raw ingested payload → transformed core (everything but geocoding).
 *
 * Never throws and never mutates its input. Returns one of two verdicts:
 *  - `ok`     — a usable form, possibly with soft flags (degraded-but-usable).
 *  - `review` — a required field we can't resolve, so the form waits for a human.
 *
 * Approved field mappings are applied first (via the resolver), so a human-approved drift fix
 * changes behaviour here with no code change.
 */
export function transformForm(
  input: unknown,
  resolver: MappingResolver = MappingResolver.empty(),
  now: Date = new Date(),
): TransformOutcome {
  if (input === null || typeof input !== "object") {
    return { kind: "review", reasons: ["payload is not a JSON object"], flags: [] };
  }

  const aliased = resolver.applyAliases(input as Record<string, unknown>);
  const composed = resolver.applyComposites(aliased.raw);
  const raw = composed.raw;

  const parsed = ingestedFormSchema.safeParse(raw);
  if (!parsed.success) {
    // Missing/renamed required fields → review, not a crash. The messages name what's wrong.
    const reasons = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    return { kind: "review", reasons, flags: [] };
  }

  const form = parsed.data;
  const flags: Flag[] = [
    ...aliased.applied.map((field) => ({
      code: "alias_applied" as const,
      detail: `"${field}" was filled from an aliased field`,
    })),
    ...composed.applied.map((field) => ({
      code: "alias_applied" as const,
      detail: `"${field}" was assembled from multiple source fields`,
    })),
  ];

  const name = splitName(form.name);
  flags.push(...name.flags);

  const gender = mapGender(form.gender, coerceGenderMap(resolver.enumMapFor("gender")));
  flags.push(...gender.flags);

  const dateOfBirth = parseDateOfBirth(form.date_of_birth, now);
  if (!dateOfBirth) {
    // PII-free reason — no DOB value echoed (healthcare data).
    return {
      kind: "review",
      reasons: ["date_of_birth is not a valid, in-range ISO date (YYYY-MM-DD)"],
      flags,
    };
  }

  return {
    kind: "ok",
    flags,
    form: {
      sessionId: form.session_id ?? null,
      applicationReference: form.application_reference ?? null,
      firstName: name.firstName,
      lastName: name.lastName,
      email: form.email,
      gender: gender.gender,
      dateOfBirth,
      phoneNumber: form.phone_number,
      mobileNumber: form.mobile_number,
      addressLine1: form.address.address_line_1,
      addressLine2: form.address.address_line_2,
      addressLine3: form.address.address_line_3,
      postcode: form.address.postcode,
      country: form.address.country,
    },
  };
}

/** Keep only enum-map entries whose target is a valid transformed gender. */
function coerceGenderMap(map: Record<string, string>): Record<string, Gender> {
  const out: Record<string, Gender> = {};
  for (const [k, v] of Object.entries(map)) {
    if ((VALID_GENDERS as readonly string[]).includes(v)) out[k] = v as Gender;
  }
  return out;
}
