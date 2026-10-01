-- A1-EXPORT-DATA-CONTRACT.md physical foundation for jobtread_exports.
-- Schema/relations in drizzle/schema.ts, drizzle/relations.ts already declare the
-- Drizzle side of every column/FK/index below; this migration is the matching SQL.
-- No writer/router/UI/renderer is enabled by this migration. No real data migrated.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Widen the three monetary columns to numeric(20,0). Existing integer values
--    round-trip unchanged (ALTER ... TYPE numeric(20,0) is a lossless widening).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.jobtread_exports ALTER COLUMN approved_total_cents TYPE numeric(20,0);
ALTER TABLE public.jobtread_exports ALTER COLUMN exported_total_cents TYPE numeric(20,0);
ALTER TABLE public.jobtread_exports ALTER COLUMN difference_cents TYPE numeric(20,0);
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. §2.1 — 12 ordinary nullable columns (no default, legacy rows stay NULL) + 3
--    GENERATED ALWAYS STORED columns. precision=3 timestamps match the core
--    convention. Drizzle's own generated expression (schema.ts) must match this
--    one exactly, or push/introspection would diverge from what this file applies.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.jobtread_exports ADD COLUMN artifact_contract_version text;
ALTER TABLE public.jobtread_exports ADD COLUMN artifact_format text;
ALTER TABLE public.jobtread_exports ADD COLUMN attempt_kind text;
ALTER TABLE public.jobtread_exports ADD COLUMN client_id uuid;
ALTER TABLE public.jobtread_exports ADD COLUMN internal_approval_id uuid;
ALTER TABLE public.jobtread_exports ADD COLUMN internal_snapshot_id uuid;
ALTER TABLE public.jobtread_exports ADD COLUMN approved_content_hash text;
ALTER TABLE public.jobtread_exports ADD COLUMN artifact_hash text;
ALTER TABLE public.jobtread_exports ADD COLUMN renderer_version text;
ALTER TABLE public.jobtread_exports ADD COLUMN generated_at timestamptz(3);
ALTER TABLE public.jobtread_exports ADD COLUMN artifact_byte_length integer;
ALTER TABLE public.jobtread_exports ADD COLUMN checked_at timestamptz(3);
ALTER TABLE public.jobtread_exports ADD COLUMN a1_estimate_draft_id uuid
  GENERATED ALWAYS AS (CASE WHEN artifact_contract_version = 'internal-estimate-export-v1' THEN estimate_draft_id ELSE NULL END) STORED;
ALTER TABLE public.jobtread_exports ADD COLUMN a1_requested_by uuid
  GENERATED ALWAYS AS (CASE WHEN artifact_contract_version = 'internal-estimate-export-v1' THEN requested_by ELSE NULL END) STORED;
