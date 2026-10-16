import { transformForm } from "../../src/domain/forms/transform";
import { MappingResolver } from "../../src/domain/mapping/mapping-resolver";
import personOne from "../../src/forms/examples/person_one.json";
import personTwo from "../../src/forms/examples/person_two.json";
import personThree from "../../src/forms/examples/person_three.json";

// Fixed clock so DOB validation is deterministic.
const NOW = new Date("2020-01-01T00:00:00Z");

describe("transformForm — example forms", () => {
  it("person_one: clean happy path, no flags", () => {
    const out = transformForm(personOne, MappingResolver.empty(), NOW);
    expect(out.kind).toBe("ok");
    if (out.kind !== "ok") return;
    expect(out.form.firstName).toBe("John");
    expect(out.form.lastName).toBe("Doe");
    expect(out.form.gender).toBe("male");
    expect(out.form.dateOfBirth.toISOString()).toBe("1990-01-01T00:00:00.000Z");
    expect(out.form.phoneNumber).toBe("07123456789");
    expect(out.form.addressLine1).toBe("Stratford Village Surgery");
    expect(out.form.addressLine3).toBe("London");
    expect(out.flags).toHaveLength(0);
  });

  it("person_two: gender remap, lossy middle name, missing optional line 3 + junk phone", () => {
    const out = transformForm(personTwo, MappingResolver.empty(), NOW);
    expect(out.kind).toBe("ok");
    if (out.kind !== "ok") return;
    expect(out.form.firstName).toBe("Andy");
    expect(out.form.lastName).toBe("Smith-Jones");
    expect(out.form.gender).toBe("prefer-not-to-say"); // "other" → renamed enum value
    expect(out.form.phoneNumber).toBe("0001"); // garbage but present — kept, not blocked
    expect(out.form.addressLine3).toBeUndefined(); // optional, absent
    expect(out.flags.map((f) => f.code)).toEqual(["lossy_name_split"]);
  });

  it("person_three: missing phone_number entirely, female, old DOB", () => {
    const out = transformForm(personThree, MappingResolver.empty(), NOW);
    expect(out.kind).toBe("ok");
    if (out.kind !== "ok") return;
    expect(out.form.firstName).toBe("Jane");
    expect(out.form.lastName).toBe("Doe");
    expect(out.form.gender).toBe("female");
    expect(out.form.phoneNumber).toBeUndefined();
    expect(out.form.dateOfBirth.toISOString()).toBe("1921-03-14T00:00:00.000Z");
    expect(out.flags).toHaveLength(0);
  });
});

describe("transformForm — drift & review", () => {
  it("routes a payload missing a required field to review (never throws)", () => {
    const { email, ...withoutEmail } = personOne as Record<string, unknown>;
    const out = transformForm(withoutEmail, MappingResolver.empty(), NOW);
    expect(out.kind).toBe("review");
    if (out.kind !== "review") return;
    expect(out.reasons.join(" ")).toMatch(/email/);
  });

  it("recovers a dropped field via an alias mapping and flags it", () => {
    const { email, ...rest } = personOne as Record<string, unknown>;
    const drifted = { ...rest, work_email: "work@example.com" };
    const resolver = new MappingResolver([
      { kind: "alias", sourcePath: "work_email", targetPath: "email", fallback: ["home_email"] },
    ]);
    const out = transformForm(drifted, resolver, NOW);
    expect(out.kind).toBe("ok");
    if (out.kind !== "ok") return;
    expect(out.form.email).toBe("work@example.com");
    expect(out.flags.map((f) => f.code)).toContain("alias_applied");
  });

  it("sends a bad date_of_birth to review", () => {
    const bad = { ...(personOne as Record<string, unknown>), date_of_birth: "2021-02-30" };
    const out = transformForm(bad, MappingResolver.empty(), NOW);
    expect(out.kind).toBe("review");
  });

  it("never throws on a non-object payload", () => {
    expect(transformForm(null).kind).toBe("review");
    expect(transformForm("nope").kind).toBe("review");
  });
});
