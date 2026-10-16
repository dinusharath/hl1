import type { TransformedForm } from "../domain/forms/transformed-form";

export interface FormBotAck {
  /** `accepted` = first time we've seen this key; `already-have-it` = a deduped retry. */
  outcome: "accepted" | "already-have-it";
}

/**
 * Mock FORM-BOT. The brief promises it "never crashes", so it has no failure simulation — its
 * job is to model the one behaviour we depend on for exactly-once: it dedupes on the
 * `idempotencyKey`. A retried send (after an uncertain outcome on our side) is acknowledged as
 * `already-have-it` and has no second effect. This is where the real "never twice" lives.
 *
 * NOTE: this in-memory dedupe set is lost on restart (a real FORM-BOT would persist it). On our
 * side, the authoritative "already delivered" signal is the outbox row's DELIVERED status in the
 * DB — not this set — so a process restart never causes a re-send of an already-DELIVERED row.
 */
export class FormBot {
  private readonly delivered = new Set<string>();

  async deliver(idempotencyKey: string, _form: TransformedForm): Promise<FormBotAck> {
    if (this.delivered.has(idempotencyKey)) {
      return { outcome: "already-have-it" };
    }
    this.delivered.add(idempotencyKey);
    return { outcome: "accepted" };
  }

  hasDelivered(idempotencyKey: string): boolean {
    return this.delivered.has(idempotencyKey);
  }

  /** Count of distinct forms delivered — handy for asserting exactly-once in tests. */
  get deliveredCount(): number {
    return this.delivered.size;
  }

  reset(): void {
    this.delivered.clear();
  }
}

export const formBot = new FormBot();
