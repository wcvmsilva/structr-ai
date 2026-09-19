-- Optional private owner-review labels, not ownership evidence. Run READ ONLY.
-- Capture only conflicted cost types. The offline reviewer must match both UUID
-- and whole-row hash to the earlier metadata before attaching a label.
SELECT jsonb_build_object(
  'version', 1,
  'observedAt', to_char(statement_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'rows', coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id, 'label', t.name,
    'rowSha256', encode(sha256(convert_to(to_jsonb(t)::text, 'UTF8')), 'hex')
  ) ORDER BY t.id), '[]'::jsonb)
)
FROM public.cost_types t
WHERE t.is_taxable IS DISTINCT FROM t.taxable
   OR t.is_time_trackable IS DISTINCT FROM t.time_trackable;
