import { decide } from "../../src/domain/mapping/auto-apply";

describe("auto-apply policy — decide()", () => {
  it("auto-applies at or above the confidence threshold", () => {
    expect(decide({ confidence: 0.95 }, 0.95)).toBe("auto-apply");
    expect(decide({ confidence: 0.99 }, 0.95)).toBe("auto-apply");
  });

  it("routes below-threshold suggestions to a human", () => {
    expect(decide({ confidence: 0.94 }, 0.95)).toBe("needs-review");
    expect(decide({ confidence: 0.5 }, 0.95)).toBe("needs-review");
  });

  it("uses the configured default threshold when none is passed", () => {
    // Default comes from env.autoApply.confidence (0.95 in .env.example).
    expect(decide({ confidence: 1 })).toBe("auto-apply");
    expect(decide({ confidence: 0 })).toBe("needs-review");
  });
});
