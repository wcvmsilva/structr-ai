# Changelog — Structr AI

Todas as datas abaixo usam o fuso **America/New_York**. A versão corrente corresponde à **Fase 4: Aprendizado Controlado e Produto Replicável**, aplicada sobre as Fases 1–3 (Identidade, Autorização, Estimate, Campo, Actuals e Closeout).

## [Phase 4] — 2026-08-13

### Objetivo

Fechar o ciclo inteligente do Structr AI: **estimate aprovado → actuals → closeout → calibração → proposta → aprovação humana → price book → auditoria**. A fase prepara o produto para múltiplos GCs sem permitir que outro tenant, um outlier de campo ou uma automação reprecifique a empresa sem controle.

> **Regra operacional:** o sistema pode aprender e sugerir; somente uma pessoa identificada pode aprovar e aplicar mudança de preço.

### Added

#### Motores de decisão e contrato

| Módulo | Responsabilidade |
|---|---|
| `shared/domain/phase4-taxonomy.ts` | Vocabulários fechados, limites, máquinas de estado, feature flags, onboarding, audit taxonomy e tipos de snapshot. |
| `shared/calibration-engine.ts` | Viés por mediana, confiança por volume/consistência/dispersão, ajuste amortecido/capped, custo/assembly/duração/geo e relatório de acurácia. |
| `shared/price-adjustment-engine.ts` | Validação PA-001…PA-005, ciclo proposto/aprovado/aplicado, preview financeiro e rollback exato em centavos. |
| `shared/scope-completeness-engine.ts` | Score money-weighted de escopo, crédito de change order e promoção de checklist por recorrência/frequência. |
| `shared/tenant-provisioning-engine.ts` | Flags mandatórias/dependências, pisos Profit Shield por máximo, onboarding bloqueante e plano de provisionamento. |
| `shared/analytics-aggregation-engine.ts` | Pipeline, forecast, saúde de margem, progresso de campo, ranking de subs e dashboard consolidado. |
| `docs/phase4-contract.md` | Contrato técnico e operacional completo da Fase 4. |

#### Persistência, isolamento e auditoria

| Módulo | Responsabilidade |
|---|---|
| `drizzle/0004_phase4_learning_multitenant.sql` | Migration idempotente da Fase 4: learning layer, price adjustments, score/checklist de scope, settings, analytics snapshots, audit trail e triggers de guarda. |
| `server/calibration-db.ts` | Coleta após closeout, persistência idempotente de findings/reports, lifecycle de eventos e validação de pisos geo. |
| `server/price-adjustment-db.ts` | Único caminho ao price book: proposta, aprovação, aplicação transacional, snapshot e rollback verificável. |
| `server/scope-completeness-db.ts` | Score de projeto e memória reutilizável de omissions por tipo de projeto. |
| `server/tenant-settings-db.ts` | Settings por tenant, flags, overrides, onboarding, provisionamento e bloqueio de auto-apply. |
| `server/analytics-db.ts` | Agregações tenant-scoped e snapshots imutáveis de período. |
| `server/audit-trail.ts` | Registro canônico append-only com snapshots antes/depois e diff de campos. |
| `server/tenant-coverage-audit.ts` + `pnpm audit:tenant` | Auditoria executável de cobertura estrutural de tenant. |

#### Routers e acesso

`appRouter` passa a expor os namespaces protegidos `calibration`, `priceAdjustment`, `scopeCompleteness`, `tenantSettings`, `analytics` e `auditTrail`. Os dados tenant-scoped são derivados de `ctx.tenantId`; nenhum desses routers aceita tenant ID vindo do cliente. `project-access.ts` ganhou resolvers para findings/reports/scores project-scoped.

A procedure de escrita do price book é `priceAdjustment.applyToPriceBook`; `apply` não é usado porque é palavra reservada do proxy tRPC v11. Não há endpoint de auto-apply nem de bulk approval.

#### Seed e testes

| Item | Entrega |
|---|---|
| `scripts/seed-demo-tenant.ts` / `pnpm seed:demo` | Fixture idempotente `demo-coastal-gc`, costeira e segura; não cria price book falso, actuals inventados ou onboarding ficticiamente concluído. |
| `server/phase4-engines.test.ts` | 24 casos determinísticos dos engines de calibração, price adjustment, scope completeness e tenant provisioning. |
| `pnpm check` | TypeScript sem emissão para schema, engines, persistence, routers e seed. |
| `pnpm test` | Suíte completa, incluindo a Fase 4. |

