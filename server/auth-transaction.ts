import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

/** The writer's actual Drizzle transaction, shared by every authorization read. */
export type AuthTransaction = Parameters<Parameters<PostgresJsDatabase['transaction']>[0]>[0];

/**
 * A1 writers lock project → draft before authorization and retain this same
 * SERIALIZABLE transaction through context checks, mutation and durable audit.
 * This mode is always strict and uncached; it cannot relax either condition.
 * expectedTenantId comes from authenticated context, never a command payload.
 * Tenant/client lifecycle and draft lineage remain the writer's responsibility.
 */
export type A1AuthorizationOptions = {
  mode: 'a1';
  transaction: AuthTransaction;
  expectedTenantId: string;
};
