const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Legacy drafts may contain a unit ID in the text field. Never label that value as a physical unit. */
export function ScopeUnit({ unit }: { unit?: string | null }) {
  const label = unit?.trim();
  if (!label || UUID.test(label)) return <span title="The unit label is unresolved. Review the assembly unit before using this scope.">Unit needs review</span>;
  return <span>{label}</span>;
}