### Changed

- `shared/tenant-provisioning-engine.ts` normaliza slug de tenant removendo separadores residuais: `Demo Coastal GC!` passa a `demo-coastal-gc`, não `demo-coastal-gc-`.
- A política geo é assimétrica por decisão: evidência consistente pode sugerir subir um piso costeiro inseguro; nunca reduz automaticamente um piso protetivo por jobs favoráveis.
- O namespace legado `learning` (Sprint 22) permanece montado só para compatibilidade. Desenvolvimento novo usa os namespaces da Fase 4.

### Risco controlado

| Risco | Controle implementado |
|---|---|
| Outlier reprifica o book | Mediana, confiança mínima de três jobs, damping de 60%, ruído <2% e cap ±25%. |
| IA/sistema muda preço sozinho | Caminho obrigatório `proposed → approved → applied`, ator nomeado e auto-apply proibido. |
| Rollback inexato | Snapshot pré-mutação e restauração em centavos, não inversão percentual arredondada. |
| Margem costeira perde proteção | Piso geo somente sobe por evidência; redução não é automática. |
| Scope perdido vira custo absorvido | Score separa custo não planejado de change order capturada e cria checklist recorrente. |
| Vazamento entre GCs | Queries novas usam tenant guard; auditoria MT-004 executável bloqueia regressão estrutural. |
| Histórico financeiro reescrito | `audit_log` append-only com trigger de banco e snapshots de atos financeiros. |

## [Phase 3] — 2026-08-12

### Objetivo

Conectar o estimate aprovado à realidade operacional: **task em campo → responsável → execução → custo real → variância → closeout**. A fase transforma o custo real em dado confiável para gestão e aprendizado, mantendo a trilha de projeto, tenant, aprovação, transição e auditoria. Nenhuma tarefa inicia sem estimate aprovado; nenhum actual entra sem baseline e cost code; nenhum closeout fecha com trabalho aberto, dinheiro pendente ou overrun crítico sem revisão.

> **Regra operacional:** estimate aprovado é a baseline. A mudança de escopo aprovada cria novo trabalho e novo orçamento. O actual aprovado mede a execução. O closeout congela a verdade final do job.

### Added

#### Motores de decisão (puros, sem banco)

| Módulo | Responsabilidade |
|---|---|
| `shared/domain/phase3-taxonomy.ts` | Vocabulários fechados, aliases e máquinas de estado para field tasks, actuals, subcontratados, clima e closeout. Centraliza o limite de bloqueio de task e labels de tipos. |
| `shared/field-operations-engine.ts` | Valida assignment, governa a máquina `pending → assigned → in_progress → completed → verified`, bloqueios, cronograma, progresso e derivação idempotente de field tasks a partir de change orders. |
| `shared/actuals-variance-engine.ts` | Aritmética em centavos inteiros, gate de actual, estados financeiros, variância por cost code, separação baseline/change order, alertas, budget disponível e extração de budget lines. |
| `shared/subcontractor-performance-engine.ts` | Avalia licença/seguro, elegibilidade de assignment, pontualidade, qualidade, rework, variância de custo e rating derivado do subcontratado. |
| `shared/closeout-engine.ts` | Gates de abertura/fechamento, checklist obrigatório, bloqueios de actual/variância e relatório final de custo, margem realizada e maiores overruns. |

#### Persistência, operações e transporte

| Módulo | Responsabilidade |
|---|---|
| `server/field-operations-db.ts` e `server/field-operations-router.ts` | CRUD de task de campo, assignment, transições auditadas, status de cronograma, estatísticas, budget aprovado e materialização idempotente de change order. |
| `server/actuals-db.ts` e `server/actuals-router.ts` | Registro, aprovação, pagamento, rejeição, void e revisão de actuals; variance snapshot, budget, categorias e pendências. |
| `server/subcontractor-db.ts` e `server/subcontractors-router.ts` | Cadastro de trade partner, compliance, elegibilidade, alertas de seguro/licença, performance e arquivo seguro. |
| `server/daily-log-db.ts` e `server/daily-logs-router.ts` | Daily log único por projeto/data, clima, crews, produção, atrasos, entregas, fotos, GPS e incidentes de segurança. |
| `server/closeout-db.ts` e `server/closeout-router.ts` | Abertura, checklist, readiness, preview, fechamento e snapshot imutável do relatório final de variância. |
| `drizzle/0003_phase3_field_actuals.sql` | Migration idempotente da Fase 3, registrada no journal Drizzle. |
| `docs/phase3-contract.md` | Contrato técnico: entidades, estados, invariantes, regras de variance, closeout e integração de change order. |

