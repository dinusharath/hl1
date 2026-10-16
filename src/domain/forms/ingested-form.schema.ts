import { z } from "zod";

/**
 * Tolerant schema for the incoming payload.
 *
 * Deliberately lenient (PLAN.md §Schema-drift tolerance):
 *  - `.passthrough()` keeps unknown fields instead of stripping them.
 *  - `gender` is a plain string, not an enum — an unexpected value is handled by the
 *    gender mapper (coerce + soft flag), never a hard parse failure.
 *  - Identifiers are optional — a schema change that drops `session_id` must not reject.
 *
 * Fields genuinely required to build a transformed form are required here; a `safeParse`
 * failure becomes a NEEDS_REVIEW verdict upstream, never a crash or a 4xx to the provider.
 */
export const addressSchema = z
  .object({
    address_line_1: z.string(),
    address_line_2: z.string(),
    address_line_3: z.string().optional(),
    postcode: z.string(),
    country: z.string(),
  })
  .passthrough();

export const ingestedFormSchema = z
  .object({
    session_id: z.string().optional(),
    application_reference: z.string().optional(),
    name: z.string(),
    email: z.string(),
    gender: z.string(),
    date_of_birth: z.string(),
    phone_number: z.string().optional(),
    mobile_number: z.string(),
    address: addressSchema,
  })
  .passthrough();

export type IngestedForm = z.infer<typeof ingestedFormSchema>;
