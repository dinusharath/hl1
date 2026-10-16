import { Geocoder } from "../../src/providers/geocoder";
import { ReviewError, RetryableError } from "../../src/domain/errors";
import type { HttpResponse } from "../../src/providers/httpresponse";

type Coords = { longitude: number; latitude: number };
const lookup = (res: HttpResponse<Coords>) => () => Promise.resolve(res);

describe("Geocoder — outcome classification for the error taxonomy", () => {
  it("returns coordinates on 200, swapping the mock's inverted lat/long back", async () => {
    // The mock reports longitude≈50, latitude≈-5 (inverted for the UK); the wrapper swaps them.
    const g = new Geocoder(lookup({ statusCode: 200, body: { longitude: 50.05, latitude: -5.05 } }), 1000);
    await expect(g.geocode("E15 4BZ")).resolves.toEqual({ longitude: -5.05, latitude: 50.05 });
  });

  it("classifies a 4xx as a data problem → ReviewError", async () => {
    const g = new Geocoder(lookup({ statusCode: 404 }), 1000);
    await expect(g.geocode("NOPE")).rejects.toBeInstanceOf(ReviewError);
  });

  it("classifies a 5xx as transient → RetryableError", async () => {
    const g = new Geocoder(lookup({ statusCode: 500 }), 1000);
    await expect(g.geocode("E15 4BZ")).rejects.toBeInstanceOf(RetryableError);
  });

  it("treats an empty body on a 200 as transient → RetryableError", async () => {
    const g = new Geocoder(lookup({ statusCode: 200, body: undefined }), 1000);
    await expect(g.geocode("E15 4BZ")).rejects.toBeInstanceOf(RetryableError);
  });
});