#### Modelo de dados

| Entidade | Controle operacional |
|---|---|
| `field_tasks` e `field_task_events` | Task vinculada a projeto + estimate aprovado, cost code/assembly/estimate item, assignee, datas planejadas/reais, rework e histórico de estado. |
| `project_cost_actuals` | Custo real vinculado a baseline ou change order, cost code, fornecedor/subcontratado, invoice, receipt, variância snapshot e revisão humana. |
| `subcontractors` | Dados comerciais, trade, licença, seguro, compliance derivado, status e métricas de performance. |
| `daily_logs` | Registro diário único com condições de campo, produção, delay, segurança, fotos e coordenadas. |
| `project_closeouts` | Checklist, gates, valores finais, margem realizada, variance report persistido e responsável de abertura/fechamento. |
| `projects` | Campos derivados de execução: início/conclusão de campo, budget aprovado/change order, committed cost, actual total, variância e fechamento. |

#### Integração de change order

- A aprovação de um estimate que seja **change order** agora materializa automaticamente as field tasks correspondentes. A operação é idempotente por `(project_id, source_key)`; replay não duplica escopo nem budget.
- A recomposição do budget é explícita: baseline aprovada + somatório de change orders aprovadas. Custos vinculados a change order permanecem separados dos custos de baseline nos snapshots e no closeout.
- Se a materialização falhar após uma aprovação válida, a aprovação permanece preservada e é gerado evento de auditoria com remediação para replay seguro. O valor aprovado pelo cliente nunca é revertido por falha de lista de trabalho.

#### Testes e validação

| Suíte | Casos | Cobertura |
|---|---:|---|
| `server/phase3-engines.test.ts` | 130 | Taxonomia, máquinas de estado, assignment, cronograma, progresso, change order → task, centavos, gates de actual, variance, budget, compliance, performance, checklist e relatório final. |
| `pnpm check` | 0 erros | TypeScript sem emissão, incluindo schema, routers, DB layers e integrações. |
| `pnpm test` | 2.194 passando | Suíte completa: 48 arquivos passando; 79 casos pré-existentes marcados como skip. |

### Changed

- `server/project-access.ts` passou a resolver e proteger as entidades operacionais da Fase 3 (`fieldTask`, `costActual`, `dailyLog` e `closeout`) pelo mesmo chokepoint de acesso ao projeto das Fases 1–2.
- `server/routers.ts` expõe cinco domínios protegidos: `fieldOperations`, `actuals`, `subcontractors`, `dailyLogs` e `closeout`.
- `server/estimate-db.ts` passou a disparar a criação de work list quando um change order é aprovado, sem tornar a aprovação dependente do retry operacional da materialização.
- Field task verificada, actual aprovado/pago, closeout ready e closeout closed exigem nível de permissão de aprovação. Ações descritivas e daily logs permanecem no nível de escrita.
- Projeto fechado não recalcula o relatório final por leitura: o snapshot de custo/margem persistido no fechamento é a evidência histórica do job.

### Risco controlado

| Risco de campo | Controle implementado |
|---|---|
| Trabalho iniciado sem cliente aprovar a baseline | `FO-001`: field task exige estimate aprovado resolvido no servidor. |
| Custo real sem classificação reaproveitável | `AC-001`/`AC-002`: actual exige baseline e cost code; valor usa centavos inteiros. |
| Invoice duplicada | Guard de fornecedor + invoice ref por projeto. |
| Sub sem seguro/licença válida em obra | Compliance derivado; documento expirado bloqueia assignment; expiração próxima alerta. |
| Fechamento artificial de job | `CO-001`/`CO-003`: bloqueia task aberta, actual pendente e variância crítica/unbudgeted sem revisão. |
| Change order aprovado sem virar execução | Hook de materialização idempotente com trilha de auditoria e replay seguro. |

## [Phase 2] — 2026-08-12

### Objetivo

Conectar o fluxo operacional completo em uma única cadeia governada: **lead do site → intake → briefing/pré-visita → geo context → Scope Builder → Scope Review → Profit Shield → estimate → geração documental → exportação JobTread**. A Fase 1 tornou o sistema seguro; a Fase 2 torna o sistema *inevitável* — cada etapa só existe a partir da etapa anterior aprovada, e nenhuma decisão comercial pode ser tomada fora do trilho.

