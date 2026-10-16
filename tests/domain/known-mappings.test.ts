import { KNOWN_MAPPINGS } from "../../src/domain/mapping/known-mappings";
import { MappingResolver } from "../../src/domain/mapping/mapping-resolver";
import { transformForm } from "../../src/domain/forms/transform";

const resolver = new MappingResolver(KNOWN_MAPPINGS);

describe("known-mappings — high-confidence auto-pick (no human needed)", () => {
  it("fills email from work_email, with home_email as fallback", () => {
    expect(resolver.applyAliases({ work_email: "a@b.com" }).raw.email).toBe("a@b.com");
    expect(resolver.applyAliases({ home_email: "h@b.com" }).raw.email).toBe("h@b.com");
  });

  it("does not overwrite a field that is already present", () => {
    const out = resolver.applyAliases({ email: "real@x.com", work_email: "a@b.com" });
    expect(out.raw.email).toBe("real@x.com");
    expect(out.applied).not.toContain("email");
  });

  it("exposes gender synonyms so drift values map cleanly, without a review", () => {
    expect(resolver.enumMapFor("gender")["nonbinary"]).toBe("prefer-not-to-say");
    expect(resolver.enumMapFor("gender")["man"]).toBe("male");
  });

  it("end-to-end: a form sending work_email instead of email still transforms, with an alias flag", () => {
    const drifted = {
      session_id: "s-1",
      name: "John Doe",
      work_email: "john@example.com", // provider dropped `email`, sends `work_email`
      gender: "male",
      date_of_birth: "1990-01-01",
      mobile_number: "07123456789",
      address: {
        address_line_1: "1 The Avenue",
        address_line_2: "Bristol",
        postcode: "BS1 1AA",
        country: "United Kingdom",
      },
    };
    const result = transformForm(drifted, resolver);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.form.email).toBe("john@example.com");
      expect(result.flags.map((f) => f.code)).toContain("alias_applied");
    }
  });

  it("end-to-end: a split-name provider (firstName + lastName, no `name`) keeps BOTH names", () => {
    const splitName = {
      session_id: "s-split",
      firstName: "Ada",
      lastName: "Lovelace",
      email: "ada@example.com",
      gender: "female",
      date_of_birth: "1990-01-01",
      mobile_number: "07123456789",
      address: {
        address_line_1: "1 The Avenue",
        address_line_2: "Bristol",
        postcode: "BS1 1AA",
        country: "United Kingdom",
      },
    };
    const result = transformForm(splitName, resolver);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.form.firstName).toBe("Ada");
      expect(result.form.lastName).toBe("Lovelace"); // the bug: lastName must NOT be dropped
      expect(result.flags.map((f) => f.code)).toContain("alias_applied");
    }
  });
});
