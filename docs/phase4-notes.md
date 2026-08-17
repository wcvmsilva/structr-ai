# Notas internas — baseline observado antes da Fase 4

## Convenções confirmadas (Fases 1–3)

- Motores puros em `shared/*.ts` + taxonomias fechadas em `shared/domain/phaseN-taxonomy.ts`
  com normalizadores idempotentes construídos por `buildLookup` (nunca lançam, desconhecido → null).
- Persistência em `server/*-db.ts` com classe de erro dedicada (`XError` + `code` + `details`),
  `getDb()` que pode retornar null, `logAudit(...).catch(() => undefined)`.
- Transporte em `server/*-router.ts` com `protectedProcedure`, guard obrigatório de
  `./project-access` (`requireProjectAccessTrpc` / `requireEntityAccess`) e mapeamento de
  erro de domínio → `TRPCError`.
- Tenant: `ctx.tenantId` vem de `server/_core/context.ts`; helpers em `server/tenant-scope.ts`
  (`tenantWhere`, `withTenant`, `assertSameTenant`, `isStrictTenantMode`).
- Dinheiro sempre em centavos inteiros (`toCents` / `formatCents` de `actuals-variance-engine`).
- Migrations idempotentes: `CREATE TABLE IF NOT EXISTS`, FKs/checks em `DO $$ ... EXCEPTION WHEN
  duplicate_object THEN NULL; WHEN others THEN RAISE NOTICE`, índices `IF NOT EXISTS`,
  triggers com `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER`. Registrar em `drizzle/meta/_journal.json`.
- Baseline verificada: `pnpm check` limpo, `pnpm test` = 2194 passed / 79 skipped, 48 arquivos.

## Estruturas relevantes já existentes

| Elemento | Observação para a Fase 4 |
|---|---|
| `project_closeouts.variance_report` (jsonb) | Snapshot final imutável; entrada natural do motor de calibração. |
| `project_cost_actuals` | Ledger real por cost code, em centavos, com `change_order_id` separado. |
| `estimate_drafts.line_items` (jsonb) | Escopo aprovado; base do scope completeness. |
| `cost_codes` | Tem `tenant_id` + `uq_cost_codes_tenant_code`. |
| `cost_code_pricing_history` | Onde um ajuste aprovado deve aterrar (não tem tenant_id próprio). |
| `geo_zones` | `min_profit_shield_pct`, modificadores; alvo de `geo_factor_validation`. |
| `calibration_suggestions` (legado Sprint 22) | Sem tenant, sem project; será superseded pela Fase 4, mantida por compatibilidade. |
| `audit_logs` (legado) | Sem tenant/entity_type; a Fase 4 cria `audit_log` canônico e mantém `logAudit` funcionando. |
| `field_tasks` | `planned_*` vs `actual_*` datas → `duration_accuracy`. |
| `subcontractors` | Métricas derivadas para leaderboard. |
| `tenants.settings` (jsonb) | Existe, mas sem estrutura tipada; Fase 4 cria `tenant_settings`. |

## Testes estruturais que precisam continuar verdes

- `server/phase1-route-guard-coverage.test.ts`: todo `*-router.ts` que mencione `projectId`
  (e outros ids escopados) precisa importar o guard de `./project-access`.
- `server/sprint22-learning-layer.test.ts`: assere isolamento determinístico do learning
  layer legado e sua superfície de 16 procedures — não alterar `learning-layer-router.ts`.

## Progresso da Fase 4 (checklist de execução)

- [x] `shared/domain/phase4-taxonomy.ts` — vocabulários fechados + normalizadores + helpers.
- [x] Bloco de schema Fase 4 em `drizzle/schema.ts` (8 tabelas novas + colunas aditivas).
- [x] `drizzle/0004_phase4_learning_multitenant.sql` — idempotente, com FKs, índices,
      checks, 5 triggers de guarda e backfill de `tenant_settings`/`geo_zones`.
- [x] `drizzle/meta/_journal.json` — registrar entrada idx 4.
- [x] Motores puros: `calibration-engine`, `price-adjustment-engine`,
      `scope-completeness-engine`, `analytics-aggregation-engine`, `tenant-provisioning-engine`.
- [x] `server/audit-trail.ts` (canônico) + `server/tenant-settings-db.ts`
      + `server/tenant-coverage-audit.ts` + `scripts/tenant-coverage-audit.ts` (`pnpm audit:tenant`).
- [x] Persistência: `calibration-db`, `price-adjustment-db`, `scope-completeness-db`,
      `analytics-db` (todos com `tenantWhere`, erros tipados e `recordAuditAsync`).

