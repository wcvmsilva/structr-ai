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
    -- committed_cost_cents/change_order_budget_cents must be LITERALLY 0, NOT NULL:
    -- `= 0` (not COALESCE(..., 0) = 0) so a NULL value evaluates the whole AND chain
    -- to NULL/false and is correctly refused, never silently treated as zero.
    IF NEW.tenant_id IS NOT NULL
       AND NEW.status IN ('estimate', 'intake', 'estimating', 'review')
       AND NEW.field_started_at IS NULL AND NEW.field_completed_at IS NULL
       AND NEW.closed_at IS NULL AND NEW.actual_total IS NULL
       AND NEW.variance_pct IS NULL AND NEW.start_date IS NULL
       AND NEW.end_date IS NULL AND NEW.approved_budget_cents IS NULL
       AND NEW.committed_cost_cents = 0
       AND NEW.change_order_budget_cents = 0
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
      -- status='cancelled' at birth, a NULL/negative cost with nothing else
      -- operational, or a bare variance/date/budget value): the safe, non-committal
      -- default. Never formation_only.
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
  -- (including NULL<->value); ANY effective change to variance_pct/start_date/
  -- end_date/approved_budget_cents (not independently hard operational markers, but
  -- their presence/change disqualifies the strict positive INSERT set, so a later
  -- change must disqualify formation the same way); OR committed_cost_cents/
  -- change_order_budget_cents changing to anything OTHER than a genuine positive
  -- increase (NULL, negative, or simply a different non-positive value) -- a
  -- positive increase was already handled above and wins (operational_confirmed),
  -- so this branch, guarded by provenance_state still being 'formation_only', only
  -- ever fires for the NULL/negative/non-positive-change case the P1 finding named:
  -- going to NULL or negative must invalidate, not silently preserve formation, and
  -- restoring the original value afterward does not undo the invalidation (unknown
  -- can never become formation_only again). Repeating an identical value is a
  -- no-op (IS DISTINCT FROM is false for it). Only evaluated when still
  -- formation_only at this point -- an unknown row has nothing further to
  -- invalidate, and operational_confirmed already won above.
  IF NEW.provenance_state = 'formation_only' AND (
       NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
       OR NEW.variance_pct IS DISTINCT FROM OLD.variance_pct
       OR NEW.start_date IS DISTINCT FROM OLD.start_date
       OR NEW.end_date IS DISTINCT FROM OLD.end_date
       OR NEW.approved_budget_cents IS DISTINCT FROM OLD.approved_budget_cents
       OR NEW.committed_cost_cents IS DISTINCT FROM OLD.committed_cost_cents
       OR NEW.change_order_budget_cents IS DISTINCT FROM OLD.change_order_budget_cents
     )
  THEN
    NEW.provenance_state := 'unknown';
  END IF;

  -- Mandatory gate, evaluated against the FINAL computed value above: any exit
  -- from cancelled (to any destination, not only 'intake') requires EXACTLY
  -- formation_only. A mixed payload whose OTHER fields already invalidated
  -- formation above is refused atomically at this same, first hop.
  IF OLD.status = 'cancelled' AND NEW.status <> 'cancelled' AND NEW.provenance_state <> 'formation_only' THEN
    -- USING TABLE is set explicitly: unlike a real constraint violation (which Postgres
    -- populates automatically from context), a custom RAISE EXCEPTION leaves table_name
    -- NULL unless told. The application's mapper (server/project-db.ts) keys on
    -- code+constraint_name+table_name together specifically so a coincidentally-identical
    -- tuple from an unrelated table (e.g. a future constraint on audit_logs) can never be
    -- misidentified as this refusal.
    RAISE EXCEPTION 'Reopen requires verified formation; current provenance_state does not qualify.'
      USING ERRCODE = '23514', CONSTRAINT = 'project_reopen_formation_not_verified', TABLE = 'projects';
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
  -- TG_RELID, not TG_TABLE_NAME: a bare name match would treat ANY relation named
  -- e.g. 'field_tasks' (a same-named temp table, or one in another schema, with this
  -- same function attached to its own trigger) as if it were the real
  -- public.field_tasks. Comparing TG_RELID against the specific, schema-qualified
  -- OID of each of the 3 real tables authenticates the actual invoking relation, not
  -- just its name. IF/ELSIF by relation, never a single CASE expression: a CASE's
  -- branches all resolve field references against the bound record regardless of
  -- which WHEN is selected, so a branch naming a column absent from another table's
  -- row type (e.g. closed_at, which only project_closeouts has) would fail
  -- unconditionally inside a CASE even when never reached. Separate IF/ELSIF
  -- statements genuinely short-circuit per branch in PL/pgSQL.
  IF TG_RELID = 'public.field_tasks'::regclass THEN
    v_should_certify := true;
  ELSIF TG_RELID = 'public.project_cost_actuals'::regclass THEN
    v_should_certify := true;
  ELSIF TG_RELID = 'public.project_closeouts'::regclass THEN
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

-- Precondition (item 5): the function's OWNER -- whoever's role ran the CREATE
-- FUNCTION above, since no OWNER TO is set and no role is created here -- must
-- itself already hold the exact privilege the DEFINER body needs. SECURITY DEFINER
-- changes WHOSE privilege is checked, never grants one; without this, the first
-- real child INSERT would fail with a bare "permission denied for table projects"
-- deep inside an AFTER trigger. Verified and failed HERE, atomically with the rest
-- of this migration, rather than discovered later at the first real write.
--
-- The owner lookup identifies the function by OID via a schema-qualified,
-- zero-argument regprocedure cast, not by a bare `proname` match: `proname` alone
-- can return more than one row from pg_proc the moment a same-named function
-- exists anywhere else (another schema, or an overload with different arguments),
-- which turns a scalar subquery into a runtime error and aborts an otherwise-valid
-- installation. `'public.project_reopen_child_certify_v1()'::regprocedure` resolves
-- to exactly the one function this migration just created -- a homonym placed in
-- any other schema never matches and cannot interfere.
DO $$
DECLARE
  v_owner regrole := (SELECT proowner FROM pg_proc
    WHERE oid = 'public.project_reopen_child_certify_v1()'::regprocedure);
BEGIN
  IF NOT has_table_privilege(v_owner, 'public.projects', 'SELECT')
     OR NOT has_column_privilege(v_owner, 'public.projects', 'provenance_state', 'UPDATE')
  THEN
    RAISE EXCEPTION 'project_reopen_child_certify_v1''s owner lacks SELECT/UPDATE(provenance_state) on public.projects; this migration refuses to install a certifier that would fail on its first real write.'
      USING ERRCODE = '42501', CONSTRAINT = 'project_reopen_definer_privilege_insufficient';
  END IF;
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
