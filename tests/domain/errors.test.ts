import { classify, RetryableError, ReviewError, PermanentError } from "../../src/domain/errors";

describe("classify", () => {
  it("passes typed pipeline errors through unchanged", () => {
    const r = new RetryableError("blip");
    const v = new ReviewError("ambiguous");
    const p = new PermanentError("bug");
    expect(classify(r)).toBe(r);
    expect(classify(v)).toBe(v);
    expect(classify(p)).toBe(p);
  });

  it("treats an unknown Error as permanent (so a bug surfaces, not retries forever)", () => {
    const classified = classify(new Error("undefined is not a function"));
    expect(classified).toBeInstanceOf(PermanentError);
    expect(classified.message).toBe("undefined is not a function");
  });

  it("treats a thrown non-Error value as permanent", () => {
    expect(classify("boom")).toBeInstanceOf(PermanentError);
  });
});
