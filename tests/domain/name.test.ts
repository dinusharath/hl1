import { splitName } from "../../src/domain/forms/name";

describe("splitName", () => {
  it("splits a simple first/last name with no flags", () => {
    const r = splitName("John Doe");
    expect(r.firstName).toBe("John");
    expect(r.lastName).toBe("Doe");
    expect(r.flags).toHaveLength(0);
  });

  it("handles comma (last, first) form", () => {
    const r = splitName("Smith, John");
    expect(r.firstName).toBe("John");
    expect(r.lastName).toBe("Smith");
    expect(r.flags).toHaveLength(0);
  });

  it("flags a dropped middle name (no field in the transformed schema)", () => {
    const r = splitName("Andy James Smith-Jones");
    expect(r.firstName).toBe("Andy");
    expect(r.lastName).toBe("Smith-Jones");
    expect(r.flags.map((f) => f.code)).toContain("lossy_name_split");
  });

  it("strips titles and suffixes, keeping first/last", () => {
    const r = splitName("Dr. John P. Smith Jr.");
    expect(r.firstName).toBe("John");
    expect(r.lastName).toBe("Smith");
  });

  it("flags a single-token name that has no surname", () => {
    const r = splitName("Madonna");
    expect(r.firstName).toBe("Madonna");
    expect(r.lastName).toBe(""); // no surname to give
    expect(r.flags.map((f) => f.code)).toContain("lossy_name_split");
  });
});
