-- Read-only review input, NOT a classification or migration. Run inside a READ ONLY
-- transaction. One statement gives a consistent MVCC view of collector-visible rows.
-- Row hashes cover the full original row, but no names, prices, notes, contacts or
-- credentials are returned. Keep the JSON output private. RLS visibility is not proven.
SELECT jsonb_build_object(
  'version', 1,
  'observedAt', to_char(statement_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'consistency', 'single_statement',
  'scope', 'collector_visible_rows',
  'rowHashAlgorithm', 'postgres_jsonb_text_sha256',
  'tables', jsonb_build_object(
    'tenants', jsonb_build_object('observed', true, 'rows', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('id', t.id,
        'rowSha256', encode(sha256(convert_to(to_jsonb(t)::text, 'UTF8')), 'hex')) ORDER BY t.id), '[]'::jsonb)
      FROM public.tenants t)),
    'assemblies', jsonb_build_object('observed', true, 'rows', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('id', t.id,
        'rowSha256', encode(sha256(convert_to(to_jsonb(t)::text, 'UTF8')), 'hex'),
        'tenantStamp', t.tenant_id, 'defaultUnitId', t.default_unit_id) ORDER BY t.id), '[]'::jsonb)
      FROM public.assemblies t)),
    'cost_codes', jsonb_build_object('observed', true, 'rows', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('id', t.id,
        'rowSha256', encode(sha256(convert_to(to_jsonb(t)::text, 'UTF8')), 'hex'),
        'tenantStamp', t.tenant_id, 'parentId', t.parent_id,
        'defaultCostTypeId', t.default_cost_type_id, 'defaultUnitId', t.default_unit_id) ORDER BY t.id), '[]'::jsonb)
      FROM public.cost_codes t)),
    'cost_types', jsonb_build_object('observed', true, 'rows', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('id', t.id,
        'rowSha256', encode(sha256(convert_to(to_jsonb(t)::text, 'UTF8')), 'hex'),
        'isTaxable', t.is_taxable, 'taxable', t.taxable,
        'isTimeTrackable', t.is_time_trackable, 'timeTrackable', t.time_trackable) ORDER BY t.id), '[]'::jsonb)
      FROM public.cost_types t)),
    'units', jsonb_build_object('observed', true, 'rows', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('id', t.id,
        'rowSha256', encode(sha256(convert_to(to_jsonb(t)::text, 'UTF8')), 'hex')) ORDER BY t.id), '[]'::jsonb)
      FROM public.units t)),
    'assembly_items', jsonb_build_object('observed', true, 'rows', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('id', t.id,
        'rowSha256', encode(sha256(convert_to(to_jsonb(t)::text, 'UTF8')), 'hex'),
        'assemblyId', t.assembly_id, 'costCodeId', t.cost_code_id,
        'costTypeId', t.cost_type_id, 'unitId', t.unit_id,
        'priceBookItemReference', t.price_book_item) ORDER BY t.id), '[]'::jsonb)
      FROM public.assembly_items t)),
    'cost_code_pricing_history', jsonb_build_object('observed', true, 'rows', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('id', t.id,
        'rowSha256', encode(sha256(convert_to(to_jsonb(t)::text, 'UTF8')), 'hex'),
        'costCodeId', t.cost_code_id, 'unitId', t.unit_id) ORDER BY t.id), '[]'::jsonb)
      FROM public.cost_code_pricing_history t)),
    'crew_velocity', jsonb_build_object('observed', true, 'rows', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('id', t.id,
        'rowSha256', encode(sha256(convert_to(to_jsonb(t)::text, 'UTF8')), 'hex'),
        'costCodeId', t.cost_code_id, 'unitId', t.unit_id) ORDER BY t.id), '[]'::jsonb)
      FROM public.crew_velocity t))
  )
);
