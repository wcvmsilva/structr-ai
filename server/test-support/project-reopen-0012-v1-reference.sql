-- Mandatory reopen-formation provenance for projects. A project may only leave
-- 'cancelled' for any other status when its own provenance_state is exactly
-- 'formation_only' at the end of the SAME statement that attempts the exit — this
-- binds raw/old SQL writers equally with the application, not just the TypeScript
-- STATUS_TRANSITIONS graph (project-db.ts). operational_confirmed is a permanent,
-- conservative BLOCK on reopening -- it is never proof that physical work occurred.
ALTER TABLE public.projects ADD COLUMN provenance_state text NOT NULL DEFAULT 'unknown';
UPDATE public.projects SET provenance_state = 'unknown';
--> statement-breakpoint

-- Parent guard: SECURITY INVOKER (only ever touches its own row inside its own BEFORE
-- trigger -- no cross-table privilege needed). Classifies INSERT from a strict positive
-- set (never trusts a caller-supplied provenance_state); enforces UPDATE permanence and
-- the mandatory cancelled-exit gate against the FINAL computed value.
CREATE FUNCTION public.project_reopen_provenance_guard_v1() RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- The caller's own provenance_state is never consulted: the database alone
    -- decides, from a strict positive set. status='cancelled' at birth is not a
    -- regular creation either -- it is absent from the 4 formation statuses below.
    IF NEW.tenant_id IS NOT NULL
       AND NEW.status IN ('estimate', 'intake', 'estimating', 'review')
       AND NEW.field_started_at IS NULL AND NEW.field_completed_at IS NULL
       AND NEW.closed_at IS NULL AND NEW.actual_total IS NULL
       AND NEW.variance_pct IS NULL AND NEW.start_date IS NULL
       AND NEW.end_date IS NULL AND NEW.approved_budget_cents IS NULL
       AND COALESCE(NEW.committed_cost_cents, 0) = 0
       AND COALESCE(NEW.change_order_budget_cents, 0) = 0
    THEN
      NEW.provenance_state := 'formation_only';
    ELSIF NEW.field_started_at IS NOT NULL OR NEW.field_completed_at IS NOT NULL
       OR NEW.closed_at IS NOT NULL OR NEW.actual_total IS NOT NULL
       OR COALESCE(NEW.committed_cost_cents, 0) > 0
       OR COALESCE(NEW.change_order_budget_cents, 0) > 0
       OR NEW.status IN ('approved', 'in_progress', 'completed', 'closed')
    THEN
      -- A real operational signal is present even though the positive set above
      -- was not fully satisfied -- conservative block, never formation_only.
      NEW.provenance_state := 'operational_confirmed';
    ELSE
      -- Neither cleanly positive nor clearly operational (e.g. tenant_id NULL,
      -- status='cancelled' at birth, or a bare variance/date/budget value with no
      -- other marker): the safe, non-committal default. Never formation_only.
      NEW.provenance_state := 'unknown';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE. operational_confirmed is permanent and always wins first.
  IF OLD.provenance_state = 'operational_confirmed' THEN
    NEW.provenance_state := 'operational_confirmed';
  ELSIF NEW.provenance_state = 'operational_confirmed' THEN
    -- A caller/child-certifier proposing operational_confirmed is always honored:
    -- moving toward the MORE restrictive state can never bypass the mandatory gate,
    -- so accepting it unconditionally is safe by construction.
    NEW.provenance_state := 'operational_confirmed';
  ELSE
    -- Any other caller-proposed value (including an attempted downgrade to
    -- formation_only, or a forged 'unknown') is discarded in favor of OLD's value.
    -- unknown can NEVER become formation_only via UPDATE, under any circumstance.
    NEW.provenance_state := OLD.provenance_state;
  END IF;

  -- Real operational markers newly appearing force operational_confirmed forward,
  -- from EITHER formation_only or unknown -- permanent once forced. Clearing a
  -- marker back to NULL/negative/zero afterward never reverts this (no code path
  -- here ever assigns anything other than operational_confirmed/OLD's own value
  -- once this block has run).
  IF NEW.field_started_at IS NOT NULL AND OLD.field_started_at IS NULL THEN NEW.provenance_state := 'operational_confirmed'; END IF;
  IF NEW.field_completed_at IS NOT NULL AND OLD.field_completed_at IS NULL THEN NEW.provenance_state := 'operational_confirmed'; END IF;
  IF NEW.closed_at IS NOT NULL AND OLD.closed_at IS NULL THEN NEW.provenance_state := 'operational_confirmed'; END IF;
  IF NEW.actual_total IS DISTINCT FROM OLD.actual_total AND NEW.actual_total IS NOT NULL THEN NEW.provenance_state := 'operational_confirmed'; END IF;
  IF NEW.committed_cost_cents IS DISTINCT FROM OLD.committed_cost_cents AND COALESCE(NEW.committed_cost_cents, 0) > 0 THEN NEW.provenance_state := 'operational_confirmed'; END IF;
  IF NEW.change_order_budget_cents IS DISTINCT FROM OLD.change_order_budget_cents AND COALESCE(NEW.change_order_budget_cents, 0) > 0 THEN NEW.provenance_state := 'operational_confirmed'; END IF;
  IF NEW.status IN ('approved', 'in_progress', 'completed', 'closed') THEN NEW.provenance_state := 'operational_confirmed'; END IF;

  -- A formation_only row is invalidated to 'unknown' (never certified, never
  -- re-restorable to formation_only) by: a tenant_id change in EITHER direction
  -- (including NULL<->value), or ANY effective change to variance_pct/start_date/
  -- end_date/approved_budget_cents -- these four are not independently hard
  -- operational markers, but their presence/change disqualifies the strict
  -- positive INSERT set, so a later change must disqualify formation the same way.
  -- Repeating an identical value is a no-op (IS DISTINCT FROM is false for it).
  -- Only evaluated when still formation_only at this point -- an unknown row has
  -- nothing further to invalidate, and operational_confirmed already won above.
  IF NEW.provenance_state = 'formation_only' AND (
       NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
       OR NEW.variance_pct IS DISTINCT FROM OLD.variance_pct
       OR NEW.start_date IS DISTINCT FROM OLD.start_date
       OR NEW.end_date IS DISTINCT FROM OLD.end_date
       OR NEW.approved_budget_cents IS DISTINCT FROM OLD.approved_budget_cents
     )
  THEN
    NEW.provenance_state := 'unknown';
  END IF;

  -- Mandatory gate, evaluated against the FINAL computed value above: any exit
  -- from cancelled (to any destination, not only 'intake') requires EXACTLY
  -- formation_only. A mixed payload whose OTHER fields already invalidated
  -- formation above is refused atomically at this same, first hop.
  IF OLD.status = 'cancelled' AND NEW.status <> 'cancelled' AND NEW.provenance_state <> 'formation_only' THEN
    RAISE EXCEPTION 'Reopen requires verified formation; current provenance_state does not qualify.'
      USING ERRCODE = '23514', CONSTRAINT = 'project_reopen_formation_not_verified';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER trg_reopen_provenance_insert BEFORE INSERT ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.project_reopen_provenance_guard_v1();
