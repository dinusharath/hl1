import { MappingResolver } from "../../src/domain/mapping/mapping-resolver";

describe("MappingResolver.applyAliases", () => {
  const resolver = new MappingResolver([
    { kind: "alias", sourcePath: "work_email", targetPath: "email", fallback: ["home_email"] },
  ]);

  it("fills a missing target from its source", () => {
    const { raw, applied } = resolver.applyAliases({ work_email: "a@b.com" });
    expect(raw.email).toBe("a@b.com");
    expect(applied).toContain("email");
  });

  it("uses the fallback when the primary source is absent", () => {
    const { raw } = resolver.applyAliases({ home_email: "h@b.com" });
    expect(raw.email).toBe("h@b.com");
  });

  it("is non-destructive when the target already has a value", () => {
    const { raw, applied } = resolver.applyAliases({ email: "real@b.com", work_email: "a@b.com" });
    expect(raw.email).toBe("real@b.com");
    expect(applied).toHaveLength(0);
  });
});

describe("MappingResolver.applyComposites", () => {
  const resolver = new MappingResolver([
    { kind: "composite", sourcePaths: ["firstName", "lastName"], targetPath: "name" },
  ]);

  it("joins several sources into one target", () => {
    const { raw, applied } = resolver.applyComposites({ firstName: "Ada", lastName: "Lovelace" });
    expect(raw.name).toBe("Ada Lovelace");
    expect(applied).toContain("name");
  });

  it("uses only the sources present (lone first name still usable)", () => {
    const { raw } = resolver.applyComposites({ firstName: "Madonna" });
    expect(raw.name).toBe("Madonna");
  });

  it("does not fire when the target already has a value", () => {
    const { raw, applied } = resolver.applyComposites({ name: "Grace Hopper", firstName: "Ada", lastName: "Lovelace" });
    expect(raw.name).toBe("Grace Hopper");
    expect(applied).toHaveLength(0);
  });

  it("does not fire when no source is present", () => {
    const { raw, applied } = resolver.applyComposites({ email: "a@b.com" });
    expect(raw.name).toBeUndefined();
    expect(applied).toHaveLength(0);
  });

  it("honours a custom separator", () => {
    const r = new MappingResolver([
      { kind: "composite", sourcePaths: ["area_code", "number"], targetPath: "phone_number", separator: "-" },
    ]);
    expect(r.applyComposites({ area_code: "0117", number: "123456" }).raw.phone_number).toBe("0117-123456");
  });
});

describe("MappingResolver.enumMapFor", () => {
  it("merges value maps from all matching enum rules", () => {
    const resolver = new MappingResolver([
      { kind: "enum", sourcePath: "gender", valueMap: { nb: "prefer-not-to-say" } },
      { kind: "enum", sourcePath: "gender", valueMap: { x: "female" } },
      { kind: "enum", sourcePath: "country", valueMap: { uk: "GB" } },
    ]);
    expect(resolver.enumMapFor("gender")).toEqual({ nb: "prefer-not-to-say", x: "female" });
  });

  it("returns an empty map when no rules match", () => {
    expect(MappingResolver.empty().enumMapFor("gender")).toEqual({});
  });
});