ALTER TABLE public.jobtread_exports ADD COLUMN a1_downloaded_by uuid
  GENERATED ALWAYS AS (CASE WHEN artifact_contract_version = 'internal-estimate-export-v1' THEN downloaded_by ELSE NULL END) STORED;
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. §3.1 anchor 1 (redundant with the id PK; required so the FK below can target
--    (tenant_id,project_id,id) directly). Anchors 2/3 already exist from 0007
--    (uq_eias_export_identity, uq_eia_export_identity) — reused unchanged, not
--    redeclared here.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_estimate_drafts_a1_export_context
  ON public.estimate_drafts (tenant_id, project_id, id);
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. §3.2 — 5 FKs, MATCH SIMPLE (the default for a multi-column FK; any NULL
--    component makes the whole FK trivially satisfied, which is exactly how a
--    legacy row with all-NULL generated columns stays valid without being
--    retroactively validated). RESTRICT both ways — evidence is never cascaded
--    away by a parent delete/update.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.jobtread_exports ADD CONSTRAINT jte_a1_draft_context_fk
  FOREIGN KEY (tenant_id, project_id, a1_estimate_draft_id)
  REFERENCES public.estimate_drafts (tenant_id, project_id, id)
  ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE public.jobtread_exports ADD CONSTRAINT jte_a1_requester_fk
  FOREIGN KEY (tenant_id, a1_requested_by)
  REFERENCES public.profiles (tenant_id, id)
  ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE public.jobtread_exports ADD CONSTRAINT jte_a1_downloader_fk
  FOREIGN KEY (tenant_id, a1_downloaded_by)
  REFERENCES public.profiles (tenant_id, id)
  ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE public.jobtread_exports ADD CONSTRAINT jte_a1_approval_fk
  FOREIGN KEY (tenant_id, project_id, client_id, estimate_draft_id, internal_approval_id, internal_snapshot_id)
  REFERENCES public.estimate_internal_approvals (tenant_id, project_id, client_id, estimate_draft_id, id, snapshot_id)
  ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE public.jobtread_exports ADD CONSTRAINT jte_a1_snapshot_hash_fk
  FOREIGN KEY (tenant_id, project_id, client_id, estimate_draft_id, internal_snapshot_id, approved_content_hash)
  REFERENCES public.estimate_internal_approval_snapshots (tenant_id, project_id, client_id, estimate_draft_id, id, content_hash)
  ON DELETE RESTRICT ON UPDATE RESTRICT;
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. §3.2 — 6 indices (5 final ones partial, per Michael's correction "may be
--    partial, not a literal requirement" — made partial here since it's cheaper).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_jte_a1_project_created ON public.jobtread_exports (tenant_id, project_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_jte_a1_draft ON public.jobtread_exports (tenant_id, a1_estimate_draft_id) WHERE a1_estimate_draft_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jte_a1_approval ON public.jobtread_exports (tenant_id, internal_approval_id) WHERE internal_approval_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jte_a1_snapshot ON public.jobtread_exports (tenant_id, internal_snapshot_id) WHERE internal_snapshot_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jte_a1_requester ON public.jobtread_exports (tenant_id, a1_requested_by) WHERE a1_requested_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jte_a1_downloader ON public.jobtread_exports (tenant_id, a1_downloaded_by) WHERE a1_downloaded_by IS NOT NULL;
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. §5.2 — pure, no-table-read grammar helpers. IMMUTABLE/PARALLEL SAFE, schema-
--    qualified, search_path pinned. Mirrors
--    shared/internal-estimate-export-engine.ts's ISSUE_CLASS_RULE/exportIssueOrderIsValid/
--    computeExactAmountMinor exactly — same rank/state/totals-class table, same
--    half-away-from-zero cent rounding via exact integer arithmetic (no float).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.a1_export_issue_class_rank_v1(code text) RETURNS smallint
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog AS $$
  SELECT CASE
    WHEN code IN ('INTERNAL_APPROVAL_REQUIRED','INTERNAL_APPROVAL_LEGACY_RECONCILIATION_REQUIRED',
                  'HISTORICAL_AUTHORITY_NOT_AVAILABLE','ESTIMATE_CLIENT_MISSING','ESTIMATE_CLIENT_CONTEXT_MISMATCH',
                  'INTERNAL_APPROVAL_CONTENT_UNRESOLVED','INTERNAL_APPROVAL_REVOKED','ESTIMATE_SUPERSEDED') THEN 0
    WHEN code IN ('EXPORT_FORMAT_UNREPRESENTABLE','CSV_CLASSIFICATION_NOT_REVIEWED','CSV_TAXABLE_UNKNOWN',
                  'CSV_UNIT_UNREPRESENTABLE','CSV_RATE_UNREPRESENTABLE','CSV_LINE_IDENTITY_INVALID',
                  'CSV_COST_CODE_UNKNOWN','CSV_COST_CODE_INVALID','EXPORT_RENDERER_UNAVAILABLE','EXPORT_PAYLOAD_TOO_LARGE') THEN 1
    WHEN code IN ('EXPORT_RECONCILIATION_MISMATCH','EXPORT_COMMERCIAL_ADJUSTMENT_UNREPRESENTED') THEN 2
    ELSE NULL
  END
$$;

-- A1-EXPORT-DATA-CONTRACT.md lines 205-223: each class rank maps to exactly one
-- blocked status value — reuses the SAME class_rank the issue-ordering check
-- already derives, rather than a second classification of the same codes.
CREATE FUNCTION public.a1_export_issue_status_class_v1(code text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog AS $$
  SELECT CASE public.a1_export_issue_class_rank_v1(code)
    WHEN 0 THEN 'blocked_authorization'
    WHEN 1 THEN 'blocked_validation'
    WHEN 2 THEN 'blocked_reconciliation'
    ELSE NULL
  END
$$;

CREATE FUNCTION public.a1_export_issue_totals_class_v1(code text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog AS $$
  SELECT CASE
    WHEN code IN ('INTERNAL_APPROVAL_REQUIRED','INTERNAL_APPROVAL_LEGACY_RECONCILIATION_REQUIRED',
                  'HISTORICAL_AUTHORITY_NOT_AVAILABLE','ESTIMATE_CLIENT_MISSING','ESTIMATE_CLIENT_CONTEXT_MISMATCH',
                  'INTERNAL_APPROVAL_CONTENT_UNRESOLVED') THEN 'none'
    WHEN code IN ('EXPORT_RECONCILIATION_MISMATCH','EXPORT_COMMERCIAL_ADJUSTMENT_UNREPRESENTED') THEN 'full'
    ELSE 'approvedOnly'
  END
$$;

CREATE FUNCTION public.a1_export_issue_validation_state_v1(code text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog AS $$
  SELECT CASE
    WHEN public.a1_export_issue_class_rank_v1(code) = 0 THEN 'not_evaluated'
    ELSE 'invalid'
  END
$$;

CREATE FUNCTION public.a1_export_issue_reconciliation_state_v1(code text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog AS $$
  SELECT CASE
    WHEN code IN ('INTERNAL_APPROVAL_REQUIRED','INTERNAL_APPROVAL_LEGACY_RECONCILIATION_REQUIRED',
                  'HISTORICAL_AUTHORITY_NOT_AVAILABLE','ESTIMATE_CLIENT_MISSING','ESTIMATE_CLIENT_CONTEXT_MISMATCH',
                  'INTERNAL_APPROVAL_CONTENT_UNRESOLVED','INTERNAL_APPROVAL_REVOKED','ESTIMATE_SUPERSEDED') THEN 'not_evaluated'
    WHEN code = 'EXPORT_RECONCILIATION_MISMATCH' THEN 'mismatch'
    ELSE 'unrepresentable'
  END
$$;

-- §3.2/4: the two client codes NULL is tied to (required, not merely permitted).
CREATE FUNCTION public.a1_export_client_null_required_v1(code text) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog AS $$
  SELECT code IN ('ESTIMATE_CLIENT_MISSING','ESTIMATE_CLIENT_CONTEXT_MISMATCH')
$$;
-- §4: authority must be NULL for exactly these six "no usable decision" codes.
CREATE FUNCTION public.a1_export_authority_null_required_v1(code text) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog AS $$
  SELECT code IN ('INTERNAL_APPROVAL_REQUIRED','INTERNAL_APPROVAL_LEGACY_RECONCILIATION_REQUIRED',
                  'HISTORICAL_AUTHORITY_NOT_AVAILABLE','ESTIMATE_CLIENT_MISSING','ESTIMATE_CLIENT_CONTEXT_MISMATCH',
                  'INTERNAL_APPROVAL_CONTENT_UNRESOLVED')
$$;
-- §5.4: these seven codes are specific to the CSV representation.
CREATE FUNCTION public.a1_export_csv_exclusive_code_v1(code text) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog AS $$
  SELECT code IN ('CSV_CLASSIFICATION_NOT_REVIEWED','CSV_TAXABLE_UNKNOWN','CSV_UNIT_UNREPRESENTABLE',
                  'CSV_RATE_UNREPRESENTABLE','CSV_LINE_IDENTITY_INVALID','CSV_COST_CODE_UNKNOWN','CSV_COST_CODE_INVALID')
$$;

-- §5.2 "Ordem": class precedence, then ascending LineKey ordinal, then field-table
-- order within the same class. No duplicate (code,lineKey,field) triple.
CREATE FUNCTION public.a1_export_issue_order_valid_v1(issues jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog AS $$
DECLARE
  entry jsonb; seen jsonb := '[]'::jsonb;
  prev_rank smallint; prev_ordinal integer; prev_field integer;
  cur_rank smallint; cur_ordinal integer; cur_field integer;
  fields text[] := ARRAY['identity','approval','source','version','currency','lines','quantity','unit','unitCost',
    'unitPrice','lineCost','linePrice','costType','taxable','costCode','discount','format','bytes','renderer'];
  key jsonb; first_item boolean := true;
BEGIN
  FOR entry IN SELECT * FROM jsonb_array_elements(issues) LOOP
    key := jsonb_build_array(entry->'code', entry->'lineKey', entry->'field');
    IF seen @> jsonb_build_array(key) THEN RETURN false; END IF;
    seen := seen || jsonb_build_array(key);
    cur_rank := public.a1_export_issue_class_rank_v1(entry->>'code');
    IF cur_rank IS NULL THEN RETURN false; END IF;
    cur_ordinal := CASE WHEN entry->'lineKey' = 'null'::jsonb THEN -1 ELSE substring(entry->>'lineKey' FROM 6)::integer END;
    cur_field := CASE WHEN entry->'field' = 'null'::jsonb THEN -1 ELSE array_position(fields, entry->>'field') - 1 END;
    IF NOT first_item THEN
      IF cur_rank < prev_rank THEN RETURN false; END IF;
      IF cur_rank = prev_rank THEN
        IF cur_ordinal < prev_ordinal THEN RETURN false; END IF;
        IF cur_ordinal = prev_ordinal AND cur_field < prev_field THEN RETURN false; END IF;
      END IF;
    END IF;
    prev_rank := cur_rank; prev_ordinal := cur_ordinal; prev_field := cur_field; first_item := false;
  END LOOP;
  RETURN true;
END $$;

-- §6.4/§7: exact quantity*rate -> cents, half-away-from-zero at the cent. Pure
-- integer arithmetic (numeric, never float). quantity is a non-negative Decimal6
-- string; rate_two_decimal is a non-negative two-decimal USD string (no sign in
-- either grammar), so no sign handling is needed, matching computeExactAmountMinor.
CREATE FUNCTION public.a1_export_exact_amount_minor_v1(quantity text, rate_two_decimal text) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog AS $$
DECLARE
  q_scale integer; q_numerator numeric; r_cents numeric; numerator numeric; denominator numeric; quotient numeric; remainder numeric;
BEGIN
  q_scale := coalesce(length(split_part(quantity, '.', 2)), 0);
  q_numerator := replace(quantity, '.', '')::numeric;
  r_cents := replace(rate_two_decimal, '.', '')::numeric;
  numerator := q_numerator * r_cents;
  denominator := 10 ^ q_scale;
  quotient := trunc(numerator / denominator);
  remainder := numerator - quotient * denominator;
  IF remainder = 0 THEN RETURN quotient; END IF;
  IF 2 * remainder >= denominator THEN RETURN quotient + 1; END IF;
  RETURN quotient;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RAISE EXCEPTION 'A1_EXPORT_AMOUNT_INVALID' USING ERRCODE = '23514';
END $$;
--> statement-breakpoint

-- SQL mirror of exactTwoDecimal (shared/internal-estimate-export-engine.ts,
-- checkExportCsvRowAgainstLine): a NUMERIC equality between unitCostSnapshot/
-- unitPriceSnapshot and the represented CSV rate is NOT equivalent to the pure
-- engine's rule — the snapshot's own decimal string is a canonical approval
-- decimal (shared/internal-estimate-approval-engine.ts's decimalString, scale up
-- to 6 fraction digits), so a snapshot value with MORE than 2 fraction digits
-- (even one that is numerically equal to some 2-decimal value, e.g. "10.120")
-- must be rejected as non-representable — exactly as the pure engine does — not
-- silently accepted by a numeric cast (V2 QA: "must prove equivalence or
-- implement the same rule"; equivalence does not hold, so this implements it).
CREATE FUNCTION public.a1_export_exact_two_decimal_v1(snapshot_value text, candidate text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog AS $$
DECLARE whole text; fraction text;
BEGIN
  IF snapshot_value IS NULL THEN RETURN false; END IF;
  whole := split_part(snapshot_value, '.', 1);
  fraction := split_part(snapshot_value, '.', 2);
  IF length(fraction) > 2 THEN RETURN false; END IF;
  RETURN (whole || '.' || rpad(fraction, 2, '0')) = candidate;
END $$;
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. §5.1/5.2/5.3/5.4 — the closed manifest/validation/representation grammar AND
--    the §4 local state matrix, mirroring
--    shared/internal-estimate-export-engine.ts's exportManifestSchema exactly.
--    Checks table reads nothing; it is pure given the jsonb argument, so it stays
--    IMMUTABLE even though the overall export feature is relational elsewhere.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.internal_estimate_export_valid_manifest_v1(manifest jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog AS $$
DECLARE
  ctx jsonb; auth jsonb; val jsonb; rec jsonb; rep jsonb; issues jsonb; line_keys jsonb;
  ready boolean; principal text; rule_totals text; rule_vstate text; rule_rstate text;
  approved_nn boolean; exported_nn boolean; expected_diff numeric;
  seen_keys jsonb; i integer; key text; row_item jsonb; rows jsonb; expected_filename text;
  format text; details jsonb;
BEGIN
  IF jsonb_typeof(manifest) <> 'object' THEN RETURN false; END IF;
  IF manifest ?& ARRAY['version','format','attemptKind','outcome','exportId','context','authority','checkedAt','lineKeys','validation','representation'] IS NOT TRUE
     OR (SELECT count(*) FROM jsonb_object_keys(manifest)) <> 11 THEN RETURN false; END IF;
  -- Every comparison below against a text literal uses IS DISTINCT FROM (never a
  -- bare <>) and every NOT IN is guarded by an explicit IS NULL check first — a
  -- bare `x <> 'literal'` or `x NOT IN (...)` evaluates to SQL UNKNOWN (neither true
  -- nor false) when x is NULL (including when the JSON value at that key is JSON
  -- null, since ->>'' on JSON null yields SQL NULL), and a PL/pgSQL `IF <UNKNOWN>`
  -- is treated as false — it SKIPS the RETURN false and silently falls through,
  -- which is exactly how JSON/SQL null bypassed every one of these checks before.
  IF manifest->>'version' IS DISTINCT FROM 'internal-estimate-export-v1' THEN RETURN false; END IF;
  format := manifest->>'format';
  IF format IS NULL OR format NOT IN ('pdf','json','printable','csv_jobtread') THEN RETURN false; END IF;
  IF manifest->>'attemptKind' IS NULL OR manifest->>'attemptKind' NOT IN ('preflight','delivery') THEN RETURN false; END IF;
  IF manifest->>'outcome' IS DISTINCT FROM 'ready' AND manifest->>'outcome' IS DISTINCT FROM 'blocked' THEN RETURN false; END IF;
  ready := manifest->>'outcome' = 'ready';

  ctx := manifest->'context'; auth := manifest->'authority'; val := manifest->'validation';
  rec := val->'reconciliation'; rep := manifest->'representation'; line_keys := manifest->'lineKeys'; issues := val->'issues';

  -- context: 6 keys, UUID grammar, clientId nullable here (the XNOR rule below decides).
  IF ctx ?& ARRAY['tenantId','projectId','clientId','estimateDraftId','estimateVersion','requestedBy'] IS NOT TRUE
     OR (SELECT count(*) FROM jsonb_object_keys(ctx)) <> 6 THEN RETURN false; END IF;
  IF NOT public.internal_approval_matches_v1(ctx->'tenantId', jsonb_build_object('type','uuid'))
     OR NOT public.internal_approval_matches_v1(ctx->'projectId', jsonb_build_object('type','uuid'))
     OR NOT public.internal_approval_matches_v1(ctx->'clientId', jsonb_build_object('type','uuid','nullable',true))
     OR NOT public.internal_approval_matches_v1(ctx->'estimateDraftId', jsonb_build_object('type','uuid'))
     OR NOT public.internal_approval_matches_v1(ctx->'estimateVersion', jsonb_build_object('type','integer','min',1,'max',2147483647))
     OR NOT public.internal_approval_matches_v1(ctx->'requestedBy', jsonb_build_object('type','uuid'))
  THEN RETURN false; END IF;

  -- authority: NULL or exactly {approvalId,snapshotId,contentHash}.
  IF auth <> 'null'::jsonb THEN
    IF jsonb_typeof(auth) <> 'object' OR auth ?& ARRAY['approvalId','snapshotId','contentHash'] IS NOT TRUE
       OR (SELECT count(*) FROM jsonb_object_keys(auth)) <> 3
       OR NOT public.internal_approval_matches_v1(auth->'approvalId', jsonb_build_object('type','uuid'))
       OR NOT public.internal_approval_matches_v1(auth->'snapshotId', jsonb_build_object('type','uuid'))
       OR NOT public.internal_approval_matches_v1(auth->'contentHash', jsonb_build_object('type','hash'))
    THEN RETURN false; END IF;
  END IF;

  IF NOT public.internal_approval_matches_v1(manifest->'checkedAt', jsonb_build_object('type','timestamp')) THEN RETURN false; END IF;
  IF NOT public.internal_approval_matches_v1(manifest->'exportId', jsonb_build_object('type','uuid')) THEN RETURN false; END IF;

  -- lineKeys: array of LineKey, <=1000, distinct, exactly line:1..N in order.
  IF jsonb_typeof(line_keys) <> 'array' OR jsonb_array_length(line_keys) > 1000 THEN RETURN false; END IF;
  seen_keys := '[]'::jsonb;
  FOR i IN 0..jsonb_array_length(line_keys)-1 LOOP
    -- V5 fix (MICHAEL-A1-EXPORT-PHYSICAL-V4-QA-AND-COMPLETION.md §3 review item:
    -- "null lineKeys array elements"): a JSON null (or any object/array) element
    -- makes `->>` return SQL NULL, and `NULL !~ regex` is SQL UNKNOWN, not TRUE —
    -- the same three-valued-logic bug class fixed elsewhere in this migration.
    -- An explicit typeof check closes it before any text comparison is attempted.
    IF jsonb_typeof(line_keys->i) IS DISTINCT FROM 'string' THEN RETURN false; END IF;
    key := line_keys->>i;
    IF key !~ '^line:([1-9][0-9]{0,2}|1000)$' OR substring(key FROM 6)::integer <> i+1 THEN RETURN false; END IF;
    IF seen_keys @> jsonb_build_array(key) THEN RETURN false; END IF;
    seen_keys := seen_keys || jsonb_build_array(key);
  END LOOP;

  -- validation envelope shape.
  IF val ?& ARRAY['version','state','issues','reconciliation'] IS NOT TRUE OR (SELECT count(*) FROM jsonb_object_keys(val)) <> 4 THEN RETURN false; END IF;
  IF val->>'version' IS DISTINCT FROM 'internal-estimate-export-validation-v1' THEN RETURN false; END IF;
  IF val->>'state' IS NULL OR val->>'state' NOT IN ('not_evaluated','valid','invalid') THEN RETURN false; END IF;
  IF jsonb_typeof(issues) <> 'array' OR jsonb_array_length(issues) > 4002 THEN RETURN false; END IF;
  FOR i IN 0..jsonb_array_length(issues)-1 LOOP
    row_item := issues->i;
    IF row_item ?& ARRAY['code','lineKey','field'] IS NOT TRUE OR (SELECT count(*) FROM jsonb_object_keys(row_item)) <> 3 THEN RETURN false; END IF;
    IF public.a1_export_issue_class_rank_v1(row_item->>'code') IS NULL THEN RETURN false; END IF;
    -- V5 fix (MICHAEL-A1-EXPORT-PHYSICAL-V4-QA-AND-COMPLETION.md §3 review item:
    -- "issues.lineKey uses a generic code matcher"): A1-EXPORT-DATA-CONTRACT.md
    -- line 44 defines LineKey as the closed `line:<ordinal>` grammar, the SAME
    -- regex already used for the top-level lineKeys array a few lines above —
    -- the generic 'code' shape (any 1..128-char trimmed string) accepted values
    -- like "banana" or "line:0" that could never be a real LineKey. The contract
    -- (line 196) also requires a present lineKey to exist in the snapshot, but
    -- that cross-reference needs a live table read this function intentionally
    -- never does (it is a pure, closed grammar validator, per its header) — it
    -- is also unreachable from manifest JSON alone: ready manifests always carry
    -- zero issues (line 347) and blocked manifests always carry an empty
    -- lineKeys array (line 351), so there is never a manifest-local lineKeys
    -- array to cross-check a blocked row's issue against. That half of the rule
    -- belongs to a different layer (an application/trigger check against the
    -- real snapshot), not this grammar function; only the FORMAT half is fixed
    -- here.
    IF row_item->'lineKey' <> 'null'::jsonb AND (jsonb_typeof(row_item->'lineKey') IS DISTINCT FROM 'string' OR (row_item->>'lineKey') !~ '^line:([1-9][0-9]{0,2}|1000)$') THEN RETURN false; END IF;
    IF row_item->'field' <> 'null'::jsonb AND ((row_item->>'field') IS NULL OR (row_item->>'field') NOT IN ('identity','approval','source','version','currency','lines','quantity','unit',
      'unitCost','unitPrice','lineCost','linePrice','costType','taxable','costCode','discount','format','bytes','renderer')) THEN RETURN false; END IF;
  END LOOP;
  IF NOT public.a1_export_issue_order_valid_v1(issues) THEN RETURN false; END IF;

  IF rec ?& ARRAY['state','approvedTotalMinor','exportedTotalMinor','differenceMinor','estimatedCostMinor'] IS NOT TRUE
     OR (SELECT count(*) FROM jsonb_object_keys(rec)) <> 5 THEN RETURN false; END IF;
  IF rec->>'state' IS NULL OR rec->>'state' NOT IN ('not_evaluated','matched','mismatch','unrepresentable') THEN RETURN false; END IF;
  IF rec->'approvedTotalMinor' <> 'null'::jsonb AND NOT public.internal_approval_matches_v1(rec->'approvedTotalMinor', jsonb_build_object('type','minor')) THEN RETURN false; END IF;
  IF rec->'exportedTotalMinor' <> 'null'::jsonb AND NOT public.internal_approval_matches_v1(rec->'exportedTotalMinor', jsonb_build_object('type','minor')) THEN RETURN false; END IF;
  IF rec->'estimatedCostMinor' <> 'null'::jsonb AND NOT public.internal_approval_matches_v1(rec->'estimatedCostMinor', jsonb_build_object('type','minor')) THEN RETURN false; END IF;
  IF rec->'differenceMinor' <> 'null'::jsonb AND NOT public.internal_approval_matches_v1(rec->'differenceMinor', jsonb_build_object('type','signed_minor')) THEN RETURN false; END IF;

  -- §4 top-level ready/blocked coherence.
  IF ready THEN
    IF rep = 'null'::jsonb OR jsonb_array_length(line_keys) < 1 OR jsonb_array_length(issues) <> 0 OR auth = 'null'::jsonb THEN RETURN false; END IF;
    IF rep->>'format' IS DISTINCT FROM format THEN RETURN false; END IF;
    principal := NULL; rule_totals := 'full'; rule_vstate := 'valid'; rule_rstate := 'matched';
  ELSE
    IF rep <> 'null'::jsonb OR jsonb_array_length(line_keys) <> 0 OR jsonb_array_length(issues) < 1 THEN RETURN false; END IF;
    principal := issues->0->>'code';
    rule_totals := public.a1_export_issue_totals_class_v1(principal);
    rule_vstate := public.a1_export_issue_validation_state_v1(principal);
    rule_rstate := public.a1_export_issue_reconciliation_state_v1(principal);
  END IF;

  IF val->>'state' IS DISTINCT FROM rule_vstate THEN RETURN false; END IF;
  IF rec->>'state' IS DISTINCT FROM rule_rstate THEN RETURN false; END IF;
  approved_nn := rule_totals <> 'none'; exported_nn := rule_totals = 'full';
  IF (rec->'approvedTotalMinor' <> 'null'::jsonb) IS DISTINCT FROM approved_nn THEN RETURN false; END IF;
  IF (rec->'estimatedCostMinor' <> 'null'::jsonb) IS DISTINCT FROM approved_nn THEN RETURN false; END IF;
  IF (rec->'exportedTotalMinor' <> 'null'::jsonb) IS DISTINCT FROM exported_nn THEN RETURN false; END IF;
  IF (rec->'differenceMinor' <> 'null'::jsonb) IS DISTINCT FROM exported_nn THEN RETURN false; END IF;
  IF exported_nn THEN
    expected_diff := (rec->>'exportedTotalMinor')::numeric - (rec->>'approvedTotalMinor')::numeric;
    IF expected_diff IS DISTINCT FROM (rec->>'differenceMinor')::numeric THEN RETURN false; END IF;
    IF principal = 'EXPORT_RECONCILIATION_MISMATCH' AND (rec->>'differenceMinor')::numeric = 0 THEN RETURN false; END IF;
    IF ready AND ((rec->>'approvedTotalMinor') IS DISTINCT FROM (rec->>'exportedTotalMinor') OR (rec->>'approvedTotalMinor')::numeric <= 0) THEN RETURN false; END IF;
  END IF;
  IF ready THEN
    IF auth = 'null'::jsonb THEN RETURN false; END IF;
  ELSE
    IF (auth = 'null'::jsonb) IS DISTINCT FROM public.a1_export_authority_null_required_v1(principal) THEN RETURN false; END IF;
  END IF;

  -- §3.2 client XNOR; §5.4 CSV-exclusive codes never justify a non-CSV block.
  IF (ctx->'clientId' = 'null'::jsonb) IS DISTINCT FROM (NOT ready AND public.a1_export_client_null_required_v1(principal)) THEN RETURN false; END IF;
  IF format <> 'csv_jobtread' THEN
    FOR i IN 0..jsonb_array_length(issues)-1 LOOP
      IF public.a1_export_csv_exclusive_code_v1(issues->i->>'code') THEN RETURN false; END IF;
    END LOOP;
  END IF;

  IF rep = 'null'::jsonb THEN RETURN true; END IF;

  -- representation common fields + generatedAt<=checkedAt + generatedBy=requestedBy
  -- + filename encodes THIS manifest's own draftId/exportId + per-format mime/renderer.
  IF rep ?& ARRAY['format','rendererVersion','generatedAt','generatedBy','filename','mimeType','encoding','artifactHash','byteLength','details'] IS NOT TRUE
     OR (SELECT count(*) FROM jsonb_object_keys(rep)) <> 10 THEN RETURN false; END IF;
  IF NOT public.internal_approval_matches_v1(rep->'generatedAt', jsonb_build_object('type','timestamp'))
     OR (rep->>'generatedAt') > (manifest->>'checkedAt') THEN RETURN false; END IF;
  IF rep->>'generatedBy' IS DISTINCT FROM ctx->>'requestedBy' THEN RETURN false; END IF;
  IF NOT public.internal_approval_matches_v1(rep->'artifactHash', jsonb_build_object('type','hash')) THEN RETURN false; END IF;
  IF NOT public.internal_approval_matches_v1(rep->'byteLength', jsonb_build_object('type','integer','min',1,'max',10485760)) THEN RETURN false; END IF;
  expected_filename := 'EST-' || (ctx->>'estimateDraftId') || '-' || (manifest->>'exportId') || '.' ||
    CASE format WHEN 'pdf' THEN 'pdf' WHEN 'json' THEN 'json' WHEN 'printable' THEN 'html' ELSE 'csv' END;
  IF rep->>'filename' IS DISTINCT FROM expected_filename THEN RETURN false; END IF;
  details := rep->'details';
  IF format = 'pdf' THEN
    IF rep->>'rendererVersion' IS DISTINCT FROM 'internal-estimate-pdf-v1' OR rep->>'mimeType' IS DISTINCT FROM 'application/pdf' OR rep->>'encoding' IS DISTINCT FROM 'base64' THEN RETURN false; END IF;
    IF details ?& ARRAY['layoutVersion','pageCount'] IS NOT TRUE OR (SELECT count(*) FROM jsonb_object_keys(details)) <> 2
       OR details->>'layoutVersion' IS DISTINCT FROM 'internal-estimate-summary-v1'
       OR NOT public.internal_approval_matches_v1(details->'pageCount', jsonb_build_object('type','integer','min',1,'max',10000))
    THEN RETURN false; END IF;
  ELSIF format = 'json' THEN
    IF rep->>'rendererVersion' IS DISTINCT FROM 'internal-estimate-json-v1' OR rep->>'mimeType' IS DISTINCT FROM 'application/json' OR rep->>'encoding' IS DISTINCT FROM 'utf8' THEN RETURN false; END IF;
    IF details ?& ARRAY['documentVersion','serialization'] IS NOT TRUE OR (SELECT count(*) FROM jsonb_object_keys(details)) <> 2
       OR details->>'documentVersion' IS DISTINCT FROM 'internal-estimate-document-v1' OR details->>'serialization' IS DISTINCT FROM 'canonical-json-utf8-v1'
    THEN RETURN false; END IF;
  ELSIF format = 'printable' THEN
    IF rep->>'rendererVersion' IS DISTINCT FROM 'internal-estimate-printable-v1' OR rep->>'mimeType' IS DISTINCT FROM 'text/html' OR rep->>'encoding' IS DISTINCT FROM 'utf8' THEN RETURN false; END IF;
    IF details ?& ARRAY['templateVersion','escaping','sandbox'] IS NOT TRUE OR (SELECT count(*) FROM jsonb_object_keys(details)) <> 3
       OR details->>'templateVersion' IS DISTINCT FROM 'internal-estimate-summary-v1' OR details->>'escaping' IS DISTINCT FROM 'html-text-attribute-v1' OR details->>'sandbox' IS DISTINCT FROM 'no-scripts-no-network-v1'
    THEN RETURN false; END IF;
  ELSE -- csv_jobtread
    IF rep->>'rendererVersion' IS DISTINCT FROM 'internal-estimate-jobtread-csv-v1' OR rep->>'mimeType' IS DISTINCT FROM 'text/csv' OR rep->>'encoding' IS DISTINCT FROM 'utf8' THEN RETURN false; END IF;
    IF details ?& ARRAY['contractVersion','classificationVersion','headers','delimiter','lineEnding','utf8Bom','rows'] IS NOT TRUE
       OR (SELECT count(*) FROM jsonb_object_keys(details)) <> 7
       OR details->>'contractVersion' IS DISTINCT FROM 'jobtread-budget-csv-a1-v1'
       OR details->>'classificationVersion' IS DISTINCT FROM 'jobtread-s20.1-classification-h1-8550e842-v1'
       OR details->'headers' <> '["Cost Group Name","Cost Item Name","Description","Quantity","Unit","Unit Cost","Unit Price","Cost Type","Taxable"]'::jsonb
       OR details->>'delimiter' IS DISTINCT FROM ',' OR details->>'lineEnding' IS DISTINCT FROM 'CRLF' OR details->'utf8Bom' <> 'false'::jsonb
    THEN RETURN false; END IF;
    rows := details->'rows';
    IF jsonb_typeof(rows) <> 'array' OR jsonb_array_length(rows) < 1 OR jsonb_array_length(rows) > 1000
       OR jsonb_array_length(rows) <> jsonb_array_length(line_keys) THEN RETURN false; END IF;
    FOR i IN 0..jsonb_array_length(rows)-1 LOOP
      row_item := rows->i;
      IF row_item ?& ARRAY['lineKey','ordinal','costGroupName','costItemName','description','quantity','unit','unitCost','unitPrice',
        'costType','taxable','costCode','assemblyId','lineCostMinor','linePriceMinor','costTypeSource','unitSource','costCodeSource'] IS NOT TRUE
        OR (SELECT count(*) FROM jsonb_object_keys(row_item)) <> 18 THEN RETURN false; END IF;
      IF row_item->>'lineKey' IS DISTINCT FROM 'line:' || (i+1)::text THEN RETURN false; END IF;
      -- V5 fix (MICHAEL-A1-EXPORT-PHYSICAL-V4-QA-AND-COMPLETION.md §3 review item:
      -- "CSV ordinal JSON type"): A1-EXPORT-DATA-CONTRACT.md line 256 requires
      -- ordinal to be an actual integer, but `->>` stringifies whatever JSON type
      -- is there before the ::integer cast, so a JSON STRING "1" (never a real
      -- integer) passed this check undetected. jsonb_typeof is checked first.
      IF jsonb_typeof(row_item->'ordinal') IS DISTINCT FROM 'number' OR (row_item->>'ordinal')::integer IS DISTINCT FROM i+1 THEN RETURN false; END IF;
      IF NOT public.internal_approval_matches_v1(row_item->'costGroupName', jsonb_build_object('type','label'))
         OR NOT public.internal_approval_matches_v1(row_item->'costItemName', jsonb_build_object('type','label'))
         OR NOT public.internal_approval_matches_v1(row_item->'description', jsonb_build_object('type','text'))
         OR NOT public.internal_approval_matches_v1(row_item->'quantity', jsonb_build_object('type','positive_decimal'))
         OR NOT public.internal_approval_matches_v1(row_item->'lineCostMinor', jsonb_build_object('type','minor'))
         OR NOT public.internal_approval_matches_v1(row_item->'linePriceMinor', jsonb_build_object('type','minor'))
         OR NOT public.internal_approval_matches_v1(row_item->'assemblyId', jsonb_build_object('type','uuid','nullable',true))
      THEN RETURN false; END IF;
      -- costGroupName/costItemName/description must ALREADY be canonical (no silent
      -- trim/CRLF repair of recorded evidence) — the matcher above only checks
      -- bounds/Unicode; re-derive the trimmed form and require it to be a no-op.
      IF public.internal_approval_trim_v1(replace(replace(row_item->>'costGroupName',E'\r\n',E'\n'),E'\r',E'\n')) IS DISTINCT FROM row_item->>'costGroupName'
         OR public.internal_approval_trim_v1(replace(replace(row_item->>'costItemName',E'\r\n',E'\n'),E'\r',E'\n')) IS DISTINCT FROM row_item->>'costItemName'
         OR replace(replace(row_item->>'description',E'\r\n',E'\n'),E'\r',E'\n') IS DISTINCT FROM row_item->>'description'
      THEN RETURN false; END IF;
      IF row_item->>'unit' IS NULL OR row_item->>'unit' NOT IN ('Each','Hours','Linear Feet','Lump Sum','Square Feet','Squares','Tons','Cubic Yards','Pounds','Bags','Boxes','Bundles','Gallons','Pieces','Rolls','Sets','Sheets')
      THEN RETURN false; END IF;
      IF row_item->>'costType' IS NULL OR row_item->>'costType' NOT IN ('Allowance','Equipment / Rental','Labor','Materials','Other','Permits / Fees','Subcontractor') THEN RETURN false; END IF;
      IF jsonb_typeof(row_item->'taxable') <> 'boolean' THEN RETURN false; END IF;
      IF row_item->>'costTypeSource' IS DISTINCT FROM 'classifyCostType_v1' THEN RETURN false; END IF;
      IF row_item->>'unitSource' IS NULL OR row_item->>'unitSource' NOT IN ('stored_canonical','normalizeUnit_v1') THEN RETURN false; END IF;
      -- Ready CSV never carries unreviewed classification: 'unknown' is always
      -- refused, which also makes a null costCode unreachable (the only source
      -- value that would have permitted one).
      IF row_item->>'costCodeSource' IS NULL OR row_item->>'costCodeSource' NOT IN ('stored','inferCostCode_v1') OR row_item->'costCode' = 'null'::jsonb THEN RETURN false; END IF;
      -- V5 fix (MICHAEL-A1-EXPORT-PHYSICAL-V4-QA-AND-COMPLETION.md §3 review item:
      -- "CSV unitCost/unitPrice JSON type"): A1-EXPORT-DATA-CONTRACT.md line 256
      -- requires these as fixed-two-decimal STRINGS specifically (so the exact
      -- digits round-trip, never a float) — but jsonb preserves a numeric
      -- literal's original digit text, so a JSON NUMBER 5.00 serializes via `->>`
      -- to the same "5.00" the regex below accepts, letting the wrong JSON type
      -- through unnoticed. jsonb_typeof is checked first.
      IF jsonb_typeof(row_item->'unitCost') IS DISTINCT FROM 'string' OR jsonb_typeof(row_item->'unitPrice') IS DISTINCT FROM 'string' THEN RETURN false; END IF;
      IF row_item->>'unitCost' IS NULL OR row_item->>'unitPrice' IS NULL
         OR row_item->>'unitCost' !~ '^(0|[1-9][0-9]{0,13})\.[0-9]{2}$' OR row_item->>'unitPrice' !~ '^(0|[1-9][0-9]{0,13})\.[0-9]{2}$' THEN RETURN false; END IF;
      -- §6.4/§7: the represented quantity*rate must reconcile to the represented
      -- total — the snapshot never cross-validates this on its own.
      IF public.a1_export_exact_amount_minor_v1(row_item->>'quantity', row_item->>'unitCost') <> (row_item->>'lineCostMinor')::numeric
         OR public.a1_export_exact_amount_minor_v1(row_item->>'quantity', row_item->>'unitPrice') <> (row_item->>'linePriceMinor')::numeric
      THEN RETURN false; END IF;
    END LOOP;
  END IF;
  RETURN true;
EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR invalid_datetime_format OR numeric_value_out_of_range OR division_by_zero THEN RETURN false;
END $$;
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. CHECK constraints — the local grammar/matrix above, plus the legacy marker
--    rule (§4 "Regras adicionais": NULL marker ⇒ every new column NULL too) and
--    manifest<->column mirror equality (§6: "todos os espelhos... coincidem").
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.jobtread_exports ADD CONSTRAINT ck_jte_a1_marker CHECK (
  artifact_contract_version IS NULL OR artifact_contract_version = 'internal-estimate-export-v1'
);
-- manifest is a PRE-EXISTING column (legacy JobTread cost-code mapping, JIC-005),
-- not one of the 15 genuinely new A1 columns — a real legacy row may already carry
-- content there unrelated to the new A1 grammar, and it must be preserved untouched,
-- never required NULL. Only the columns this migration actually adds are listed here.
ALTER TABLE public.jobtread_exports ADD CONSTRAINT ck_jte_a1_legacy_untouched CHECK (
  artifact_contract_version IS NOT NULL OR (
    artifact_format IS NULL AND attempt_kind IS NULL AND client_id IS NULL AND internal_approval_id IS NULL
    AND internal_snapshot_id IS NULL AND approved_content_hash IS NULL AND artifact_hash IS NULL
    AND renderer_version IS NULL AND generated_at IS NULL AND artifact_byte_length IS NULL AND checked_at IS NULL
    AND a1_estimate_draft_id IS NULL AND a1_requested_by IS NULL AND a1_downloaded_by IS NULL
  )
);
-- Every `x IN (...)` below is preceded by an explicit `x IS NOT NULL AND` — a bare
-- `NULL IN (...)` is SQL UNKNOWN, not FALSE, and a CHECK treats UNKNOWN as passing;
-- this is how a SQL-NULL artifact_format/attempt_kind column slipped through before.
ALTER TABLE public.jobtread_exports ADD CONSTRAINT ck_jte_a1_all_or_none CHECK (
  artifact_contract_version IS NULL OR (
    tenant_id IS NOT NULL AND project_id IS NOT NULL AND estimate_draft_id IS NOT NULL AND requested_by IS NOT NULL
    AND artifact_format IS NOT NULL AND artifact_format IN ('pdf','json','printable','csv_jobtread')
    AND attempt_kind IS NOT NULL AND attempt_kind IN ('preflight','delivery')
    AND checked_at IS NOT NULL AND manifest IS NOT NULL AND validation_report IS NOT NULL
    AND reconciliation_status IS NOT NULL AND reconciliation_status IN ('not_evaluated','matched','mismatch','unrepresentable')
    AND status IS NOT NULL AND status IN ('approved_for_download','downloaded','blocked_authorization','blocked_validation','blocked_reconciliation','needs_exception_review')
    AND NOT ('00000000-0000-0000-0000-000000000000'::uuid = ANY (ARRAY[id,tenant_id,project_id,estimate_draft_id,requested_by]))
    -- status must agree with the manifest's own outcome — a blocked manifest can
    -- never masquerade as a successful delivery by INSERT, and vice versa. For a
    -- blocked row specifically, status must match the PRINCIPAL issue's own class
    -- (A1-EXPORT-DATA-CONTRACT.md lines 205-223) — blocked_validation can never be
    -- recorded for an authorization-class issue such as INTERNAL_APPROVAL_REQUIRED.
    AND (manifest->>'outcome' = 'ready') = (status IN ('approved_for_download','downloaded'))
    AND (manifest->>'outcome' = 'ready' OR status = public.a1_export_issue_status_class_v1(manifest->'validation'->'issues'->0->>'code'))
    -- row_count: blocked is always 0 (no CSV/line representation exists to count);
    -- ready is always exactly the lineKeys count (1..1000), for every format
    -- including PDF — never a page count.
    AND row_count = CASE WHEN manifest->>'outcome' = 'ready' THEN jsonb_array_length(manifest->'lineKeys') ELSE 0 END
    -- downloaded_by/downloaded_at: both-or-neither always, and both NULL for any
    -- blocked row (a blocked manifest never reaches a first-delivery projection).
    AND (downloaded_by IS NULL) = (downloaded_at IS NULL)
    AND (manifest->>'outcome' = 'ready' OR (downloaded_by IS NULL AND downloaded_at IS NULL))
    -- Pre-existing legacy columns reused by the A1 grammar (0002's original
    -- defaults — 'csv-v1.0' for contract_version, 'gchi-jobtread-integration-
    -- contract' for skill_id — must never leak into a new A1 row unmirrored).
    AND contract_version IS NOT NULL AND contract_version IS NOT DISTINCT FROM artifact_contract_version
    AND skill_version IS NOT NULL AND skill_version = '1.0.0'
    AND skill_id IS NOT NULL AND skill_id = CASE WHEN artifact_format = 'csv_jobtread' THEN 'gchi-jobtread-integration-contract' ELSE 'structr-internal-estimate-export' END
    AND block_reason IS NOT DISTINCT FROM (CASE WHEN manifest->>'outcome' = 'blocked' THEN manifest->'validation'->'issues'->0->>'code' ELSE NULL END)
    AND csv_hash IS NOT DISTINCT FROM (CASE WHEN manifest->>'outcome' = 'ready' AND artifact_format = 'csv_jobtread' THEN artifact_hash ELSE NULL END)
  )
);
ALTER TABLE public.jobtread_exports ADD CONSTRAINT ck_jte_a1_manifest_valid CHECK (
  artifact_contract_version IS NULL OR public.internal_estimate_export_valid_manifest_v1(manifest) IS TRUE
);
-- All-or-none groups below are written as a SYMMETRIC chain of IS-NULL equalities
-- (a IS NULL) = (b IS NULL) = (c IS NULL), never a one-sided `(a IS NULL OR (...))`
-- — the one-sided form is TRUE the instant a IS NULL and never actually checks
-- whether b/c are ALSO null, which is exactly how a snapshot/hash/renderer could be
-- filled in without authority/representation before this fix.
ALTER TABLE public.jobtread_exports ADD CONSTRAINT ck_jte_a1_manifest_mirror CHECK (
  artifact_contract_version IS NULL OR (
    (manifest->>'exportId')::uuid = id
    AND (manifest->'context'->>'tenantId')::uuid = tenant_id
    AND (manifest->'context'->>'projectId')::uuid = project_id
    AND (manifest->'context'->'clientId' = 'null'::jsonb) = (client_id IS NULL)
    AND (client_id IS NULL OR (manifest->'context'->>'clientId')::uuid = client_id)
    AND (manifest->'context'->>'estimateDraftId')::uuid = estimate_draft_id
    AND estimate_version IS NOT NULL AND (manifest->'context'->>'estimateVersion')::integer = estimate_version
    AND (manifest->'context'->>'requestedBy')::uuid = requested_by
    -- artifact_format/attempt_kind/checked_at NULL-safety is ck_jte_a1_all_or_none's
    -- job (both columns are required NOT NULL there); by the time all constraints on
    -- this row hold together, a bare = here is already safe.
    AND manifest->>'format' = artifact_format AND manifest->>'attemptKind' = attempt_kind
    AND manifest->>'checkedAt' = to_char(checked_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    AND validation_report = manifest->'validation'
    AND (manifest->'authority' = 'null'::jsonb) = (internal_approval_id IS NULL)
    AND (internal_approval_id IS NULL) = (internal_snapshot_id IS NULL)
    AND (internal_approval_id IS NULL) = (approved_content_hash IS NULL)
    AND (internal_approval_id IS NULL OR (
      (manifest->'authority'->>'approvalId')::uuid = internal_approval_id
      AND (manifest->'authority'->>'snapshotId')::uuid = internal_snapshot_id
      AND manifest->'authority'->>'contentHash' = approved_content_hash
    ))
    AND (manifest->'representation' = 'null'::jsonb) = (artifact_hash IS NULL)
    AND (artifact_hash IS NULL) = (renderer_version IS NULL)
    AND (artifact_hash IS NULL) = (generated_at IS NULL)
    AND (artifact_hash IS NULL) = (artifact_byte_length IS NULL)
    AND (artifact_hash IS NULL OR (
      manifest->'representation'->>'rendererVersion' = renderer_version
      AND manifest->'representation'->>'generatedAt' = to_char(generated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      AND manifest->'representation'->>'artifactHash' = artifact_hash
      AND (manifest->'representation'->>'byteLength')::integer = artifact_byte_length
    ))
    AND reconciliation_status IS NOT NULL AND reconciliation_status = manifest->'validation'->'reconciliation'->>'state'
    AND coalesce(approved_total_cents::text, 'null') = coalesce((manifest->'validation'->'reconciliation'->>'approvedTotalMinor'), 'null')
    AND coalesce(exported_total_cents::text, 'null') = coalesce((manifest->'validation'->'reconciliation'->>'exportedTotalMinor'), 'null')
    AND coalesce(difference_cents::text, 'null') = coalesce((manifest->'validation'->'reconciliation'->>'differenceMinor'), 'null')
    AND octet_length(manifest::text) <= 16777216
  )
);
-- Timestamp precision: present timestamps must already equal their own millisecond
-- truncation (A1-EXPORT-DATA-CONTRACT.md §2.2 physical roundtrip requirement).
ALTER TABLE public.jobtread_exports ADD CONSTRAINT ck_jte_a1_time_precision CHECK (
  (generated_at IS NULL OR generated_at = date_trunc('milliseconds', generated_at))
  AND (checked_at IS NULL OR checked_at = date_trunc('milliseconds', checked_at))
  AND (generated_at IS NULL OR checked_at IS NULL OR generated_at <= checked_at)
  AND (downloaded_at IS NULL OR checked_at IS NULL OR artifact_contract_version IS NULL OR downloaded_at >= checked_at)
  -- created_at/updated_at are pre-existing, never-NULL legacy columns (unlike the
  -- other timestamps above) — the millisecond-precision requirement only applies
  -- to A1 rows, never retroactively to legacy data written before this rule.
  AND (artifact_contract_version IS NULL OR created_at = date_trunc('milliseconds', created_at))
  AND (artifact_contract_version IS NULL OR updated_at = date_trunc('milliseconds', updated_at))
);
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. §4 "Regras adicionais" extension of the legacy CHECK: NULL is never treated
--    as a zero difference under the A1 strict rule. The legacy CHECK itself is
--    kept equivalent for artifact_contract_version IS NULL (untouched semantics);
--    the A1 branch delegates fully to ck_jte_a1_manifest_valid above, which
--    already enforces the exact, non-NULL-coalescing rule.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.jobtread_exports DROP CONSTRAINT IF EXISTS ck_jobtread_export_reconciled;
ALTER TABLE public.jobtread_exports ADD CONSTRAINT ck_jobtread_export_reconciled CHECK (
  artifact_contract_version IS NOT NULL
  OR status NOT IN ('approved_for_download', 'downloaded')
  OR coalesce(difference_cents, 0) = 0
);
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. §6 immutability. BEFORE INSERT rejects a new legacy/invalid-marker row
--     (legacy rows already in the table are untouched — this only gates NEW
--     inserts). BEFORE UPDATE protects every A1 column except the single legal
--     transition (approved_for_download -> downloaded, both download fields
--     together, updatedAt matching). BEFORE DELETE rejects any A1 row outright,
--     including via cascade.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.jobtread_export_a1_insert_guard_v1() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog AS $$
BEGIN
  -- §4: "Novas inserções... exigem marcador v1" — every NEW row (never a row that
  -- already existed before this migration) must carry the exact literal marker.
  -- NULL/unknown is rejected outright; there is no live writer today that still
  -- inserts a legacy-shaped row (confirmed: no INSERT into jobtread_exports exists
  -- anywhere in server/client/shared), so this cannot break a real caller.
  IF NEW.artifact_contract_version IS DISTINCT FROM 'internal-estimate-export-v1' THEN
    RAISE EXCEPTION 'New jobtread_exports rows must carry the full A1 marker; NULL/abbreviated markers are only valid for rows that already existed before this migration.'
      USING ERRCODE = '23514', CONSTRAINT = 'jte_a1_insert_marker_invalid', TABLE = 'jobtread_exports';
  END IF;
  -- A1-EXPORT-DATA-CONTRACT.md line 101: updated_at is initially equal to
  -- created_at — only the first-download transition (or a later no-op) may move
  -- it apart. A CHECK constraint cannot distinguish INSERT from UPDATE on its
  -- own; this BEFORE INSERT trigger is the one place that legitimately can.
  IF NEW.created_at IS DISTINCT FROM NEW.updated_at THEN
    RAISE EXCEPTION 'A new A1 jobtread_exports row must have updated_at exactly equal to created_at at insert time.'
      USING ERRCODE = '23514', CONSTRAINT = 'jte_a1_insert_timestamps_not_initial', TABLE = 'jobtread_exports';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_jte_a1_insert_guard BEFORE INSERT ON public.jobtread_exports
  FOR EACH ROW EXECUTE FUNCTION public.jobtread_export_a1_insert_guard_v1();
--> statement-breakpoint

CREATE FUNCTION public.jobtread_export_a1_immutability_guard_v1() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog AS $$
DECLARE
  is_legal_download boolean;
  gen_cols text[];
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.artifact_contract_version IS NOT NULL THEN
      RAISE EXCEPTION 'A1 export evidence cannot be deleted, including by cascade.'
        USING ERRCODE = '23514', CONSTRAINT = 'jte_a1_delete_forbidden', TABLE = 'jobtread_exports';
    END IF;
    RETURN OLD;
  END IF;

  -- UPDATE. A legacy row (OLD marker NULL) may never be promoted to A1 by UPDATE.
  IF OLD.artifact_contract_version IS NULL THEN
    IF NEW.artifact_contract_version IS NOT NULL THEN
      RAISE EXCEPTION 'A legacy row cannot be promoted to an A1 record by UPDATE.'
        USING ERRCODE = '23514', CONSTRAINT = 'jte_a1_legacy_promotion_forbidden', TABLE = 'jobtread_exports';
    END IF;
    RETURN NEW; -- legacy row, legacy UPDATE path — unchanged behavior.
  END IF;

  -- Generated columns (a1_estimate_draft_id/a1_requested_by/a1_downloaded_by) are NOT
  -- yet recomputed on NEW inside a BEFORE ROW trigger — Postgres fills them in only
  -- after the BEFORE trigger chain returns — so NEW always carries them as NULL here
  -- regardless of the real, persisted value OLD shows. Every to_jsonb comparison in
  -- this function must exclude all three or it would see a spurious "change" on
  -- every single UPDATE of an A1 row, including true no-ops. Their real underlying
  -- base columns (estimate_draft_id, requested_by, downloaded_by, artifact_contract_version)
  -- are ordinary stored columns and remain fully compared, so this costs no protection.
  gen_cols := ARRAY['a1_estimate_draft_id','a1_requested_by','a1_downloaded_by'];

  -- Exact no-op is always permitted (to_jsonb comparison catches it below too,
  -- but checked explicitly first for a clearer exception message otherwise).
  IF to_jsonb(NEW) - gen_cols = to_jsonb(OLD) - gen_cols THEN RETURN NEW; END IF;

  is_legal_download :=
    OLD.status = 'approved_for_download' AND NEW.status = 'downloaded'
    AND OLD.downloaded_by IS NULL AND OLD.downloaded_at IS NULL
    AND NEW.downloaded_by IS NOT NULL AND NEW.downloaded_at IS NOT NULL
    AND NEW.updated_at = NEW.downloaded_at
    AND date_trunc('milliseconds', NEW.downloaded_at) = NEW.downloaded_at;

  IF is_legal_download THEN
    -- Every OTHER column must be unchanged in this same transition.
    IF to_jsonb(NEW) - gen_cols - ARRAY['status','downloadedBy','downloadedAt','updatedAt','downloaded_by','downloaded_at','updated_at']
       IS DISTINCT FROM to_jsonb(OLD) - gen_cols - ARRAY['status','downloadedBy','downloadedAt','updatedAt','downloaded_by','downloaded_at','updated_at']
    THEN
      RAISE EXCEPTION 'The only legal A1 transition (approved_for_download -> downloaded) may not change any other column.'
        USING ERRCODE = '23514', CONSTRAINT = 'jte_a1_download_transition_scope', TABLE = 'jobtread_exports';
    END IF;
    RETURN NEW;
  END IF;

  -- Second download onward: downloadedBy/At are the FIRST actor/time and never move.
  IF OLD.status = 'downloaded' AND NEW.status = 'downloaded'
     AND NEW.downloaded_by = OLD.downloaded_by AND NEW.downloaded_at = OLD.downloaded_at
     AND to_jsonb(NEW) - gen_cols = to_jsonb(OLD) - gen_cols
  THEN RETURN NEW; END IF;

  RAISE EXCEPTION 'A1 export evidence is immutable outside the single approved_for_download -> downloaded transition.'
    USING ERRCODE = '23514', CONSTRAINT = 'jte_a1_update_forbidden', TABLE = 'jobtread_exports';
END $$;
CREATE TRIGGER trg_jte_a1_immutability_guard BEFORE UPDATE OR DELETE ON public.jobtread_exports
  FOR EACH ROW EXECUTE FUNCTION public.jobtread_export_a1_immutability_guard_v1();

-- §5 "Relações/concorrência": the pure structural function/CHECK above only validates
-- the manifest's SHAPE (a well-formed authority object, correct null-correspondence) —
-- it cannot know whether the approval/snapshot the manifest names actually exists,
-- still applies, or truly matches. This deferred constraint trigger closes that gap
-- against the REAL estimate_internal_approvals/snapshots/revocations rows at commit
-- time. Fires on INSERT and on the one legal UPDATE (approved_for_download ->
-- downloaded) — any OTHER UPDATE is already rejected by the BEFORE trigger above
-- before this ever runs, so AFTER INSERT OR UPDATE safely covers "INSERT A1 e
-- primeira projeção de download" in one function.
CREATE FUNCTION public.jobtread_export_a1_check_final_v1() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog AS $$
DECLARE
  d public.estimate_drafts;
  p public.projects;
  a public.estimate_internal_approvals;
  s public.estimate_internal_approval_snapshots;
  is_insert boolean;
  is_first_download boolean;
  is_ready boolean;
  csv_row jsonb;
  csv_line jsonb;
  csv_class jsonb;
  csv_sum_cost numeric;
  csv_sum_price numeric;
BEGIN
  is_insert := TG_OP = 'INSERT';
  is_first_download := TG_OP = 'UPDATE' AND OLD.status = 'approved_for_download' AND NEW.status = 'downloaded';
  -- The norm names exactly two moments (A1-EXPORT-DATA-CONTRACT.md §6, lines 276-283):
  -- the first commit and EACH first download projection. A later no-op/idempotent
  -- UPDATE (OLD.status already 'downloaded') is neither — re-deciding it would wrongly
  -- punish an identical retry for a revocation that happened after the real decision
  -- this row already recorded.
  IF NOT (is_insert OR is_first_download) THEN RETURN NULL; END IF;

  is_ready := NEW.manifest->>'outcome' = 'ready';

  -- §6 item 1: basic context is checked for EVERY applicable row, even authority-NULL
  -- (no-decision) ones — real draft lock FIRST, FOR UPDATE (the SAME mode 0007's own
  -- internal_approval_check_final_v1 takes on estimate_drafts — NOT FOR KEY SHARE,
  -- which 0007 uses only for a lighter parent-context read elsewhere), then re-read
  -- before deciding anything, never trusting a lock-free read the caller might hold.
  SELECT * INTO d FROM public.estimate_drafts WHERE id = NEW.estimate_draft_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A1_EXPORT_DRAFT_MISSING' USING ERRCODE='23514',CONSTRAINT='jte_a1_export_draft_missing',TABLE='jobtread_exports';
  END IF;
  IF d.tenant_id IS DISTINCT FROM NEW.tenant_id OR d.project_id IS DISTINCT FROM NEW.project_id THEN
    RAISE EXCEPTION 'A1_EXPORT_DRAFT_CONTEXT_MISMATCH' USING ERRCODE='23514',CONSTRAINT='jte_a1_export_draft_context',TABLE='jobtread_exports';
  END IF;
  IF (NEW.manifest->'context'->>'estimateVersion')::integer IS DISTINCT FROM d.version THEN
    RAISE EXCEPTION 'A1_EXPORT_DRAFT_VERSION_MISMATCH' USING ERRCODE='23514',CONSTRAINT='jte_a1_export_draft_version',TABLE='jobtread_exports';
  END IF;
  -- clientId present must match the draft's real client; NULL is permitted only in
  -- the blocks the structural CHECK already restricts to ESTIMATE_CLIENT_MISSING/
  -- ESTIMATE_CLIENT_CONTEXT_MISMATCH.
  IF NEW.client_id IS NOT NULL AND NEW.client_id IS DISTINCT FROM d.client_id THEN
    RAISE EXCEPTION 'A1_EXPORT_CLIENT_CONTEXT_MISMATCH' USING ERRCODE='23514',CONSTRAINT='jte_a1_export_client_context',TABLE='jobtread_exports';
  END IF;
  -- V5 fix (MICHAEL-A1-EXPORT-PHYSICAL-V4-QA-AND-COMPLETION.md §3 review item:
  -- "client-match-to-project, not just client-match-to-draft"):
  -- A1-EXPORT-DATA-CONTRACT.md §3.2 is explicit — "client_id, quando não NULL, é
  -- igual ao cliente do draft E do projeto no tenant" (equal to the client of
  -- the draft AND of the project, not the draft alone). The check above only
  -- ever compared against the draft's own client_id; a project whose own
  -- client_id disagreed with the draft's (a real, representable inconsistency —
  -- a project can be reassigned a different client than a draft created under
  -- its earlier one) would pass undetected. The project's client is now also
  -- checked, independently of the draft's.
  SELECT * INTO p FROM public.projects WHERE id = NEW.project_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A1_EXPORT_PROJECT_MISSING' USING ERRCODE='23514',CONSTRAINT='jte_a1_export_project_missing',TABLE='jobtread_exports';
  END IF;
  IF NEW.client_id IS NOT NULL AND NEW.client_id IS DISTINCT FROM p.client_id THEN
    RAISE EXCEPTION 'A1_EXPORT_CLIENT_CONTEXT_MISMATCH' USING ERRCODE='23514',CONSTRAINT='jte_a1_export_client_context',TABLE='jobtread_exports';
  END IF;

  -- V7 fix (MICHAEL-A1-EXPORT-PHYSICAL-V6-QA-AND-COMPLETION.md §1a):
  -- A1-EXPORT-DATA-CONTRACT.md §5.2 — "lineKey nullable e, se presente, deve
  -- existir no snapshot." With no usable decision (no authority), there is no
  -- snapshot to check existence against at all — a lexically well-formed
  -- LineKey like "line:999" is NOT evidence it refers to anything real, and
  -- must never be persisted as if it were. The pure grammar function
  -- (internal_estimate_export_valid_manifest_v1) only validates the FORMAT of
  -- issues[].lineKey (V5 fix) — it cannot check real-table existence by
  -- design (no table reads). This is the one place in the physical unit that
  -- legitimately can, and must, for the authority-NULL case.
  IF NEW.internal_approval_id IS NULL AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(NEW.manifest->'validation'->'issues') elem
    WHERE elem->'lineKey' IS DISTINCT FROM 'null'::jsonb
  ) THEN
    RAISE EXCEPTION 'A1_EXPORT_ISSUE_LINEKEY_UNVERIFIABLE' USING ERRCODE='23514',CONSTRAINT='jte_a1_export_issue_linekey_unverifiable',TABLE='jobtread_exports';
  END IF;

  -- Authority-NULL rows (no real decision claimed) have nothing further to
  -- correspond against — already structurally required for exactly the six
  -- "no usable decision" issue codes.
  IF NEW.internal_approval_id IS NULL THEN RETURN NULL; END IF;

  -- §6 item 2: same approval/snapshot/hash (defense-in-depth alongside
  -- jte_a1_approval_fk/jte_a1_snapshot_hash_fk, which already enforce this
  -- declaratively — kept here since a plain FK can't express the manifest-vs-real-row
  -- comparisons this function needs anyway).
  SELECT * INTO a FROM public.estimate_internal_approvals WHERE id = NEW.internal_approval_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A1_EXPORT_APPROVAL_MISSING' USING ERRCODE='23514',CONSTRAINT='jte_a1_export_approval_missing',TABLE='jobtread_exports';
  END IF;
  SELECT * INTO s FROM public.estimate_internal_approval_snapshots WHERE id = a.snapshot_id;
  IF NOT FOUND OR NEW.internal_snapshot_id IS DISTINCT FROM a.snapshot_id THEN
    RAISE EXCEPTION 'A1_EXPORT_SNAPSHOT_MISMATCH' USING ERRCODE='23514',CONSTRAINT='jte_a1_export_snapshot_mismatch',TABLE='jobtread_exports';
  END IF;
  IF NEW.approved_content_hash IS DISTINCT FROM s.content_hash THEN
    RAISE EXCEPTION 'A1_EXPORT_HASH_MISMATCH' USING ERRCODE='23514',CONSTRAINT='jte_a1_export_hash_mismatch',TABLE='jobtread_exports';
  END IF;

  -- V7 fix (MICHAEL-A1-EXPORT-PHYSICAL-V6-QA-AND-COMPLETION.md §1a, known-
  -- authority half): with a real snapshot now loaded (`s`), every NON-NULL
  -- issues[].lineKey must actually belong to it — lexical validity (the V5
  -- format fix) is not evidence of belonging. Applies regardless of ready/
  -- blocked (harmless no-op for ready, which always has 0 issues by
  -- grammar) — covers a blocked-with-known-decision row (e.g. revoked/
  -- superseded) whose issue claims a line that never existed in that exact
  -- snapshot. The accepted TS engine (shared/internal-estimate-export-
  -- engine.ts:313) already includes issues in its own comparison set; this
  -- is the SQL side's matching real-table check, not a semantic change.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(NEW.manifest->'validation'->'issues') elem
    WHERE elem->'lineKey' IS DISTINCT FROM 'null'::jsonb
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(s.snapshot_payload->'lines') line
        WHERE line->>'lineKey' = elem->>'lineKey'
      )
  ) THEN
    RAISE EXCEPTION 'A1_EXPORT_ISSUE_LINEKEY_MISMATCH' USING ERRCODE='23514',CONSTRAINT='jte_a1_export_issue_linekey_mismatch',TABLE='jobtread_exports';
  END IF;

  -- §6 item 4 (totals part): the pure engine compares approvedTotal/estimatedCost to
  -- the snapshot WHENEVER authority exists — including a blocked row with a known
  -- decision (e.g. INTERNAL_APPROVAL_REVOKED, whose totals class is "approvedOnly").
  -- This must NOT be gated on is_ready; we are already past the authority-NULL
  -- early-return, so internal_approval_id is guaranteed non-null here regardless of
  -- outcome.
  IF NEW.manifest->'validation'->'reconciliation'->>'approvedTotalMinor' IS DISTINCT FROM s.final_price_minor::text THEN
    RAISE EXCEPTION 'A1_EXPORT_APPROVED_TOTAL_MISMATCH' USING ERRCODE='23514',CONSTRAINT='jte_a1_export_approved_total_mismatch',TABLE='jobtread_exports';
  END IF;
  IF NEW.manifest->'validation'->'reconciliation'->>'estimatedCostMinor' IS DISTINCT FROM s.estimated_cost_minor::text THEN
    RAISE EXCEPTION 'A1_EXPORT_ESTIMATED_COST_MISMATCH' USING ERRCODE='23514',CONSTRAINT='jte_a1_export_estimated_cost_mismatch',TABLE='jobtread_exports';
  END IF;

  -- §6 item 3: vigency AT THIS EVENT — never at the manifest's own frozen checked_at,
  -- which is not a waiver. Only a 'ready' claim needs current authority; a blocked row
  -- whose own issue is INTERNAL_APPROVAL_REVOKED/ESTIMATE_SUPERSEDED is declaring that
  -- state as its reason, not hiding it. "Não disparar invalidação retroativa": the
  -- already-committed ROW is never touched by a later revocation (immutability above
  -- already guarantees that) — but EACH new projection (this INSERT, or this later
  -- first-download UPDATE) re-queries the core tables for itself, under the lock just
  -- taken on the draft.
  IF is_ready THEN
    -- V7 fix (MICHAEL-A1-EXPORT-PHYSICAL-V6-QA-AND-COMPLETION.md §1b): lineage/
    -- ancestry eligibility (0007's own accepted check — H1 identity by source OR
    -- relational link, bounded ancestry; a tampered source does not make history
    -- eligible) gates READY delivery specifically — it is NOT a generic validator
    -- of blocked evidence. A1-EXPORT-DATA-CONTRACT.md §6 requires vigency/
    -- eligibility only for ready; §§3.2/4/8 allow recording a block in the basic
    -- authorized context regardless of whether the draft would ever BE eligible
    -- (e.g. a historical_import-sourced draft blocked with
    -- HISTORICAL_AUTHORITY_NOT_AVAILABLE, or a client-missing draft blocked with
    -- ESTIMATE_CLIENT_MISSING — both real, legitimate blocked records this
    -- function must accept). Previously called unconditionally above, for EVERY
    -- applicable row including blocked ones — rejecting the very evidence that
    -- explains why the draft is ineligible. Moved here so it still rejects a
    -- READY claim from an ineligible-source/broken-ancestry draft (regression:
    -- the existing ready scenarios below and the real writers' own fixtures),
    -- while a blocked row no longer needs to pass an eligibility check it is
    -- explicitly declaring it does NOT meet.
    PERFORM public.internal_approval_check_lineage_v1(d.id);

    -- Most specific reason first: a real revocation row naming this exact approval,
    -- before the more general core-eligible-state check (which the same revocation
    -- also flips d.status for, per 0007's own guard — checking the specific table
    -- first gives a clearer diagnostic without changing what is ultimately rejected).
    IF EXISTS (SELECT 1 FROM public.estimate_internal_approval_revocations WHERE approval_id = a.id) THEN
      RAISE EXCEPTION 'A1_EXPORT_APPROVAL_REVOKED' USING ERRCODE='23514',CONSTRAINT='jte_a1_export_approval_revoked',TABLE='jobtread_exports';
    END IF;
    IF d.superseded_by IS NOT NULL THEN
      RAISE EXCEPTION 'A1_EXPORT_DRAFT_SUPERSEDED' USING ERRCODE='23514',CONSTRAINT='jte_a1_export_draft_superseded',TABLE='jobtread_exports';
    END IF;
    IF d.status IS DISTINCT FROM 'internally_approved' THEN
      RAISE EXCEPTION 'A1_EXPORT_DRAFT_NOT_ELIGIBLE' USING ERRCODE='23514',CONSTRAINT='jte_a1_export_draft_not_eligible',TABLE='jobtread_exports';
    END IF;

    -- §6 item 4 (non-CSV part): exact lineKeys/row-count/order correspond to the
    -- real snapshot — not merely well-formed, actually equal to it. (Totals are
    -- checked above, unconditionally on authority presence, not gated here.)
    IF NEW.manifest->'lineKeys' IS DISTINCT FROM (
      SELECT jsonb_agg(line->>'lineKey' ORDER BY ord) FROM jsonb_array_elements(s.snapshot_payload->'lines') WITH ORDINALITY AS t(line, ord)
    ) THEN
      RAISE EXCEPTION 'A1_EXPORT_LINEKEYS_MISMATCH' USING ERRCODE='23514',CONSTRAINT='jte_a1_export_linekeys_mismatch',TABLE='jobtread_exports';
    END IF;

    -- CSV-specific exact correspondence (classification/provenance/taxation/rate/
    -- discount) — only when the representation IS CSV. Mirrors
    -- checkExportCsvRowAgainstLine/checkExportCsvAgainstSnapshot
    -- (shared/internal-estimate-export-engine.ts) against the REAL snapshot lines,
    -- not merely a well-formed row. rateExact uses the SAME exactTwoDecimal rule as
    -- the pure engine (a1_export_exact_two_decimal_v1 above) — a plain numeric
    -- comparison is NOT equivalent (a snapshot value with more than 2 fraction
    -- digits must be rejected even when numerically equal to the candidate).
    IF NEW.manifest->'representation'->>'format' = 'csv_jobtread' THEN
      csv_sum_cost := 0; csv_sum_price := 0;
      FOR csv_row IN SELECT value FROM jsonb_array_elements(NEW.manifest->'representation'->'details'->'rows')
      LOOP
        SELECT value INTO csv_line FROM jsonb_array_elements(s.snapshot_payload->'lines') AS value
          WHERE value->>'lineKey' = csv_row->>'lineKey';
        IF csv_line IS NULL THEN
          RAISE EXCEPTION 'A1_EXPORT_CSV_LINE_MISSING' USING ERRCODE='23514',CONSTRAINT='jte_a1_export_csv_line_missing',TABLE='jobtread_exports';
        END IF;
        IF csv_line->>'costGroupName' IS DISTINCT FROM csv_row->>'costGroupName'
           OR csv_line->>'costItemName' IS DISTINCT FROM csv_row->>'costItemName'
           OR COALESCE(csv_line->>'description','') IS DISTINCT FROM csv_row->>'description'
           OR csv_line->>'quantity' IS DISTINCT FROM csv_row->>'quantity'
           OR csv_line->>'assemblyId' IS DISTINCT FROM csv_row->>'assemblyId'
           OR (csv_line->>'taxable')::boolean IS DISTINCT FROM (csv_row->>'taxable')::boolean
           OR csv_line->>'lineTotalCostMinor' IS DISTINCT FROM csv_row->>'lineCostMinor'
           OR csv_line->>'lineTotalPriceMinor' IS DISTINCT FROM csv_row->>'linePriceMinor'
        THEN
          RAISE EXCEPTION 'A1_EXPORT_CSV_IDENTITY_MISMATCH' USING ERRCODE='23514',CONSTRAINT='jte_a1_export_csv_identity_mismatch',TABLE='jobtread_exports';
        END IF;
        csv_class := csv_line->'csvClassification';
        IF csv_class IS NULL OR csv_class = 'null'::jsonb
           OR csv_class->>'costType' IS DISTINCT FROM csv_row->>'costType'
           OR csv_class->>'normalizedUnit' IS DISTINCT FROM csv_row->>'unit'
           OR csv_class->>'costCode' IS DISTINCT FROM csv_row->>'costCode'
           OR csv_class->>'unitSource' IS DISTINCT FROM csv_row->>'unitSource'
           OR csv_class->>'costCodeSource' IS DISTINCT FROM csv_row->>'costCodeSource'
        THEN
          RAISE EXCEPTION 'A1_EXPORT_CSV_CLASSIFICATION_MISMATCH' USING ERRCODE='23514',CONSTRAINT='jte_a1_export_csv_classification_mismatch',TABLE='jobtread_exports';
        END IF;
        IF NOT public.a1_export_exact_two_decimal_v1(csv_line->>'unitCostSnapshot', csv_row->>'unitCost')
           OR NOT public.a1_export_exact_two_decimal_v1(csv_line->>'unitPriceSnapshot', csv_row->>'unitPrice')
        THEN
          RAISE EXCEPTION 'A1_EXPORT_CSV_RATE_MISMATCH' USING ERRCODE='23514',CONSTRAINT='jte_a1_export_csv_rate_mismatch',TABLE='jobtread_exports';
        END IF;
        -- Exact quantity×rate extension, half-away-from-zero at the cent — reusing the
        -- SAME a1_export_exact_amount_minor_v1 the structural CHECK above already uses
        -- (itself the SQL mirror of computeExactAmountMinor), not a second
        -- reimplementation of the same rule.
        IF public.a1_export_exact_amount_minor_v1(csv_row->>'quantity', csv_row->>'unitCost') IS DISTINCT FROM (csv_row->>'lineCostMinor')::numeric
           OR public.a1_export_exact_amount_minor_v1(csv_row->>'quantity', csv_row->>'unitPrice') IS DISTINCT FROM (csv_row->>'linePriceMinor')::numeric
        THEN
          RAISE EXCEPTION 'A1_EXPORT_CSV_AMOUNT_MISMATCH' USING ERRCODE='23514',CONSTRAINT='jte_a1_export_csv_amount_mismatch',TABLE='jobtread_exports';
        END IF;
        csv_sum_cost := csv_sum_cost + (csv_row->>'lineCostMinor')::numeric;
        csv_sum_price := csv_sum_price + (csv_row->>'linePriceMinor')::numeric;
      END LOOP;
      IF csv_sum_cost IS DISTINCT FROM (NEW.manifest->'validation'->'reconciliation'->>'estimatedCostMinor')::numeric THEN
        RAISE EXCEPTION 'A1_EXPORT_CSV_SUM_COST_MISMATCH' USING ERRCODE='23514',CONSTRAINT='jte_a1_export_csv_sum_cost_mismatch',TABLE='jobtread_exports';
      END IF;
      IF csv_sum_price IS DISTINCT FROM (NEW.manifest->'validation'->'reconciliation'->>'exportedTotalMinor')::numeric THEN
        RAISE EXCEPTION 'A1_EXPORT_CSV_SUM_PRICE_MISMATCH' USING ERRCODE='23514',CONSTRAINT='jte_a1_export_csv_sum_price_mismatch',TABLE='jobtread_exports';
      END IF;
      -- CSV's 9 columns cannot represent a discount; a ready CSV export must come
      -- from a snapshot with none to hide.
      IF (s.snapshot_payload->'financials'->>'discountApplied')::boolean IS TRUE
         OR (s.snapshot_payload->'financials'->>'discountMinor') IS DISTINCT FROM '0' THEN
        RAISE EXCEPTION 'A1_EXPORT_CSV_DISCOUNT_UNREPRESENTABLE' USING ERRCODE='23514',CONSTRAINT='jte_a1_export_csv_discount_unrepresentable',TABLE='jobtread_exports';
      END IF;
    END IF;
  END IF;

  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER jte_a1_export_final AFTER INSERT OR UPDATE ON public.jobtread_exports
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.jobtread_export_a1_check_final_v1();
