/** Public CA fixture only; never a private key or a database credential. */
import { readFileSync } from "node:fs";
export const EXECUTOR_TEST_CA_PEM = readFileSync(
  new URL(
    "../../services/financial-executor/certs/supabase-root-2021.crt",
    import.meta.url
  ),
  "utf8"
);
export const EXECUTOR_TEST_CA_SHA256 =
  "700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7";
