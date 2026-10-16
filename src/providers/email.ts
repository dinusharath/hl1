import { sendEmail } from "./sendgrid";
import type { HttpResponse } from "./httpresponse";
import { withTimeout } from "./timeout";
import { PermanentError, RetryableError } from "../domain/errors";

export interface EmailMessage {
  to: string;
  from: string;
  subject: string;
  body: string;
}

export type EmailSender = (msg: EmailMessage, signal?: AbortSignal) => Promise<HttpResponse<void>>;

/**
 * Sends email via the (flaky) provider. The confirmation email is "guaranteed", so a transient
 * failure (5xx / timeout) is retried for a long time — a duplicate email is harmless, a missing
 * one is not. A 4xx is a permanent rejection (bad address/payload) and is NOT retried 50× — it
 * fails fast. The sender is injectable for deterministic tests.
 */
export class EmailProvider {
  constructor(
    private readonly sender: EmailSender = sendEmail,
    private readonly timeoutMs = 5000,
  ) {}

  async deliver(msg: EmailMessage): Promise<void> {
    const res = await withTimeout((signal) => this.sender(msg, signal), this.timeoutMs, "email");
    if (res.statusCode === 200) return;
    if (res.statusCode >= 400 && res.statusCode < 500) {
      throw new PermanentError(`email provider rejected the message (${res.statusCode})`);
    }
    throw new RetryableError(`email provider returned ${res.statusCode}`);
  }
}

export const emailProvider = new EmailProvider();
