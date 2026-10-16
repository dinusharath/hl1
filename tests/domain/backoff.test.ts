import { backoffMs, nextAttemptAt } from "../../src/worker/backoff";

describe("backoffMs (exponential + full jitter)", () => {
  afterEach(() => jest.restoreAllMocks());

  it("never exceeds min(cap, base * 2^attempts)", () => {
    jest.spyOn(Math, "random").mockReturnValue(0.999999);
    expect(backoffMs(0, 1000, 60_000)).toBeLessThan(1000);
    expect(backoffMs(3, 1000, 60_000)).toBeLessThan(8000); // 1000 * 2^3
  });

  it("is capped regardless of attempt count", () => {
    jest.spyOn(Math, "random").mockReturnValue(0.999999);
    expect(backoffMs(50, 1000, 60_000)).toBeLessThan(60_000);
  });

  it("can be zero (full jitter lower bound)", () => {
    jest.spyOn(Math, "random").mockReturnValue(0);
    expect(backoffMs(5, 1000, 60_000)).toBe(0);
  });

  it("nextAttemptAt returns a future (or now) timestamp", () => {
    const before = Date.now();
    expect(nextAttemptAt(1).getTime()).toBeGreaterThanOrEqual(before);
  });
});
