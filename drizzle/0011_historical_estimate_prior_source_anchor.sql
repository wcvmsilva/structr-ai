-- M1: a revision chain (prior_import_id + revision) must stay anchored to the
-- same historical_estimate_sources row as the import it revises. hei_prior_fk
-- (tenant/project/client/prior_import_id -> tenant/project/client/id) already
-- anchors tenant/project/client; it does not anchor source_id, so two imports
-- of unrelated historical sources under the same tenant/project/client could
-- be chained together at the database layer even though the application-level
-- check (importHistoricalEstimate) rejects it. This is additive: it stacks a
-- second, narrower FK on top of hei_prior_fk rather than replacing it, so a
-- direct SQL write is bound by the same-source invariant the application now
-- enforces. NULL prior_import_id (no revision claimed) remains unconstrained,
-- matching hei_prior_fk's existing MATCH SIMPLE behavior.
ALTER TABLE historical_estimate_imports
  ADD CONSTRAINT hei_prior_source_fk FOREIGN KEY (tenant_id, prior_import_id, source_id)
  REFERENCES historical_estimate_imports (tenant_id, id, source_id) ON DELETE RESTRICT;
--> statement-breakpoint
