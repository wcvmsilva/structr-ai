/** Explicitly paired local manifests; this is not authorization to apply either. */
import { z } from "zod";
import { parseCalculatorRbacManifest } from "../financial-executor-homologation-rbac";
import {
  canonical,
  fail,
  parseCalculatorHomologationManifest,
  SYNTHETIC_IDS,
} from "./contract";
export function parseCalculatorCoordinationManifest(value: unknown) {
  const envelope = z
    .object({ fixture: z.unknown(), rbac: z.unknown() })
    .strict()
    .safeParse(value);
  if (!envelope.success) fail("COORDINATION_MANIFEST");
  const fixture = parseCalculatorHomologationManifest(envelope.data.fixture);
  const rbac = parseCalculatorRbacManifest(envelope.data.rbac);
  const ids = [
    fixture.operationId,
    rbac.operationId,
    ...Object.values(fixture.operator),
    ...Object.values(SYNTHETIC_IDS),
    ...Object.values(rbac.ids),
  ];
  if (
    new Set(ids).size !== ids.length ||
    fixture.sourceCommit !== rbac.sourceCommit ||
    fixture.expectedPrincipal !== rbac.expectedPrincipal ||
    fixture.expectedDatabase !== rbac.expectedDatabase ||
    canonical(fixture.window) !== canonical(rbac.window) ||
    Object.entries(fixture.operator).some(
      ([key, v]) => rbac.operator[key as keyof typeof fixture.operator] !== v
    )
  )
    fail("COORDINATION_MANIFEST");
  return { fixture, rbac };
}
export type CalculatorCoordinationManifest = ReturnType<
  typeof parseCalculatorCoordinationManifest
>;
