/** Explicit public certificate trust for the isolated PostgreSQL transport. */
import { createHash, X509Certificate } from "node:crypto";

export function validatePinnedPostgresCa(
  pem: string,
  expectedSha256: string
): string {
  const reject = (): never => {
    throw new Error("Executor database CA rejected");
  };
  if (
    typeof pem !== "string" ||
    pem.length > 16384 ||
    !/^[0-9a-f]{64}$/.test(expectedSha256) ||
    !/^-----BEGIN CERTIFICATE-----\r?\n(?:[A-Za-z0-9+/=]+\r?\n)+-----END CERTIFICATE-----(?:\r?\n)?$/.test(
      pem
    ) ||
    createHash("sha256").update(pem, "utf8").digest("hex") !== expectedSha256
  )
    reject();
  try {
    if (!new X509Certificate(pem).ca) reject();
  } catch {
    reject();
  }
  return pem;
}
