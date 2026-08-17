# Fase 3 — Contrato técnico: migrar campo e criar actuals reais

Este documento fixa o contrato executável da **Fase 3** do Structr AI, conforme o
Dossiê-Mestre GCHI (§5, Fase 3 e §3.5), o Parecer de Skills (P1
`gchi-field-operations-actuals` e `gchi-closeout-package`) e as skills P0
`gchi-tenant-identity-access` e `gchi-jobtread-integration-contract`. Ele descreve o que
acontece **depois** do estimate aprovado: execução em campo, custo real, subcontratados,
diário de obra, change order em produção e closeout com variância final.

A regra estrutural da Fase 2 permanece válida e é reaplicada aqui: **decisão é pura,
persistência é transacional**. Todo julgamento (transição de estado, cálculo de variância,
alerta de threshold, prontidão de closeout, performance de subcontratado) vive em módulos
puros de `shared/`; os módulos de `server/` apenas gravam, transicionam e auditam.

## 1. Objetivo e critério de sucesso

O objetivo é operacional: o custo real da obra tem de aterrar no **mesmo `project_id` e na
mesma versão de estimate aprovada** que originou o job, classificado por cost code, para
que a comparação previsto × realizado seja um fato do sistema e não uma planilha paralela.

| Critério | Meta de aceite |
|---|---:|
| Field task criada sem estimate aprovado no projeto | 0 casos |
| Actual gravado sem estimate aprovado (base de orçamento) | 0 casos |
| Actual sem `project_id`, cost code e data de incorrência | 0 casos |
| Actual de change order somado ao baseline original | 0 casos |
| Closeout iniciado com field task aberta | 0 casos |
| Rota operacional de campo sem guard de projeto | 0 rotas |
| Variância calculada em ponto flutuante como evidência | 0 casos |

## 2. Cadeia canônica de entidades da fase

Toda entidade carrega `tenant_id` e `project_id`. A ligação com dinheiro aprovado é
explícita: `budget_estimate_draft_id` aponta para o estimate aprovado ativo, e
`change_order_id` separa o que é escopo original do que é escopo adicional.

| Etapa | Entidade | Chaves obrigatórias | Regra de integridade |
|---|---|---|---|
| Execução | `field_tasks` | `tenant_id`, `project_id`, `task_type`, `status` | Só nasce com estimate aprovado no projeto; transições pela state machine (`FO-001`). |
| Custo real | `project_cost_actuals` | `tenant_id`, `project_id`, `amount_cents`, `date_incurred`, `status` | Exige base de orçamento aprovada e cost code resolvido (`AC-001`, `AC-002`). |
| Fornecedor | `subcontractors` | `tenant_id`, `name`, `trade` | Único por `(tenant_id, name_normalized, trade)`; seguro/licença com vencimento monitorado. |
| Diário | `daily_logs` | `tenant_id`, `project_id`, `log_date` | Um log por projeto por dia (`uq_daily_logs_project_date`). |
| Encerramento | `project_closeouts` | `tenant_id`, `project_id` | Um closeout ativo por projeto; abertura bloqueada por task aberta (`CO-001`). |

Nenhuma dessas entidades recalcula preço. Elas registram execução e custo; o preço
aprovado continua sendo propriedade exclusiva do estimate versionado.

## 3. Field Operations — tipos e state machine

O tipo da task usa vocabulário fechado (`shared/domain/phase3-taxonomy.ts`), alinhado às
trades já existentes no núcleo, mais os tipos de execução que não são trade
(`inspection`, `cleanup`, `punch_list`, `mobilization`, `material_delivery`, `closeout`).

```
pending ──▶ assigned ──▶ in_progress ──▶ completed ──▶ verified
   │            │             │              │
   └────────────┴─────────────┴──────────────┴──▶ blocked ──▶ (retomada)
   └────────────┴─────────────┴──────────────┴──▶ cancelled (terminal)
```

| Transição | Precondição executável | Bloqueio |
|---|---|---|
| `pending → assigned` | `assignee_type` e identidade do responsável presentes | `FO-002`: atribuir sem responsável é rejeitado |
| `assigned → in_progress` | Data real de início (`actual_start_date`) preenchida ou gerada | `FO-003`: início sem data quebra o cálculo de prazo |
| `in_progress → completed` | Data real de conclusão presente | `FO-003` |
| `completed → verified` | Verificador distinto de sistema, com permissão `approve` | `FO-004`: verificação é gate de qualidade, exige aprovação |
| qualquer → `blocked` | Motivo obrigatório | `FO-005` |
| `verified → *` | Nenhuma | `FO-006`: task verificada é terminal positiva |
| `cancelled → *` | Nenhuma | `FO-006` |

Uma task **não pode ser criada** em projeto que não tenha estimate aprovado ativo: campo
sem orçamento aprovado é execução sem preço, exatamente o que a Fase 2 passou a proibir.
Tasks originadas de change order carregam `change_order_id` e `source = "change_order"`.

## 4. Actuals — vínculo, status e alerta de variância