A regra estrutural da fase é uma só: **decisão é pura, persistência é transacional**. Todo julgamento (dados mínimos, duplicidade, classe de evidência, piso de margem, reconciliação) vive em módulos puros de `shared/`, sem banco e sem IO, e os módulos de `server/` apenas gravam, transicionam e auditam. Isso permite testar a regra de negócio sem banco e impede que a mesma regra seja reimplementada de forma divergente em dois lugares.

### Added

#### Motores de decisão (puros, sem banco)

| Módulo | Responsabilidade |
|---|---|
| `shared/domain/phase2-taxonomy.ts` | Vocabulários fechados da fase: canal de origem do lead, próximo passo único, tipo de cliente, **canal comercial** (`premium` / `trade` / `capital`), classes de evidência e as seis decisões de pré-visita. Inclui normalizadores idempotentes com aliases e o mapeamento explícito entre canal comercial e o canal de precificação legado. |
| `shared/intake-conversion.ts` | Gate de conversão: valida os quatro dados mínimos, detecta cliente e projeto duplicados e produz **exatamente uma** decisão (`convert`, `reuse_client`, `needs_review`, `blocked_minimum_data`) com trilha de regras. |
| `shared/previsit-engine.ts` | Classificação de evidência (`FACT`, `CLIENT PROVIDED`, `INFERENCE`, `UNKNOWN`), montagem do Pre-Visit Project Brief, derivação do checklist de campo, decisão única de próxima etapa e o guard de linguagem de preço definitivo. |
| `shared/geo-context-warnings.ts` | Normaliza o resultado do geocode/zona em sete códigos estáveis (`geo.geocode_failed`, `geo.coastal_exposure`, `geo.barrier_island_exposure`, entre outros), determinísticos e consumíveis por código, não por texto livre. |
| `shared/profit-shield-engine.ts` | Avalia a margem contra o piso efetivo do canal comercial combinado por máximo com o piso geográfico, separando violações bloqueantes de avisos e emitindo remediação acionável. |
| `shared/jobtread-reconciliation.ts` | Aritmética em centavos inteiros, reconciliação Σ(Quantidade × Preço Unitário) contra o total aprovado, manifest de cost code por linha e a máquina de estados da exportação. |

#### Persistência e transporte

| Módulo | Responsabilidade |
|---|---|
| `server/lead-conversion.ts` | Conversão transacional lead → client → project → intake form, idempotente por lead, com `tenant_id` estampado em toda entidade criada e resolução automática de geo context após o commit. |
| `server/previsit-db.ts` | Persistência do briefing e do checklist, cálculo de readiness a partir das linhas gravadas, captura/dispensa de item de checklist e vínculo do briefing ao scope draft. |
| `server/previsit-router.ts` | Oito procedures de pré-visita (`createBrief`, `getBrief`, `getLatestForProject`, `listForProject`, `captureChecklist`, `completeBrief`, `linkToScope`, `readiness`), todas atrás do guard de acesso a projeto. |
| `server/estimate-version-db.ts` | Versionamento de estimate: `createEstimateVersion`, `createChangeOrder`, `getVersionChain` e `getExportableEstimate`. Único caminho legítimo de alteração após aprovação. |
| `server/jobtread-export-db.ts` | Cadeia de exportação: autorização → validação → reconciliação → download, com registro de **toda** tentativa (inclusive bloqueada) e revalidação de hash no momento do download. |
| `drizzle/0002_phase2_previsit_estimate.sql` | Migration idempotente da fase, registrada em `drizzle/meta/_journal.json`. |
| `docs/phase2-contract.md` | Contrato técnico da fase: entidades canônicas, máquinas de estado, gates, pisos de margem e regras de exportação. |

#### Modelo de dados

