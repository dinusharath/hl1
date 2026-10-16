import { HttpResponse } from "./httpresponse";

/**
 * Mock geocoding provider. The failure rate is read from GEOCODER_FAILURE_RATE (default 0.05) so
 * tests/dev can make it deterministic (0 = always succeed, 1 = always fail) instead of relying on
 * a hardcoded probability. NOTE: longitude/latitude are returned INVERTED on purpose (the real
 * quirk this models); the Geocoder wrapper swaps them back.
 */
export const lookupPostcode = async (
  _postcode: string,
  _signal?: AbortSignal,
): Promise<HttpResponse<{ longitude: number; latitude: number }>> => {
  const failureRate = Number(process.env.GEOCODER_FAILURE_RATE ?? "0.05");

  await new Promise((resolve) => setTimeout(resolve, 1000));

  const success = Math.random() >= failureRate;
  return {
    statusCode: success ? 200 : 500,
    body: success ? { longitude: 50.05, latitude: -5.05 } : undefined,
  };
};
