/**
 * Auto-apply DB path (gated by RUN_DB_TESTS): verifies the confidence-threshold policy actually
 * writes an audited, reversible, append-only field_mapping and keeps exactly one active per slot.
 */
import { prisma } from "../../src/db/prisma";
import { applyOrQueue } from "../../src/domain/mapping/auto-apply";
import type { MappingSuggestion } from "../../src/domain/mapping/auto-apply";

const describeDb = process.env.RUN_DB_TESTS ? describe : describe.skip;

const base: MappingSuggestion = {
  kind: "alias",
  sourcePath: "work_email",
  targetPath: "email",
  confidence: 0.99,
};

describeDb("applyOrQueue (requires DB)", () => {
  beforeEach(() => prisma.$executeRaw`TRUNCATE field_mappings RESTART IDENTITY CASCADE`);
  afterAll(() => prisma.$disconnect());

  it("auto-applies a high-confidence suggestion as an active, audited v1 row", async () => {
    const r = await applyOrQueue(base, 0.95);
    expect(r.decision).toBe("auto-apply");
    expect(r.version).toBe(1);

    const rows = await prisma.fieldMapping.findMany({ where: { sourcePath: "work_email" } });
    expect(rows).toHaveLength(1);
    expect(rows[0].active).toBe(true);
    expect(rows[0].approvedBy).toBe("auto");
    expect(rows[0].sourceEngine).toBe("rule");
  });

  it("does not write anything below the threshold", async () => {
    const r = await applyOrQueue({ ...base, confidence: 0.5 }, 0.95);
    expect(r.decision).toBe("needs-review");
    expect(await prisma.fieldMapping.count()).toBe(0);
  });

  it("supersedes the same slot append-only — old row deactivated, exactly one active (v2)", async () => {
    await applyOrQueue(base, 0.95);
    const second = await applyOrQueue(base, 0.95);
    expect(second.version).toBe(2);

    const all = await prisma.fieldMapping.findMany({ where: { sourcePath: "work_email" } });
    expect(all).toHaveLength(2); // append-only history retained
    expect(all.filter((m) => m.active)).toHaveLength(1); // exactly one active
    const active = all.find((m) => m.active)!;
    expect(active.version).toBe(2);
    const retired = all.find((m) => !m.active)!;
    expect(retired.deactivatedAt).not.toBeNull(); // reversible + audited
  });

  it("does not clobber a sibling mapping for a different target of the same source (F4)", async () => {
    await applyOrQueue(base, 0.95); // work_email -> email
    await applyOrQueue({ ...base, targetPath: "phone_number" }, 0.95); // work_email -> phone_number

    const active = await prisma.fieldMapping.findMany({ where: { sourcePath: "work_email", active: true } });
    expect(active).toHaveLength(2); // both targets stay active — different slots
    expect(active.map((m) => m.targetPath).sort()).toEqual(["email", "phone_number"]);
  });
});
