import { mapGender } from "../../src/domain/forms/gender";

describe("mapGender", () => {
  it("passes known values through, remapping 'other'", () => {
    expect(mapGender("male").gender).toBe("male");
    expect(mapGender("female").gender).toBe("female");
    expect(mapGender("other").gender).toBe("prefer-not-to-say");
    expect(mapGender("other").flags).toHaveLength(0);
  });

  it("is case-insensitive", () => {
    expect(mapGender("MALE").gender).toBe("male");
  });

  it("coerces an unknown drift value and soft-flags it", () => {
    const r = mapGender("nonbinary");
    expect(r.gender).toBe("prefer-not-to-say");
    expect(r.flags.map((f) => f.code)).toContain("coerced_gender");
    // The flag detail is PII-free: it must NOT echo the raw submitted value.
    expect(r.flags[0].detail).not.toContain("nonbinary");
    expect(r.flags[0].detail.length).toBeGreaterThan(0);
  });

  it("honours an approved enum override without flagging", () => {
    const r = mapGender("nonbinary", { nonbinary: "female" });
    expect(r.gender).toBe("female");
    expect(r.flags).toHaveLength(0);
  });
});
