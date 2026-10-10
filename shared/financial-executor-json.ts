import { FinancialExecutorError } from "./financial-executor-error";

/** Strict JSON transport/equality for physical rows, which contain finite decimals.
 * This is deliberately separate from the integer/string-only financial hash grammar.
 */
export function serializeExecutorJson(value: unknown): string {
  const seen = new Set<object>();
  function visit(v: unknown, depth: number): unknown {
    if (depth > 48)
      throw new FinancialExecutorError("FINANCIAL_EXECUTOR_INPUT_INVALID");
    if (v === null || typeof v === "string" || typeof v === "boolean") return v;
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v !== "object" || seen.has(v))
      throw new FinancialExecutorError("FINANCIAL_EXECUTOR_INPUT_INVALID");
    const array = Array.isArray(v),
      proto = Object.getPrototypeOf(v);
    if (
      array
        ? proto !== Array.prototype
        : proto !== Object.prototype && proto !== null
    )
      throw new FinancialExecutorError("FINANCIAL_EXECUTOR_INPUT_INVALID");
    const keys = Reflect.ownKeys(v);
    if (array && keys.length !== v.length + 1)
      throw new FinancialExecutorError("FINANCIAL_EXECUTOR_INPUT_INVALID");
    seen.add(v);
    const output: Record<string, unknown> | unknown[] = array
      ? []
      : Object.create(null);
    for (const key of keys.sort((a, b) => String(a).localeCompare(String(b)))) {
      if (array && key === "length") continue;
      const descriptor = Object.getOwnPropertyDescriptor(v, key)!;
      if (
        typeof key !== "string" ||
        !descriptor.enumerable ||
        !Object.hasOwn(descriptor, "value")
      )
        throw new FinancialExecutorError("FINANCIAL_EXECUTOR_INPUT_INVALID");
      if (
        array &&
        (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= (v as unknown[]).length)
      )
        throw new FinancialExecutorError("FINANCIAL_EXECUTOR_INPUT_INVALID");
      Object.defineProperty(output, key, {
        value: visit(descriptor.value, depth + 1),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    seen.delete(v);
    return output;
  }
  return JSON.stringify(visit(value, 0));
}
