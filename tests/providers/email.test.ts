import { EmailProvider } from "../../src/providers/email";
import { PermanentError, RetryableError } from "../../src/domain/errors";
import type { HttpResponse } from "../../src/providers/httpresponse";

const msg = { to: "happyforms@bots.com", from: "noreply@healthtech1", subject: "s", body: "b" };
const sender = (res: HttpResponse<void>) => () => Promise.resolve(res);

describe("EmailProvider — guaranteed delivery vs hard rejection", () => {
  it("resolves on 200", async () => {
    const p = new EmailProvider(sender({ statusCode: 200 }), 1000);
    await expect(p.deliver(msg)).resolves.toBeUndefined();
  });

  it("retries 5xx (transient → RetryableError), not a hard fail", async () => {
    const p = new EmailProvider(sender({ statusCode: 503 }), 1000);
    await expect(p.deliver(msg)).rejects.toBeInstanceOf(RetryableError);
  });

  it("fails fast on a 4xx (PermanentError) rather than retrying 50×", async () => {
    const p = new EmailProvider(sender({ statusCode: 400 }), 1000);
    await expect(p.deliver(msg)).rejects.toBeInstanceOf(PermanentError);
  });
});
