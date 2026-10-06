import { TRPCError } from "@trpc/server";

/** Do not turn unexpected failures into complete empty analytics or leak driver data. */
export async function withAggregateReadBoundary<T>(read: () => Promise<T>): Promise<T> {
  try { return await read(); }
  catch (error) {
    if (error instanceof TRPCError && (error.code === "UNAUTHORIZED" || error.code === "FORBIDDEN")) throw error;
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Analytics are temporarily unavailable." });
  }
}
