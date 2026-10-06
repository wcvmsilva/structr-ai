/**
 * MICHAEL-A1-DECISION-CYCLE-V2-QA-AND-CORRECTION.md items 2/3: a decision
 * "intent" (the requestId sent with an approve/revoke/create-version
 * command) is frozen at SUBMIT time from the pair (reviewed-content
 * fingerprint, stated reason) — never generated once per dialog-open and
 * reused regardless of what the user later types or what a refetch brings
 * back. An identical resubmit (a genuine transport-error retry: same
 * content, same reason) reuses the prior requestId, so the server's own
 * idempotent-replay path applies. Any change — an edited reason, or a
 * different reviewed fingerprint — is a NEW decision and gets a NEW
 * requestId; a server-side conflict on a stale requestId is not a
 * substitute for the client tracking this correctly itself.
 */
export interface DecisionIntent<F> {
  requestId: string;
  reason: string;
  fingerprint: F;
}
export interface DecisionIntentRef<F> {
  current: DecisionIntent<F> | null;
}

export function freezeIntent<F>(
  ref: DecisionIntentRef<F>,
  fingerprint: F,
  reason: string,
  fingerprintEqual: (a: F, b: F) => boolean,
  generateId: () => string,
): string {
  const prior = ref.current;
  const sameIntent = prior !== null && fingerprintEqual(prior.fingerprint, fingerprint) && prior.reason === reason;
  const requestId = sameIntent ? prior.requestId : generateId();
  ref.current = { requestId, reason, fingerprint };
  return requestId;
}
