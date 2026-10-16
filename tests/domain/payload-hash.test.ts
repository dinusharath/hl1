import { hashPayload, deriveIdempotencyKey } from "../../src/domain/forms/payload-hash";

describe("hashPayload", () => {
  it("is stable across key reordering", () => {
    expect(hashPayload({ a: 1, b: 2 })).toBe(hashPayload({ b: 2, a: 1 }));
  });

  it("treats a changed string value (including whitespace) as different content", () => {
    // Whitespace is NOT trimmed: a changed value is a real content difference and must
    // surface as a same-id/different-data conflict, not be masked as a duplicate.
    expect(hashPayload({ name: "  John  " })).not.toBe(hashPayload({ name: "John" }));
  });

  it("changes when content actually changes", () => {
    expect(hashPayload({ email: "a@b.com" })).not.toBe(hashPayload({ email: "c@d.com" }));
  });

  it("is stable for nested objects regardless of key order", () => {
    const a = { address: { postcode: "E15 4BZ", country: "UK" } };
    const b = { address: { country: "UK", postcode: "E15 4BZ" } };
    expect(hashPayload(a)).toBe(hashPayload(b));
  });
});

describe("deriveIdempotencyKey", () => {
  it("uses session_id when present", () => {
    expect(deriveIdempotencyKey("abc", "hash123")).toEqual({ key: "abc", usedFallback: false });
  });

  it("falls back to the content hash when session_id is missing", () => {
    expect(deriveIdempotencyKey(undefined, "hash123")).toEqual({ key: "hash:hash123", usedFallback: true });
  });

  it("treats a blank session_id as missing", () => {
    expect(deriveIdempotencyKey("   ", "hash123").usedFallback).toBe(true);
  });
});
