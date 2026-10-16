import { withTimeout } from "../../src/providers/timeout";
import { RetryableError } from "../../src/domain/errors";

describe("withTimeout", () => {
  it("rejects with a RetryableError when the work outruns the deadline", async () => {
    const neverResolves = () => new Promise<string>(() => {});
    await expect(withTimeout(neverResolves, 20, "slow-provider")).rejects.toBeInstanceOf(RetryableError);
  });

  it("passes the value through when the work finishes in time", async () => {
    const fast = () => Promise.resolve("ok");
    await expect(withTimeout(fast, 1000, "fast-provider")).resolves.toBe("ok");
  });

  it("aborts the signal on timeout so the underlying call can cancel", async () => {
    let aborted = false;
    const run = (signal: AbortSignal) =>
      new Promise<string>(() => {
        signal.addEventListener("abort", () => {
          aborted = true;
        });
      });
    await expect(withTimeout(run, 20, "abortable")).rejects.toBeInstanceOf(RetryableError);
    expect(aborted).toBe(true);
  });
});
