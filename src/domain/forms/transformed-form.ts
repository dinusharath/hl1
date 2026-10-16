/**
 * The shape the pipeline produces, aligned with the brief's `transformed_schema.ts`.
 *
 * `longitude`/`latitude` are optional here because a form is transformed *before* it is
 * geocoded — they are filled in by the geocode step. By the time a form is delivered to
 * FORM-BOT they are always set.
 */

export type Gender = "male" | "female" | "prefer-not-to-say";

/** A non-blocking warning attached to a form — surfaced for audit, never stops processing. */
export interface Flag {
  code:
    | "lossy_name_split"
    | "coerced_gender"
    | "missing_session_id"
    | "alias_applied";
  detail: string;
}

/** Fields produced by the pure transform (everything except geocoding). */
export interface TransformedCore {
  sessionId: string | null;
  applicationReference: string | null;
  firstName: string;
  lastName: string;
  email: string;
  gender: Gender;
  dateOfBirth: Date; // date-only (UTC midnight); stored in a DATE column
  phoneNumber?: string;
  mobileNumber: string;
  addressLine1: string;
  addressLine2: string;
  addressLine3?: string;
  postcode: string;
  country: string;
}

/** A fully transformed + geocoded form, ready for FORM-BOT. */
export interface TransformedForm extends TransformedCore {
  longitude: number;
  latitude: number;
}

/** Result of the pure transform: either a usable form (+ soft flags) or a review verdict. */
export type TransformOutcome =
  | { kind: "ok"; form: TransformedCore; flags: Flag[] }
  | { kind: "review"; reasons: string[]; flags: Flag[] };
