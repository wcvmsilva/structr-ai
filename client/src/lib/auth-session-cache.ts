/** Browser presentation isolation, not authorization. Server ACLs remain mandatory. */
import type { QueryClient } from "@tanstack/react-query";
import { TRPCClientError, type TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import type { AppRouter } from "../../../server/routers";
import {
  buildAuthHeaders,
  getAuthSessionSnapshot,
  subscribeAuthIdentityChange,
} from "./auth-token";

const sessionChanged = () =>
  new TRPCClientError<AppRouter>("Session changed. Please try again.");

export function bindAuthSessionCache(queryClient: QueryClient): () => void {
  return subscribeAuthIdentityChange(() => {
    // cancelQueries aborts existing work synchronously; clear also removes mutation results.
    void queryClient.cancelQueries().catch(() => {});
    queryClient.clear();
    try {
      globalThis.localStorage?.removeItem("manus-runtime-user-info");
    } catch {
      /* unavailable storage */
    }
  });
}

/** Stamp at dispatch, before httpBatchLink queues work or awaits token refresh. */
export const authSessionLink: TRPCLink<AppRouter> =
  () =>
  ({ op, next }) =>
    observable(observer => {
      const generation = getAuthSessionSnapshot().generation;
      const sameIdentity = () =>
        getAuthSessionSnapshot().generation === generation;
      const stop = subscribeAuthIdentityChange(() => {
        observer.error(sessionChanged());
      });
      const subscription = next({
        ...op,
        context: { ...op.context, authSessionGeneration: generation },
      }).subscribe({
        next(value) {
          if (sameIdentity()) observer.next(value);
          else observer.error(sessionChanged());
        },
        error(error) {
          observer.error(sameIdentity() ? error : sessionChanged());
        },
        complete() {
          observer.complete();
        },
      });
      return () => {
        stop();
        subscription.unsubscribe();
      };
    });

/** An old operation must never be sent using the next account's bearer. */
export async function buildSessionAuthHeaders(
  operations: readonly { context: Record<string, unknown> }[]
) {
  const generation = getAuthSessionSnapshot().generation;
  const assertCurrent = () => {
    if (
      getAuthSessionSnapshot().generation !== generation ||
      operations.some(op => op.context.authSessionGeneration !== generation)
    )
      throw sessionChanged();
  };
  assertCurrent();
  const headers = await buildAuthHeaders();
  assertCurrent();
  return headers;
}
