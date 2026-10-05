-- MICHAEL-A1-EXPORT-PREFLIGHT-WRITER-V1-QA-AND-CORRECTION.md item 1 — repairs a
-- defect in 0013's `a1_export_issue_status_class_v1`: it collapsed BOTH rank-2
-- codes to 'blocked_reconciliation', but Export §5.2 and the writer/CSV contracts
-- require EXPORT_COMMERCIAL_ADJUSTMENT_UNREPRESENTED -> 'needs_exception_review'
-- specifically, keeping EXPORT_RECONCILIATION_MISMATCH -> 'blocked_reconciliation'.
-- 'needs_exception_review' was already a legal CHECK value (0013 line ~539) —
-- only this function's own mapping was wrong. This migration does NOT touch
-- rank/order (a1_export_issue_class_rank_v1), totals-class, validation-state,
-- reconciliation-state, grants, RLS, or any immutability trigger — all of those
-- are unaffected by this specific defect and stay exactly as 0013 left them.
-- No real data is migrated; this is local-only schema repair, never deployed.

CREATE OR REPLACE FUNCTION public.a1_export_issue_status_class_v1(code text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog AS $$
  SELECT CASE
    WHEN code = 'EXPORT_COMMERCIAL_ADJUSTMENT_UNREPRESENTED' THEN 'needs_exception_review'
    WHEN public.a1_export_issue_class_rank_v1(code) = 0 THEN 'blocked_authorization'
    WHEN public.a1_export_issue_class_rank_v1(code) = 1 THEN 'blocked_validation'
    WHEN public.a1_export_issue_class_rank_v1(code) = 2 THEN 'blocked_reconciliation'
    ELSE NULL
  END
$$;
--> statement-breakpoint

-- CREATE OR REPLACE FUNCTION never re-walks existing rows against the
-- ck_jte_a1_all_or_none CHECK that calls this function (Postgres only validates a
-- CHECK's current rows when the CHECK itself is created/validated, never when a
-- function it invokes is redefined) — so any row already written under 0013's
-- OLD mapping that disagrees with the corrected one above would otherwise sit
-- silently inconsistent. Verify the applicable A1 population explicitly and abort
-- this migration atomically (--single-transaction) on any incompatible row,
-- rather than backfilling/reclassifying immutable evidence. In this environment
-- (local-only, no real data) this is expected to find zero rows every time; the
-- check exists so a genuinely incompatible row can never be silently inherited.
DO $$
DECLARE incompatible bigint;
BEGIN
  SELECT count(*) INTO incompatible FROM public.jobtread_exports
  WHERE artifact_contract_version IS NOT NULL
    AND manifest->>'outcome' = 'blocked'
    AND status IS DISTINCT FROM public.a1_export_issue_status_class_v1(manifest->'validation'->'issues'->0->>'code');
  IF incompatible > 0 THEN
    RAISE EXCEPTION 'migration 0014: % existing A1 export row(s) are incompatible with the corrected status mapping; immutable evidence may not be backfilled or reclassified', incompatible
      USING ERRCODE = '23514';
  END IF;
END $$;