Um actual é um custo incorrido. Ele é sempre ligado a projeto, à base de orçamento
aprovada e a um cost code; opcionalmente a `field_task`, `estimate_item`, assembly,
subcontratado e change order. Valores monetários são **inteiros em centavos**, seguindo o
mesmo princípio da reconciliação JobTread: ponto flutuante binário não é evidência.

| Campo | Papel |
|---|---|
| `budget_estimate_draft_id` | Estimate aprovado que serve de baseline; obrigatório |
| `change_order_id` | Quando presente, o custo pertence ao escopo adicional, não ao baseline |
| `cost_code_id` / `cost_code` | Classificação de custo; snapshot textual preservado |
| `amount_cents` | Custo real em centavos inteiros, ≥ 0 |
| `estimated_amount_cents` | Snapshot do previsto correspondente, quando conhecido |
| `date_incurred` | Data do fato gerador (fatura, nota, folha) |
| `status` | `pending → approved → paid`, com `rejected` e `void` como saídas |
| `vendor_name` / `subcontractor_id` | Quem cobrou |
| `invoice_ref` | Referência da fatura; único por `(tenant, vendor, invoice_ref)` quando informado |

```
pending ──▶ approved ──▶ paid
   │            │
   └──▶ rejected (terminal)   └──▶ void (terminal)
```

Somente `approved` e `paid` são considerados **custo comprometido** para variância; um
actual `pending` aparece como pipeline de custo, e `rejected`/`void` nunca entram no total.

### Variância

A variância é calculada em centavos e reportada por cost code e por projeto:

```
variance_cents = actual_cents − estimated_cents
variance_pct   = variance_cents / estimated_cents × 100     (estimated_cents > 0)
```

Quando `estimated_cents = 0` e `actual_cents > 0`, o resultado é `unbudgeted`: custo sem
previsão. Isso não é tratado como “variância infinita”; é uma categoria própria, porque a
ação do operador é diferente — não é estouro de linha, é linha que não existia.

| Severidade | Condição (threshold default 10%) | Ação |
|---|---|---|
| `ok` | `variance_pct ≤ threshold` | Nenhuma |
| `warning` | `threshold < variance_pct ≤ 2 × threshold` | Alerta no snapshot e no audit log |
| `critical` | `variance_pct > 2 × threshold` | Alerta crítico; revisão obrigatória antes do closeout |
| `unbudgeted` | Custo real sem previsto | Exige cost code previsto ou change order |
| `under_budget` | `variance_pct ≤ −threshold` | Sinal de economia; entra no relatório, não bloqueia |

O threshold é configurável por projeto/tenant (`variance_threshold_pct`), com default
**10%**. O baseline de comparação é o estimate aprovado ativo **mais** os change orders
aprovados — e o snapshot mantém as duas colunas separadas, para que ninguém financie um
estouro do escopo original com o orçamento do change order.

## 5. Subcontractor Management

O subcontratado é entidade de tenant (não de projeto), porque ele atravessa projetos. O
que pertence ao projeto é a atribuição em `field_tasks` e o custo em actuals.

| Campo | Regra |
|---|---|
| `trade` | Vocabulário fechado de trades |
| `license_number`, `license_expiry` | Vencimento gera alerta com antecedência configurável (default 30 dias) |
| `insurance_carrier`, `insurance_expiry`, `insurance_coverage_cents` | Idem; seguro vencido é bloqueio de atribuição em ambiente estrito |
| `rating` | 0–5, informado pelo operador |
| `on_time_pct`, `quality_score`, `cost_variance_avg_pct` | **Derivados**, recalculados a partir de tasks e actuals; nunca digitados |
| `status` | `active`, `probation`, `suspended`, `archived` |

A performance é computada por um motor puro: pontualidade vem da comparação entre
`planned_end_date` e `actual_end_date` das tasks concluídas; qualidade vem da taxa de
verificação sem retrabalho e de incidentes registrados; a variância média de custo vem dos
actuals aprovados do subcontratado. Um subcontratado com seguro vencido é `blocked` para
novas atribuições, independentemente do rating.

## 6. Daily Log

Um registro por projeto por dia, com unique constraint no banco. Campos: clima, condição
do clima, contagem de crew, trabalho executado, problemas/atrasos, contagem de fotos,
incidentes de segurança e horas perdidas. Um log com incidente de segurança sem descrição
é rejeitado, e um log com incidente aberto entra como bloqueio informativo no closeout.

## 7. Change Order → campo

Quando um change order é aprovado (Fase 2 já cria a linha `estimate_drafts` com
`source = "change_order"` e `change_order_of`), a Fase 3 o materializa em campo:

1. As linhas do change order geram `field_tasks` com `source = "change_order"`,
   `change_order_id` preenchido e tipo derivado do cost code/descrição da linha.
2. O budget disponível do projeto é recomposto: `baseline (estimate aprovado) +
   Σ change orders aprovados`.
3. Os actuals do change order são rastreados separadamente e nunca somados ao baseline
   original nos relatórios de variância.

