import { Prisma, type OutboxMessage } from "@prisma/client";
import { prisma } from "../db/prisma";
import { FormBot, formBot as defaultFormBot } from "../providers/form-bot";
import { EmailProvider, emailProvider as defaultEmail } from "../providers/email";
import { classify } from "../domain/errors";
import type { TransformedForm } from "../domain/forms/transformed-form";
import { nextAttemptAt } from "./backoff";
import { formLogger } from "../observability/logger";

const CONFIRMATION_RECIPIENT = "happyforms@bots.com";

// Statuses the dispatcher must not overwrite when escalating a failure.
const PROTECTED: ("FAILED" | "DONE")[] = ["FAILED", "DONE"];

export interface DispatchDeps {
  formBot: FormBot;
  email: EmailProvider;
  emailMaxAttempts: number;
  formBotMaxAttempts: number;
}

const defaults: DispatchDeps = {
  formBot: defaultFormBot,
  email: defaultEmail,
  emailMaxAttempts: 50,
  formBotMaxAttempts: 10,
};

/**
 * Dispatch a batch of outbox rows. Each (form, destination) row is handled independently and on
 * its own retry schedule, so a stuck FORM-BOT never blocks the "guaranteed" email, and vice-versa.
 */
export async function dispatchOutbox(batchSize: number, leaseMs: number, deps: Partial<DispatchDeps> = {}): Promise<void> {
  const d = { ...defaults, ...deps };
  const rows = await claimOutbox(batchSize, leaseMs);
  for (const row of rows) {
    await dispatchOne(row, d);
  }
}

/**
 * Claim PENDING rows, plus SENDING rows whose lease expired (reconciliation of stuck sends).
 * Flipping to SENDING stamps a fresh lease (pushes next_attempt_at into the future) so a
 * backlogged row isn't re-claimed by another worker while the first send is in flight.
 */
async function claimOutbox(batchSize: number, leaseMs: number): Promise<OutboxMessage[]> {
  const leaseExpiry = new Date(Date.now() + leaseMs);
  const claimed = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    UPDATE outbox SET
      status = 'SENDING'::"OutboxStatus",
      next_attempt_at = ${leaseExpiry}
    WHERE id IN (
      SELECT id FROM outbox
      WHERE next_attempt_at <= now()
        AND status IN ('PENDING'::"OutboxStatus", 'SENDING'::"OutboxStatus")
      ORDER BY created_at
      FOR UPDATE SKIP LOCKED
      LIMIT ${batchSize}
    )
    RETURNING id
  `);
  if (claimed.length === 0) return [];
  return prisma.outboxMessage.findMany({ where: { id: { in: claimed.map((r) => r.id) } } });
}

async function dispatchOne(row: OutboxMessage, deps: DispatchDeps): Promise<void> {
  const log = formLogger({ formId: row.ingestedFormId });
  try {
    const form = await loadTransformedForm(row.ingestedFormId);

    if (row.type === "FORMBOT") {
      const ack = await deps.formBot.deliver(row.idempotencyKey, form);
      log.info({ ack: ack.outcome }, "FORM-BOT delivered");
    } else {
      await deps.email.deliver({
        to: CONFIRMATION_RECIPIENT,
        from: "noreply@healthtech1.example",
        subject: "Registration form ingested",
        // PII-free body — identifiers only, no name/email/DOB values.
        body: `A registration form (id ${row.ingestedFormId}) was ingested and transformed.`,
      });
      log.info("confirmation email sent");
    }

    await prisma.outboxMessage.update({ where: { id: row.id }, data: { status: "DELIVERED", lastError: null } });
    await markFormDoneIfComplete(row.ingestedFormId);
  } catch (err) {
    await handleFailure(row, err, deps, log);
  }
}

async function handleFailure(
  row: OutboxMessage,
  err: unknown,
  deps: DispatchDeps,
  log: ReturnType<typeof formLogger>,
): Promise<void> {
  const classified = classify(err);
  const attempts = row.attempts + 1;
  const cap = row.type === "EMAIL" ? deps.emailMaxAttempts : deps.formBotMaxAttempts;

  if (classified.name === "RetryableError" && attempts < cap) {
    await prisma.outboxMessage.update({
      where: { id: row.id },
      data: { status: "PENDING", attempts, lastError: classified.message, nextAttemptAt: nextAttemptAt(attempts) },
    });
    return;
  }

  // Exhausted or permanent: mark the row FAILED and escalate the parent form to NEEDS_REVIEW so
  // it doesn't strand in DISPATCHED forever. Guarded so we don't clobber a concurrent terminal.
  log.error({ type: row.type }, "outbox delivery failed permanently → escalating form to review");
  await prisma.outboxMessage.update({
    where: { id: row.id },
    data: { status: "FAILED", attempts, lastError: classified.message },
  });
  await prisma.ingestedForm.updateMany({
    where: { id: row.ingestedFormId, status: { notIn: PROTECTED } },
    data: { status: "NEEDS_REVIEW", lastError: `delivery to ${row.type} failed` },
  });
}

/** Mark the parent form DONE once both outbox rows are DELIVERED — only if it's still DISPATCHED. */
async function markFormDoneIfComplete(ingestedFormId: string): Promise<void> {
  const outstanding = await prisma.outboxMessage.count({
    where: { ingestedFormId, status: { not: "DELIVERED" } },
  });
  if (outstanding === 0) {
    // Guarded: a form escalated to NEEDS_REVIEW/FAILED (e.g. geocode failed but the email still
    // sent) must not be flipped to DONE.
    await prisma.ingestedForm.updateMany({
      where: { id: ingestedFormId, status: "DISPATCHED" },
      data: { status: "DONE" },
    });
  }
}

async function loadTransformedForm(ingestedFormId: string): Promise<TransformedForm> {
  const row = await prisma.transformedForm.findUniqueOrThrow({ where: { ingestedFormId } });
  return {
    sessionId: null,
    applicationReference: null,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    gender: row.gender as TransformedForm["gender"],
    dateOfBirth: row.dateOfBirth,
    phoneNumber: row.phoneNumber ?? undefined,
    mobileNumber: row.mobileNumber,
    addressLine1: row.addressLine1,
    addressLine2: row.addressLine2,
    addressLine3: row.addressLine3 ?? undefined,
    postcode: row.postcode,
    country: row.country,
    // EMAIL dispatch doesn't need coordinates; FORM-BOT is only enqueued after geocoding, so when
    // a FORMBOT row is dispatched these are always set. Default to NaN only to satisfy the type;
    // never read for EMAIL.
    longitude: row.longitude ?? Number.NaN,
    latitude: row.latitude ?? Number.NaN,
  };
}
