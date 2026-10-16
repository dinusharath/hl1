import { suggest } from "../../src/domain/mapping/suggest";
import { decide } from "../../src/domain/mapping/auto-apply";
import { dice, nameSimilarity } from "../../src/domain/mapping/similarity";

describe("similarity", () => {
  it("scores identical and overlapping names high, unrelated low", () => {
    expect(dice("email", "email")).toBe(1);
    expect(nameSimilarity("work_email", "email")).toBeGreaterThanOrEqual(0.99); // token overlap
    expect(dice("county", "email")).toBeLessThan(0.3);
  });
});

describe("suggest() — rename", () => {
  it("picks the value-matching candidate for a missing email, with a fallback, at high confidence", () => {
    const s = suggest({
      kind: "rename",
      missingField: "email",
      candidates: [
        { field: "work_email", sampleValue: "a@b.com" },
        { field: "home_email", sampleValue: "a@b.com" },
        { field: "county", sampleValue: "Bristol" },
      ],
    })!;
    expect(s.kind).toBe("alias");
    expect(s.sourcePath).toBe("work_email");
    expect(s.targetPath).toBe("email");
    expect(s.fallback).toContain("home_email");
    expect(s.fallback).not.toContain("county");
    expect(s.confidence).toBeGreaterThanOrEqual(0.9);
    expect(decide(s)).toBe("auto-apply"); // composes with the auto-apply policy
  });

  it("drops confidence when the value doesn't fit the target shape", () => {
    const good = suggest({ kind: "rename", missingField: "email", candidates: [{ field: "contact_email", sampleValue: "a@b.com" }] })!;
    const bad = suggest({ kind: "rename", missingField: "email", candidates: [{ field: "contact_email", sampleValue: "not-an-email" }] })!;
    expect(bad.confidence).toBeLessThan(good.confidence);
  });
});

describe("suggest() — composite (several fields → one free-text target)", () => {
  it("suggests MERGING when two unknown fields both resemble a split name", () => {
    const s = suggest({
      kind: "rename",
      missingField: "name",
      candidates: [{ field: "forename" }, { field: "surname" }],
    })!;
    expect(s.kind).toBe("composite");
    expect(s.sourcePath).toBe("forename"); // first in payload order
    expect(s.fallback).toEqual(["surname"]); // remaining sources
    expect(s.targetPath).toBe("name");
  });

  it("never auto-applies a composite — a human confirms join-vs-alternatives", () => {
    const s = suggest({ kind: "rename", missingField: "name", candidates: [{ field: "firstName" }, { field: "lastName" }] })!;
    expect(s.kind).toBe("composite");
    expect(decide({ ...s, confidence: 0.99 })).toBe("needs-review"); // even at max confidence
  });

  it("does NOT compose an atomic target: two email-like fields stay alias + fallback", () => {
    const s = suggest({
      kind: "rename",
      missingField: "email",
      candidates: [{ field: "work_email", sampleValue: "a@b.com" }, { field: "home_email", sampleValue: "c@d.com" }],
    })!;
    expect(s.kind).toBe("alias"); // not composite — you don't concatenate two emails
  });
});

describe("suggest() — enum", () => {
  it("is near-certain for a known gender synonym", () => {
    const s = suggest({ kind: "enum", field: "gender", value: "non-binary" })!;
    expect(s.valueMap).toEqual({ "non-binary": "prefer-not-to-say" });
    expect(s.confidence).toBeGreaterThanOrEqual(0.95);
    expect(decide(s)).toBe("auto-apply");
  });

  it("maps an unknown value to the nearest allowed one at lower confidence (→ review)", () => {
    const s = suggest({ kind: "enum", field: "gender", value: "femalee" })!;
    expect(s.valueMap).toEqual({ femalee: "female" });
    expect(s.confidence).toBeLessThan(0.95);
    expect(decide(s)).toBe("needs-review"); // not confident enough to auto-apply
  });

  it("returns null when nothing is close", () => {
    expect(suggest({ kind: "enum", field: "gender", value: "xyzzy" })).toBeNull();
  });
});

describe("suggest() — format", () => {
  it("is confident when the day forces DD/MM/YYYY", () => {
    const s = suggest({ kind: "format", field: "date_of_birth", value: "14/03/1990" })!;
    expect(s.valueMap).toEqual({ from: "DD/MM/YYYY" });
    expect(s.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("is cautious when day/month order is ambiguous", () => {
    const s = suggest({ kind: "format", field: "date_of_birth", value: "03/04/2020" })!;
    expect(s.confidence).toBeLessThan(0.9);
    expect(decide(s)).toBe("needs-review");
  });
});
