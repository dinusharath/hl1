/**
 * End-to-end worker behaviour against a real Postgres (gated by RUN_DB_TESTS).
 * Run with:  npm run db:up && npx prisma migrate dev && RUN_DB_TESTS=1 npm test
 *
 * These cover the resilience guarantees that can only be proven with the DB + worker together:
 * full pipeline to DONE, exactly-once FORM-BOT across reconciliation, email independence,
 * poison → FAILED, claim concurrency, and stale-lease reclaim. Providers are injected so the
 * run is deterministic (no Math.random()).
 */
import { prisma } from "../../src/db/prisma";
import { ingestForm } from "../../src/ingest/ingest.service";
import { claimForms } from "../../src/worker/claim";
import { processForm } from "../../src/worker/process-form";
import { dispatchOutbox } from "../../src/worker/outbox-dispatcher";
import { Geocoder } from "../../src/providers/geocoder";
import { EmailProvider } from "../../src/providers/email";
import { FormBot } from "../../src/providers/form-bot";
import { RetryableError } from "../../src/domain/errors";
import personOne from "../../src/forms/examples/person_one.json";

const describeDb = process.env.RUN_DB_TESTS ? describe : describe.skip;

// Deterministic providers.
const okGeocoder = new Geocoder(async () => ({ statusCode: 200, body: { longitude: 50.05, latitude: -5.05 } }), 1000);
const okEmail = new EmailProvider(async () => ({ statusCode: 200 }), 1000);

async function truncate(): Promise<void> {
  await prisma.$executeRaw`TRUNCATE ingested_forms, transformed_forms, outbox RESTART IDENTITY CASCADE`;
}

/** Ingest a fresh payload (unique session_id) and claim it, returning the claimed row. */
async function ingestAndClaim(payload: Record<string, unknown>) {
  await ingestForm(payload);
  const [claimed] = await claimForms(10, 30000, 5);
  return claimed;
}

describeDb("worker pipeline (requires DB)", () => {
  beforeEach(truncate); // hermetic: each test starts from a clean slate
  afterAll(() => prisma.$disconnect());

  it("drives a valid form all the way to DONE, delivering each destination exactly once", async () => {
    const formBot = new FormBot();
    const form = await ingestAndClaim({ ...personOne, session_id: "pipe-done" });

    await processForm(form, { geocoder: okGeocoder });
    await dispatchOutbox(10, 30000, { formBot, email: okEmail });

    const final = await prisma.ingestedForm.findUniqueOrThrow({
      where: { id: form.id },
      include: { outbox: true, transformed: true },
    });
    expect(final.status).toBe("DONE");
    expect(final.transformed?.longitude).not.toBeNull();
    expect(final.outbox.every((o) => o.status === "DELIVERED")).toBe(true);
    expect(formBot.deliveredCount).toBe(1);
  });

  it("re-driving a stuck SENDING row produces no second FORM-BOT effect (exactly-once)", async () => {
    const formBot = new FormBot();
    const form = await ingestAndClaim({ ...personOne, session_id: "pipe-once" });
    await processForm(form, { geocoder: okGeocoder });
    await dispatchOutbox(10, 30000, { formBot, email: okEmail });
    expect(formBot.deliveredCount).toBe(1);

    // Simulate a crash mid-send: the FORMBOT row is stuck in SENDING with an expired lease.
    await prisma.outboxMessage.updateMany({
      where: { ingestedFormId: form.id, type: "FORMBOT" },
      data: { status: "SENDING", nextAttemptAt: new Date(Date.now() - 60000) },
    });

    await dispatchOutbox(10, 30000, { formBot, email: okEmail }); // reconciliation re-drive

    const row = await prisma.outboxMessage.findFirstOrThrow({ where: { ingestedFormId: form.id, type: "FORMBOT" } });
    expect(row.status).toBe("DELIVERED");
    expect(formBot.deliveredCount).toBe(1); // still exactly one — the receiver deduped the retry
  });

  it("delivers the guaranteed email even when FORM-BOT is stuck (independent rows)", async () => {
    const downFormBot = { deliver: async () => { throw new RetryableError("form-bot down"); } } as unknown as FormBot;
    const form = await ingestAndClaim({ ...personOne, session_id: "pipe-indep" });
    await processForm(form, { geocoder: okGeocoder });

    await dispatchOutbox(10, 30000, { formBot: downFormBot, email: okEmail });

    const outbox = await prisma.outboxMessage.findMany({ where: { ingestedFormId: form.id } });
    const email = outbox.find((o) => o.type === "EMAIL");
    const formbot = outbox.find((o) => o.type === "FORMBOT");
    expect(email?.status).toBe("DELIVERED"); // guaranteed email got through
    expect(formbot?.status).not.toBe("DELIVERED"); // FORM-BOT still pending/retrying
  });

  it("sends a deterministic (our-bug) failure straight to FAILED, not a retry loop", async () => {
    const buggyGeocoder = { geocode: async () => { throw new Error("null deref in our code"); } } as unknown as Geocoder;
    const form = await ingestAndClaim({ ...personOne, session_id: "pipe-poison" });

    await processForm(form, { geocoder: buggyGeocoder });

    const final = await prisma.ingestedForm.findUniqueOrThrow({ where: { id: form.id } });
    expect(final.status).toBe("FAILED"); // permanent → dead-letter, didn't burn retries
  });

  it("never hands the same form to two concurrent claimers (SKIP LOCKED)", async () => {
    for (let i = 0; i < 6; i++) await ingestForm({ ...personOne, session_id: `pipe-claim-${i}` });

    const [a, b] = await Promise.all([claimForms(3, 30000, 5), claimForms(3, 30000, 5)]);
    const ids = [...a, ...b].map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length); // no id claimed twice
  });

  it("reclaims a form stranded in PROCESSING past its lease, bumping attempts", async () => {
    await ingestForm({ ...personOne, session_id: "pipe-stale" });
    // Strand it: PROCESSING, lease long expired.
    await prisma.ingestedForm.updateMany({
      where: { sessionId: "pipe-stale" },
      data: { status: "PROCESSING", claimedAt: new Date(Date.now() - 600000), nextAttemptAt: new Date(Date.now() - 600000) },
    });

    const [reclaimed] = await claimForms(10, 30000, 5);
    expect(reclaimed?.sessionId).toBe("pipe-stale");
    expect(reclaimed.attempts).toBe(1); // bumped once on reclaim
  });
});