| Alteração | Detalhe |
|---|---|
| `previsit_briefs` | Briefing vinculado a `project_id` e `tenant_id`, com itens de evidência, estatísticas (`fact_coverage_pct`, `unknown_count`, `inference_count`), próximo passo único, opções descartadas, warnings geo e a flag `emits_definitive_price` fixada em falso por check constraint. |
| `previsit_checklist_items` | Checklist de campo por briefing, com item obrigatório/opcional, valor capturado, classe de evidência de campo, responsável, motivo de dispensa e unicidade em `(brief_id, item_key)`. |
| `jobtread_exports` | Histórico de exportação com estado, totais em centavos inteiros, diferença, hash do CSV, manifest, motivo de bloqueio e responsável. |
| `leads` | Passou a carregar `source_channel`, `source_detail`, `client_type`, `commercial_channel`, `project_type`, `next_step` (com autor e timestamp), `converted_client_id`, `converted_project_id`, `converted_at`, `conversion_decision` e `conversion_blockers`. |
| `clients` | Ganhou `email_normalized`, `phone_normalized`, `client_type`, `commercial_channel`, `source_channel` e `origin_lead_id`, com índices únicos parciais por tenant para impedir duplicidade de contato. |
| `projects` | Ganhou `address_normalized`, `client_type`, `commercial_channel`, `source_channel`, `geo_warnings`, `geo_risk_class`, `latitude`, `longitude` e `updated_by`. |
| `scope_drafts` | Ganhou `previsit_brief_id`, `geo_warnings`, `geo_risk_class`, além do registro de aprovação/rejeição com responsável, timestamp e motivo. |
| `estimate_drafts` | Ganhou `version`, `supersedes_id`, `superseded_by`, `change_order_of`, `change_order_reason`, `locked_at`, `profit_shield_floor_pct`, `profit_shield_evaluation` e `pricing_snapshot`. |
| `scope_review_snapshots` | Ganhou `decision`, `approved_by` e `delta_count`, para que o snapshot registre quem decidiu e sobre quantos deltas. |
| Guard no banco | Função `structr_guard_approved_estimate` e trigger `trg_guard_approved_estimate` recusam, no nível do PostgreSQL, qualquer alteração de valor comercial em estimate aprovado que não seja transição de status ou marcação de superseded. |

#### Testes

| Suíte | Casos | Cobertura |
|---|---|---|
| `server/phase2-engines.test.ts` | 93 | Taxonomia, conversão, pré-visita, geo warnings, pisos de margem por canal, reconciliação em centavos e máquina de estados da exportação. |
| `server/phase2-flow.test.ts` | 46 | Ciclo lead → client → project, gate de aprovação com Profit Shield, versionamento/change order e gate completo de exportação JobTread. |
| `server/phase2-previsit.test.ts` | 25 | Criação de briefing, derivação e captura de checklist, bloqueio de conclusão, supersessão e vínculo com o scope. |
| `server/phase2-pipeline.test.ts` | 22 | Gate de scope aprovado, gate de pré-visita, Profit Shield por canal e preservação do snapshot de precificação. |

### Changed

#### Lead → Intake → Project

- `lead.convertToProject` deixou de chamar o orquestrador antigo e passou a executar a conversão governada da Fase 2. O caminho anterior permanece disponível como `lead.convertToProjectLegacy` para não quebrar integrações existentes.
- A conversão exige os quatro dados mínimos — **cliente, endereço do site, tipo de projeto e tipo de cliente/canal** — e recusa a gravação quando qualquer um falta. O operador pode completar o que o formulário do site não capturou por meio de `overrides`, sem editar o lead original.
- Cliente existente é **reutilizado**, nunca duplicado: coincidência de e-mail ou telefone normalizado é match confirmado; coincidência apenas de nome + endereço é ambígua e exige revisão humana, porque nome comum em endereço multiunidade é condição real de campo.
- Projeto ativo no mesmo endereço com o mesmo tipo de projeto bloqueia a criação e exige decisão autorizada. Endereço igual com tipo de projeto diferente é liberado como escopo distinto, com aviso.
- Um lead já convertido retorna os identificadores existentes em vez de criar um segundo par cliente/projeto. A conversão é idempotente por lead.
- Adicionadas `lead.planConversion` (avaliação sem escrita, para a UI mostrar bloqueios antes de commitar) e `lead.refreshGeoContext`.

#### Pré-visita

