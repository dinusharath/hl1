import { HttpResponse } from "./httpresponse";

/**
 * Mock email provider. The failure rate is read from EMAIL_FAILURE_RATE (default 0.05) so
 * tests/dev can make it deterministic (0 = always succeed, 1 = always fail) rather than relying
 * on a hardcoded probability.
 */
export const sendEmail = async (
  _msg: { to: string; from: string; subject: string; body: string },
  _signal?: AbortSignal,
): Promise<HttpResponse<void>> => {
  const failureRate = Number(process.env.EMAIL_FAILURE_RATE ?? "0.05");

  await new Promise((resolve) => setTimeout(resolve, 1000));

  return {
    statusCode: Math.random() >= failureRate ? 200 : 500,
    body: undefined,
  };
};