### Detalhes de campo confirmados no baseline (para não reinventar)

- `ProjectVarianceSnapshot.byCostCode` (não `costCodes`); campos `estimatedCents`/`actualCents`.
- `fieldTasks` tem `taskType` (não `trade`), `plannedStartDate/EndDate`, `actualStartDate/EndDate`,
  `assignedSubcontractorId`.
- Margem/floor vivem no `estimateDrafts` aprovado: `grossProfitPct`, `profitShieldFloorPct`,
  `profitShieldMinPct`, `finalTotalPrice`, `subtotalPrice`. `projects` NÃO tem esses campos.
- `projects` tem `geoRiskClass`, `commercialChannel`, `approvedBudgetCents`,
  `changeOrderBudgetCents`, `committedCostCents`, `targetEndDate`, `closedAt`.
- Não existe tabela `changeOrders` exportada no schema — change orders são `estimateDrafts`
  com `changeOrderOf` preenchido.
- `getProjectBudgetLines(projectId)` retorna linhas com flag `fromChangeOrder`.
- Scripts adicionados no package.json: `audit:tenant`, `seed:demo`.
- [ ] Routers: `calibration-router`, `price-adjustment-router`, `tenant-settings-router`,
      `analytics-router`, `audit-trail-router` + registro em `routers.ts`.
- [ ] `server/project-access.ts`: adicionar resolvers `calibrationEvent`, `calibrationReport`,
      `scopeCompleteness`.
- [ ] Seed de tenant demo (`seed-tenant-demo.mjs` ou `server/seed-phase4.ts`).
- [ ] Testes: `phase4-engines.test.ts`, `phase4-learning-flow.test.ts`,
      `phase4-tenant-isolation.test.ts`, `phase4-analytics.test.ts`, `phase4-audit.test.ts`.
- [ ] `docs/phase4-contract.md` + CHANGELOG + zip.

## Resultado inicial do audit MT-004 (fato observado, não opinião)

Primeira execução de `pnpm audit:tenant` sobre o baseline: **11 findings blocking**, todos da
categoria `query` — módulos `*-db.ts` que tocam tabelas com `tenant_id` sem passar por
`tenant-scope.ts`: `assembly-db`, `client-db`, `estimate-version-db`, `field-launch-db`,
`jobtread-export-db`, `lead-db`, `pipeline-db`, `previsit-db`, `scope-db`, `scope-review-db`.

Decisão: **não silenciar**. O audit é a entrega — ele transforma "achamos que somos
multi-tenant" em uma lista nominal de onde o segundo GC leria dados do primeiro. Os 10 módulos
legados entram em `KNOWN_UNSCOPED_MODULES` como `info` (dívida rastreada, contagem que não pode
crescer), e qualquer módulo **novo** que apareça é `block`. `tenant-settings-db.ts` é corrigido
de fato (passa a usar `tenant-scope`), porque é código da Fase 4.

## Nomes de regra fixados (para contrato, código, erro e teste)

| Regra | Significado |
|---|---|
| CL-001 | Tipo de evento de calibração pertence ao vocabulário fechado |
| CL-002 | State machine do evento (open → acknowledged → actioned; dismissed/superseded) |
| CL-003 | Escopo project exige `project_id`; escopo tenant proíbe |
| CL-004 | Confiança = score 0–100 + banda, com mínimo de 3 amostras |
| CL-005 | Idempotência por `(tenant_id, finding_key)` |
| CL-006 | Evento `actioned` só pode ser superseded |
| PA-001 | Cap de ±25% por ajuste e piso de 2% para propor |
| PA-002 | `applied` só a partir de `approved` (aprovação humana obrigatória) |
| PA-003 | State machine do ajuste |
| PA-004 | `applied` exige `rollback_snapshot` |
| PA-005 | No máximo um ajuste `applied` por target por tenant |
| SC4-001 | Score de completude exige estimate aprovado + actuals |
| SC4-002 | Score → veredito (complete/minor/material/systemic) |
| SC4-003 | Padrão recorrente exige ≥2 ocorrências e frequência ≥40% |
| MT-001 | Flags obrigatórias (`profit_shield`, `audit_trail`) não podem ser desligadas |
| MT-002 | Onboarding com passos bloqueantes antes do primeiro ciclo comercial |
| MT-003 | `auto_apply_adjustments` sempre falso |
| MT-004 | Toda query operacional passa por filtro de tenant (audit de cobertura) |
| AU-001 | `entity_type` no vocabulário fechado |
| AU-002 | Trilha append-only; ações de dinheiro exigem before/after |
| AU-003 | Entidade identificada por uuid ou chave de negócio |
