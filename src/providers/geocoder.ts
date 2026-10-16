import { lookupPostcode } from "./idealpostcodes";
import type { HttpResponse } from "./httpresponse";
import { withTimeout } from "./timeout";
import { ReviewError, RetryableError } from "../domain/errors";

export type PostcodeLookup = (
  postcode: string,
  signal?: AbortSignal,
) => Promise<HttpResponse<{ longitude: number; latitude: number }>>;

/**
 * Enriches a postcode into coordinates via the (flaky) geocoding provider.
 *
 * The underlying lookup is injectable so tests can drive deterministic outcomes instead of the
 * mock's randomness. Outcomes are classified for the error taxonomy:
 *   - 200 + body → coordinates
 *   - 5xx / timeout / empty body → RetryableError (transient — back off and retry)
 *   - 4xx → ReviewError (the provider rejected this postcode: a data problem for a human)
 */
export class Geocoder {
  constructor(
    private readonly lookup: PostcodeLookup = lookupPostcode,
    private readonly timeoutMs = 5000,
  ) {}

  async geocode(postcode: string): Promise<{ longitude: number; latitude: number }> {
    const res = await withTimeout((signal) => this.lookup(postcode, signal), this.timeoutMs, "geocoder");

    if (res.statusCode === 200 && res.body) {
      // The idealpostcodes mock returns longitude/latitude INVERTED for UK postcodes
      // (it reports longitude≈50, latitude≈-5; UK is latitude≈50, longitude≈-5). Swap them
      // back so transformed_forms stores correct coordinates. Remove this swap for a real,
      // correctly-oriented provider.
      return { longitude: res.body.latitude, latitude: res.body.longitude };
    }
    if (res.statusCode >= 400 && res.statusCode < 500) {
      // PII-free: never echo the postcode (a location quasi-identifier) into errors/logs/responses.
      throw new ReviewError(`geocoder rejected the postcode (${res.statusCode})`);
    }
    throw new RetryableError(`geocoder unavailable (status ${res.statusCode})`);
  }
}

export const geocoder = new Geocoder();
