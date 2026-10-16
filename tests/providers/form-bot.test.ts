import { FormBot } from "../../src/providers/form-bot";
import type { TransformedForm } from "../../src/domain/forms/transformed-form";

const form = {} as TransformedForm; // the mock ignores the body; only the key matters

describe("FormBot — exactly-once dedupe (the 'never twice' guarantee)", () => {
  it("accepts the first send and dedupes a retry of the same key", async () => {
    const fb = new FormBot();
    const first = await fb.deliver("form-1", form);
    const retry = await fb.deliver("form-1", form);

    expect(first.outcome).toBe("accepted");
    expect(retry.outcome).toBe("already-have-it"); // no second effect
    expect(fb.deliveredCount).toBe(1); // exactly one distinct delivery
  });

  it("treats distinct keys as distinct deliveries", async () => {
    const fb = new FormBot();
    await fb.deliver("form-1", form);
    await fb.deliver("form-2", form);
    expect(fb.deliveredCount).toBe(2);
    expect(fb.hasDelivered("form-1")).toBe(true);
  });
});
