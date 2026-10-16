/**
 * The known, valid targets a mapping may point at — the single source of truth the UI uses to
 * populate constrained dropdowns (so an operator can't invent a field/value and create new drift).
 */

/** Fields an alias/route mapping may fill (the schema fields the transform reads). */
export const TARGET_FIELDS = [
  "email",
  "name",
  "gender",
  "date_of_birth",
  "phone_number",
  "mobile_number",
  "address_line_1",
  "address_line_2",
  "address_line_3",
  "postcode",
  "country",
] as const;

/** Fields that have a closed set of allowed values, and those values. */
export const ENUM_VALUES: Record<string, string[]> = {
  gender: ["male", "female", "prefer-not-to-say"],
};