- A pré-visita passou a ser uma etapa de primeira classe do projeto, com dados estruturados vinculados a `project_id`, e não uma anotação livre.
- Todo campo relevante carrega classe de evidência. Item sem valor **degrada para `UNKNOWN`**, nunca para `FACT`; `INFERENCE` exige justificativa explícita e `FACT` exige fonte verificável. Apenas `FACT` é evidência de grau de preço.
- Cada `UNKNOWN` gera item obrigatório de checklist e cada `INFERENCE` gera confirmação obrigatória. `CLIENT PROVIDED` gera validação opcional. Exposição costeira detectada pelo geo context injeta os três itens costeiros de base (vento, cota/zona de inundação, corrosão).
- A visita fecha com **exatamente uma** recomendação entre estimate conceitual, survey/zoneamento, design, avaliação estrutural, preconstruction paga e proposta design-build. Recomendações concorrentes são reduzidas por prioridade *verificação primeiro*: na dúvida entre verificar e precificar, verificar vence, e a opção descartada fica registrada.
- A pré-visita **não emite preço definitivo**. Um guard de linguagem recusa o briefing quando o resumo, a justificativa de um item ou a justificativa da recomendação contêm compromisso de preço fixo. Faixas conceituais continuam permitidas.
- A conclusão do briefing é bloqueada enquanto houver item obrigatório de checklist aberto. Dispensar um item exige motivo, porque dispensar é como o operador assume risco.

#### Geo context

- O geo context deixou de ser passo manual: a conversão do lead resolve geocode e zona automaticamente após o commit e persiste `geo_risk_class` e o conjunto de warnings no projeto.
- Os warnings passaram a ter código estável e são propagados para o Scope Builder, para o checklist da pré-visita e para o Profit Shield. Consumidores comparam código, nunca texto.
- O nível de exposição declarado pela zona tem precedência sobre o nome da zona: exposição `extreme` é tratada como ilha barreira mesmo quando o nome nada indica.
- Falha de geocode e zona não detectada tornam o contexto **não confiável**, o que fica explícito para quem for precificar.

#### Scope Review

- A aprovação e a rejeição passaram a registrar responsável e timestamp; a rejeição exige motivo. O snapshot de review passou a registrar a decisão, o aprovador e a contagem de deltas aplicados.
- `in_review` foi aceito como alias de entrada do estado persistido `under_review`, para alinhar a nomenclatura do contrato sem migrar dados já gravados.
- O vínculo briefing → scope draft propaga a classe de risco geográfico e os warnings para o scope, de modo que o Scope Builder mostre a condição costeira sem consultar o geocode novamente.

#### Estimate e Profit Shield

- O Profit Shield deixou de ser um único alvo global de 35% e passou a aplicar **piso por canal comercial: 28% Premium, 18% Trade e 15% de fee Capital**. O piso geográfico (42% costeiro, 50% ilha barreira) é combinado por **máximo**, de forma que um job Trade na costa continue protegido pelo piso costeiro.
- Canal não resolvido não libera aprovação: cai no piso mais protetivo (28%) e registra violação de canal desconhecido. Margem não finita é tratada como zero, nunca como aprovação.
- O alvo histórico de 35% foi preservado como **aviso** quando o piso aplicável já foi atendido, e margens críticas por assembly continuam avisando sem bloquear o estimate inteiro.
- A aprovação de estimate agora avalia o Profit Shield e **recusa** a aprovação quando a margem viola o piso efetivo, gravando o piso e a avaliação completa na linha.
- Estimate aprovado tornou-se imutável: desconto e edição de itens são recusados na aplicação (`ESTIMATE_VERSION_LOCKED`) e o trigger no banco recusa a alteração mesmo por caminho fora da aplicação.
- Alteração após aprovação passou a ter dois caminhos legítimos e nomeados: **nova versão** (`supersedes_id` / `superseded_by`, reinicia como draft) ou **change order** (`change_order_of`, anexa ao aprovado sem substituí-lo). Ambos exigem motivo substantivo.
- O estimate passou a preservar o snapshot completo de precificação — canal comercial, canal de precificação, nível de acabamento, região, zona, classe de risco geográfico, códigos de warning geo e o briefing de pré-visita que autorizou o trabalho.
- O pipeline scope → estimate ganhou o gate de pré-visita: recomendação de verificação (survey, avaliação estrutural, design) **bloqueia** a geração de preço. Projeto legado sem briefing não é bloqueado retroativamente, mas a ausência fica registrada como aviso no draft.

#### Exportação JobTread

- A exportação passou a exigir estimate aprovado com evidência de aprovação completa. Draft, rejeitado, aprovação sem timestamp e versão superseded não são exportáveis.
- O total exportado deve **igualar** o total aprovado, com tolerância zero, em centavos inteiros. Diferença de um centavo bloqueia o download e nomeia as linhas de maior contribuição para a divergência.
- Ajuste comercial declarado que explique exatamente a diferença não libera o arquivo: encaminha para revisão de exceção, cuja resolução é nova versão ou change order aprovado — edição manual de CSV permanece proibida.
- Toda tentativa é persistida, inclusive as bloqueadas, com estado, totais, diferença e motivo do bloqueio.
- O download revalida o hash do conteúdo contra o estimate no momento do pedido: conteúdo alterado após a autorização derruba o download em vez de entregar um arquivo desatualizado.
- O contrato de nove colunas foi preservado. A governança de cost code vive no **manifest**, não em uma décima coluna, e linhas de fallback por assembly são sinalizadas.