--> statement-breakpoint
CREATE TRIGGER trg_reopen_provenance_update BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.project_reopen_provenance_guard_v1();
--> statement-breakpoint

-- Child certifier: SECURITY DEFINER (must write projects.provenance_state from a
-- trigger firing on a DIFFERENT table; the invoking role is never assumed to hold
-- that privilege directly). Owner defaults to whoever applies this migration -- no
-- role is created or switched here. search_path is pinned and every reference is
-- fully schema-qualified so this function cannot be redirected to a same-named
-- object placed earlier on an attacker-controlled search_path.
CREATE FUNCTION public.project_reopen_child_certify_v1() RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_should_certify boolean;
  v_parent_tenant uuid;
BEGIN
  -- IF/ELSIF by table name, never a single CASE expression: a CASE's branches all
  -- resolve field references against the bound record regardless of which WHEN is
  -- selected, so a branch naming a column absent from another table's row type
  -- (e.g. closed_at, which only project_closeouts has) would fail unconditionally
  -- inside a CASE even when never reached. Separate IF/ELSIF statements genuinely
  -- short-circuit per branch in PL/pgSQL.
  IF TG_TABLE_NAME = 'field_tasks' THEN
    v_should_certify := true;
  ELSIF TG_TABLE_NAME = 'project_cost_actuals' THEN
    v_should_certify := true;
  ELSIF TG_TABLE_NAME = 'project_closeouts' THEN
    v_should_certify := (NEW.closed_at IS NOT NULL);
  ELSE
    v_should_certify := false;
  END IF;
  IF NOT v_should_certify THEN RETURN NEW; END IF;

  -- Lock and read the parent distinctly from the tenant check below, so a
  -- not-found parent and a tenant mismatch are two distinguishable failures, not
  -- one conflated condition.
  SELECT tenant_id INTO v_parent_tenant FROM public.projects WHERE id = NEW.project_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Child row references a project that does not exist.'
      USING ERRCODE = '42501', CONSTRAINT = 'project_reopen_child_parent_not_found';
  END IF;
  IF v_parent_tenant IS NULL OR NEW.tenant_id IS DISTINCT FROM v_parent_tenant THEN
    RAISE EXCEPTION 'Child row tenant does not match its parent project tenant.'
      USING ERRCODE = '42501', CONSTRAINT = 'project_reopen_child_tenant_mismatch';
  END IF;

  -- Idempotent, conditional: a row already certified is left alone, avoiding an
  -- unnecessary write/audit-adjacent trigger fan-out on every child touch.
  UPDATE public.projects SET provenance_state = 'operational_confirmed'
    WHERE id = NEW.project_id AND provenance_state <> 'operational_confirmed';
  RETURN NEW;
END;
$$;
--> statement-breakpoint

-- UPDATE OF project_id, tenant_id: a child's OWN tenant_id changing (not only its
-- project_id) must also re-run the tenant-match check -- changing a child's tenant
-- while leaving project_id alone could otherwise silently point it at a tenant
-- mismatch undetected until some later, unrelated update.
CREATE TRIGGER trg_reopen_field_task_certify AFTER INSERT OR UPDATE OF project_id, tenant_id ON public.field_tasks
  FOR EACH ROW EXECUTE FUNCTION public.project_reopen_child_certify_v1();
--> statement-breakpoint
CREATE TRIGGER trg_reopen_cost_actual_certify AFTER INSERT OR UPDATE OF project_id, tenant_id ON public.project_cost_actuals
  FOR EACH ROW EXECUTE FUNCTION public.project_reopen_child_certify_v1();
--> statement-breakpoint
CREATE TRIGGER trg_reopen_closeout_certify AFTER INSERT OR UPDATE OF project_id, tenant_id, closed_at ON public.project_closeouts
  FOR EACH ROW EXECUTE FUNCTION public.project_reopen_child_certify_v1();