A geração é idempotente por `(change_order_id, task_key)`: reprocessar um change order
aprovado não duplica tasks.

## 8. Closeout

O closeout é o encerramento formal e o gate do relatório de variância final.

| Item do checklist | Natureza |
|---|---|
| `final_inspection_passed` | Booleano com data e responsável |
| `punch_list_complete` | Booleano; derivado das tasks `punch_list` |
| `lien_waivers_collected` | Booleano por subcontratado pago |
| `final_payment_received` | Booleano com valor recebido |
| `warranty_docs_delivered` | Booleano com referência de documento |
| `client_satisfaction_score` | 0–10, informado |

```
blocked ──▶ open ──▶ in_progress ──▶ ready_to_close ──▶ closed
```

| Gate | Regra |
|---|---|
| Abertura | Toda field task do projeto precisa estar `completed`, `verified` ou `cancelled` (`CO-001`) |
| `ready_to_close` | Checklist obrigatório completo (`CO-002`) |
| `closed` | Actuals `pending` zerados e variância crítica revisada (`CO-003`); exige permissão `approve` |

O relatório final de variância é gerado a partir dos actuals comprometidos, agregado por
cost code, com totais separados de baseline e change order, e é persistido no closeout
como snapshot — não recalculado a cada leitura.

## 9. Matriz de bloqueios executáveis

| Bloqueio | Regra | Erro esperado |
|---|---|---|
| Criar field task sem estimate aprovado | `FO-001` | `NO_APPROVED_ESTIMATE` |
| Atribuir task sem responsável | `FO-002` | `INVALID_ASSIGNMENT` |
| Transição de estado não permitida | `FO-006` | `INVALID_TASK_TRANSITION` |
| Bloquear task sem motivo | `FO-005` | `BLOCK_REASON_REQUIRED` |
| Actual sem estimate aprovado | `AC-001` | `NO_APPROVED_ESTIMATE` |
| Actual sem cost code | `AC-002` | `COST_CODE_REQUIRED` |
| Actual com valor negativo | `AC-003` | `INVALID_AMOUNT` |
| Transição de actual inválida | `AC-004` | `INVALID_ACTUAL_TRANSITION` |
| Segundo daily log no mesmo dia | `DL-001` | `DAILY_LOG_EXISTS` |
| Atribuir sub com seguro vencido (modo estrito) | `SC-002` | `SUBCONTRACTOR_NOT_ELIGIBLE` |
| Abrir closeout com task aberta | `CO-001` | `CLOSEOUT_BLOCKED_OPEN_TASKS` |
| Fechar com checklist incompleto | `CO-002` | `CLOSEOUT_CHECKLIST_INCOMPLETE` |
| Fechar com actual pendente | `CO-003` | `CLOSEOUT_PENDING_ACTUALS` |

## 10. Superfície de código da Fase 3

| Camada | Arquivo | Responsabilidade |
|---|---|---|
| Taxonomia | `shared/domain/phase3-taxonomy.ts` | Tipos de task, estados, status de actual, severidade de variância, papéis de assignee, status de sub e de closeout |
| Motor puro | `shared/field-operations-engine.ts` | State machine de task, validação de atribuição, prazo, derivação de tasks de change order |
| Motor puro | `shared/actuals-variance-engine.ts` | Aritmética em centavos, variância por cost code e por projeto, threshold e alertas |
| Motor puro | `shared/subcontractor-performance-engine.ts` | On-time, qualidade, variância média, elegibilidade e alertas de vencimento |
| Motor puro | `shared/closeout-engine.ts` | Prontidão, checklist, gates e montagem do relatório final |
| Persistência | `server/field-operations-db.ts` | CRUD e transições de task, geração a partir de change order |
| Persistência | `server/actuals-db.ts` | Registro/transição de actual, snapshot de variância, budget do projeto |
| Persistência | `server/subcontractor-db.ts` | Cadastro, métricas derivadas e alertas de compliance |
| Persistência | `server/closeout-db.ts` | Abertura, checklist, transições e snapshot final |
| API | `server/field-operations-router.ts` | Field tasks, daily logs e prontidão de campo |
| API | `server/actuals-router.ts` | Actuals, variância e budget |
| API | `server/subcontractor-router.ts` | Subcontratados, performance e compliance |
| API | `server/closeout-router.ts` | Closeout e relatório final |
| Schema | `drizzle/0003_phase3_field_actuals.sql` | Tabelas, FKs, índices e constraints, idempotente |

## Referências

[1]: file:///home/ubuntu/upload/dossie-mestre.md "Dossiê-Mestre GCHI — Fase 3, GC Clock e loop de actuals"
[2]: file:///home/ubuntu/upload/parecer-skills-gchi.md "Parecer de Skills GCHI — P1 field operations, closeout e riscos de actuals"
[3]: file:///home/ubuntu/skills-p0/gchi-tenant-identity-access/SKILL.md "GCHI Tenant, Identity & Access v1.0.0"
[4]: file:///home/ubuntu/work/docs/phase2-contract.md "Fase 2 — contrato técnico: pré-visita até estimate"