### Validation

| Verificação | Resultado |
|---|---|
| `pnpm check` (TypeScript, `tsc --noEmit`) | Limpo, sem erros. |
| `pnpm test` (Vitest) | **2064 testes passando**, 79 pulados (dependentes de banco real), 47 arquivos de suíte. |
| Testes novos da Fase 2 | 186 casos em quatro suítes. |
| Regressão | Nenhuma suíte da Fase 0/1 foi desativada. Três testes estruturais legados foram atualizados para refletir o novo comportamento governado, e não para contorná-lo. |

### Notas de compatibilidade

- A migration `0002` é idempotente e não destrutiva: usa `IF NOT EXISTS` para tabelas, colunas e índices, e preenche colunas normalizadas (`email_normalized`, `phone_normalized`, `address_normalized`) por backfill.
- Linhas legadas com `tenant_id` nulo continuam visíveis no modo transitório da Fase 1; o isolamento estrito segue controlado por `TENANT_STRICT`.
- `lead.convertToProjectLegacy` mantém o comportamento anterior de conversão para integrações que ainda dependem dele. Recomenda-se migrar para `lead.convertToProject`, que é o caminho governado.

## [Phase 1] — 2026-08-12

### Objetivo

Eliminar os caminhos de autenticação inseguros da Fase 0, introduzir isolamento por tenant, centralizar a autorização por projeto e tornar persistentes as relações críticas do domínio por meio de chaves estrangeiras, índices e restrições de unicidade.

### Added

| Área | Alteração |
|---|---|
| Identidade | Criado `server/identity-db.ts`, com resolução/criação do tenant padrão, lookup de perfil por `external_open_id`, lookup por UUID interno, upsert OAuth idempotente e atualização de último login. |
| Perfis | O modelo `profiles` agora separa `id` (UUID interno) de `external_open_id` (identificador OAuth externo único), com `tenant_id`, e-mail, método de login, status ativo e último login. |
| Tenancy | Criada a entidade `tenants`, o helper `server/tenant-scope.ts` e `tenant_id` nas entidades de negócio principais. O helper oferece `tenantFilter`, `tenantWhere`, `withTenant`, `withTenantAll` e `assertSameTenant`. |
| Acesso a projeto | Criado `server/project-access.ts`, contendo `requireProjectAccess(projectId, userId, permission)`, wrapper tRPC, resolvers de entidades filhas e `requireEntityAccess`. |
| Membros de projeto | Criada `project_members`, com papéis `owner`, `manager`, `estimator`, `field` e `viewer`, permissões explícitas opcionais e unicidade em `(project_id, user_id)`. |
| Migration | Criada `drizzle/0001_phase1_identity_tenant.sql`, idempotente e registrada em `drizzle/meta/_journal.json`. |
| Segurança HTTP | Criado `server/_core/csp.ts` com CSP progressiva: `CSP_MODE=report-only` por padrão em produção e `CSP_MODE=enforce` fora de produção. |
| Testes | Adicionadas quatro suítes da Fase 1: acesso a projeto (24), identidade/sessão (15), tenant/CSP (18) e cobertura estrutural de guards (5). |

### Changed

#### Identidade e sessão

- `getUserByOpenId` agora consulta corretamente `profiles.external_open_id` e retorna um perfil funcional.
- O callback OAuth passou a criar/atualizar o perfil antes de emitir a sessão.
- O contexto de requisição passou a expor `tenantId` e renovação deslizante da sessão.
- O bypass com `dev-secret-key` só é aceito quando **as duas** condições são verdadeiras: `NODE_ENV === "development"` e `JWT_SECRET === "dev-secret-key"`.
- O bootstrap recusa iniciar fora de desenvolvimento com `dev-secret-key` e exige JWT de pelo menos 32 caracteres em ambientes não-dev.
- A duração padrão do cookie foi reduzida de um ano para **7 dias**, com renovação por atividade dentro da janela de refresh.
- O cookie agora usa `HttpOnly`, `SameSite=Lax` por padrão e `Secure` quando a requisição chega por HTTPS. `SameSite=None` é bloqueado em produção e o TTL só pode ser reduzido por variável de ambiente, nunca ampliado acima de 7 dias.

