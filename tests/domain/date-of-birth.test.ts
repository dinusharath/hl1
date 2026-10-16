import { parseDateOfBirth } from "../../src/domain/forms/date-of-birth";

const NOW = new Date("2020-01-01T00:00:00Z");

describe("parseDateOfBirth", () => {
  it("parses a valid ISO date to UTC midnight (no timezone shift)", () => {
    const d = parseDateOfBirth("1990-01-01", NOW);
    expect(d).not.toBeNull();
    expect(d!.getUTCFullYear()).toBe(1990);
    expect(d!.getUTCMonth()).toBe(0);
    expect(d!.getUTCDate()).toBe(1);
    expect(d!.toISOString()).toBe("1990-01-01T00:00:00.000Z");
  });

  it("rejects an impossible date (no silent rollover)", () => {
    expect(parseDateOfBirth("2021-02-30", NOW)).toBeNull();
  });

  it("rejects a future date", () => {
    expect(parseDateOfBirth("2025-06-01", NOW)).toBeNull();
  });

  it("rejects an implausibly old year", () => {
    expect(parseDateOfBirth("1899-12-31", NOW)).toBeNull();
  });

  it("rejects non-ISO formats (a format mapping must normalise them first)", () => {
    expect(parseDateOfBirth("01/01/1990", NOW)).toBeNull();
    expect(parseDateOfBirth("1990/01/01", NOW)).toBeNull();
  });
});