#### Autorização e isolamento

- O guard falha fechado: ausência de banco, perfil inexistente/inativo, projeto inexistente ou tenant divergente não liberam acesso.
- O guard devolve `403 FORBIDDEN` para ausência de autorização e `404 NOT_FOUND` para projeto/entidade inexistente.
- A decisão de acesso segue esta ordem: administrador da plataforma, owner do projeto, membro ativo com papel/permissão, RBAC do mesmo tenant; qualquer outro caso é negado.
- Guards foram aplicados aos routers de projetos, drawings, scope sources, RFI, scopes, intake, estimates, geografia, field launch, remodel, workflow, deals, learning layer e fluxo legado de estimates.
- O `estimate-legacy-router` deixou de gravar o UUID de projeto placeholder (`00000000-...`) e agora exige `projectId` explícito, autorizado pelo guard.
- A tela **Bundles** passou a exigir que o operador escolha um projeto acessível antes de converter o bundle em Estimate Draft. O projeto não é inferido de bundle, pois bundles são reutilizáveis e não possuem escopo de projeto próprio.
- As queries de projetos, intake e estimates foram atualizadas para aceitar/aplicar escopo de tenant onde aplicável. O modo transitório admite linhas legadas com `tenant_id IS NULL`; `TENANT_STRICT=true` ativa isolamento estrito após backfill.

#### Integridade de dados

- Adicionadas FKs, índices de relacionamento/status/tenant e constraints únicas nas relações de negócio críticas, incluindo `project_id`, `lead_id`, `deal_id`, `scope_draft_id`, `assembly_id` e `cost_code_id`.
- Em validação PostgreSQL real da migration limpa, foram materializadas **81 chaves estrangeiras**, **184 índices** e **8 constraints únicas** da Fase 1.
- A migration cria e backfill do tenant padrão `gchi` (`GC Home Improvement LLC`) e associa membros owners existentes a seus projetos quando possível.
- Detectado e corrigido um gap anterior: `project_drawings`, `drawing_revision_snapshots`, `scope_sources` e `rfi_candidates` existiam em `drizzle/schema.ts`, mas não eram criadas por nenhuma migration. As quatro tabelas foram incluídas antes das FKs que dependem delas.

### Security

- CSP não é mais desabilitada globalmente. A política bloqueia `object-src`, restringe `frame-ancestors`, controla fontes de scripts/conexões/imagens e preserva explicitamente apenas as exceções necessárias para Vite em desenvolvimento e PDF/canvas/S3.
- Configurado `trust proxy` no Express para que a detecção de HTTPS e os cookies `Secure` funcionem corretamente atrás de proxy/load balancer.
- HSTS e `Referrer-Policy: strict-origin-when-cross-origin` são aplicados em produção.

### Validation

| Verificação | Resultado |
|---|---:|
| `pnpm check` (`tsc --noEmit`) | Aprovado |
| `pnpm test` | **43 arquivos aprovados**, 1 ignorado |
| Testes | **1.878 aprovados**, 79 ignorados |
| Migration PostgreSQL 16 (baseline → sync → Phase 1) | Aprovada |
| Segunda execução da migration (idempotência) | Aprovada |
| Unique de `external_open_id` | Duplicata rejeitada |
| FKs de `project_members` e `scope_drafts` | Órfãos rejeitados |
| `RESTRICT` em tenant com dependentes | Exclusão bloqueada |
| `CASCADE` projeto → `project_members` | Validado |

### Deployment notes

1. Aplique as migrations em ordem: `0000_strong_jean_grey.sql`, `sync-new-columns.sql` e `0001_phase1_identity_tenant.sql`.
2. Em produção, mantenha `JWT_SECRET` forte, não use `dev-secret-key`, e inicie com `CSP_MODE=report-only`. Após revisar relatórios de CSP, altere para `CSP_MODE=enforce`.
3. Valide os dados antigos e, somente após backfill completo, habilite `TENANT_STRICT=true`.
4. Não aumente `SESSION_TTL_DAYS` acima de 7; a aplicação aplica esse teto por segurança.

---

> A Fase 1 prioriza autorização verificável, isolamento progressivo e migração segura de dados existentes. As regras de tenant e acesso foram desenhadas para falhar fechado, protegendo informações de projetos, estimativas e documentos de campo.
