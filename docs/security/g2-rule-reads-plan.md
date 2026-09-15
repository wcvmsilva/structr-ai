# G2 — plano executável de listagens e agregados

Data15/09/2026. Base4534bec201fa22629a4a104b24c039f42faff265. Autorização humana: “Okay! Autorizado” após a entrega do recorte candidato. Branch isolada codex/g2-rule-reads-20260915. Nenhuma nova numeração de unidade. Preservar todos os encerramentos anteriores, G2 aberta e PR9 NO-GO.

## Claim e contratos fixados antes do patch

Lista e contagem de geographic_overrides exigem o tenant confiável e só retornam/contam suas regras; B e tenant NULL são excluídos mesmo para admin e independentemente de TENANT_STRICT. Todas as sete chamadas da lista e a do aggregate passam autoridade explícita. Não há assinatura de compatibilidade tenant-less, inferência de tenant do pai ou default GCHI.

- listOverrideRules(tenantId: string, opts?: {zoneId?: string;zone?: string;trade?: string;activeOnly?: boolean}): Promise<GeographicOverride[]>.
- getOverrideCountsByZoneId(tenantId: string) e alias getOverrideCountsByZone com contrato idêntico; retorno {zoneId:string|null,count:number}[] com count real convertido pelo driver para number.
- Exigir tenant não vazio antes de obter DB, usando a validação já existente. WHERE tenant_id=owner obrigatório; sem braço NULL. Lista ordenada por overrideType como hoje. Contagem mantém active=true, groupBy(zoneId), ordem count decrescente; zoneId NULL pertencente a regra A é grupo legítimo.
- activeOnly ausente/true filtra atividade;false inclui inativas de A. zoneId interno mantém sua semântica existente, sem novo input público.
- zone/trade públicos, hoje ignorados, passam a igualdade AND, sem wildcard/ILIKE. zone é texto exato, não zoneId, sem trim novo. trade na rota usa normalizeTrade(input.trade) ?? input.trade, como create/update. Campo presente vazio filtra igualdade com vazio; não amplia para todos por truthiness. Campo ausente não filtra.
- Ausência de DB, getDb throw ou rejeição assíncrona de query: erro interno com mensagem constante e sem causa/SQL original, não lista vazia. A consulta deve ser aguardada dentro do try. Tenant inválido permanece recusa antes da aquisição. Lista vazia legítima continua[] quando consulta própria não encontra linhas.

## Arquivos e limite

Produção somente5arquivos: server/geo-override-db.ts, geo-override-router.ts, remodel-router.ts, workflow-visualization-router.ts, seed.ts.

Rotas listRules/statsByZone/resolveForDraft/previewForDraft, remodel.generateWorkflow e workflowViz.loadVisualization usam tenantProcedure. SeedAPI já adminTenantProcedure, permanece. Preservar os guards de pai e usar ctx.tenantId, não projeto.tenantId. server/seed.ts passa seedTenantId já resolvido da configuração existente à descoberta.

Sem mudança de CRUD, log helpers, algoritmos de engines, UUID/input/cliente da visualização, placeholders/atomicidade/audit do seed, outras etapas de bootstrap, schema, migrations, env, packages ou CI. Nenhuma execução de seed operacional real. Falha da descoberta interrompe a fase de override, não desfaz etapas anteriores do bootstrap. Uma descoberta agora restrita pode expor falha preexistente de placeholders antes ocultada por skip influenciado por B; não prometer seed funcional.

Testes novos: server/tenant-g2-rule-reads-postgres.test.ts (root) e server/tenant-g2-rule-read-callers.test.ts (autor delegado; arquivo adicional de seed se isolamento de imports exigir, registrado antes de escrever). Ajuste permitido de fixture/expectativa histórica em server/tenant-g2-1-seed-context.test.ts, com nota HISTORY para chamada de descoberta agora tenant-aware; somente após baseline. Outros testes existentes não serão alterados sem medir necessidade. Reusar server/test-support/g2-1-postgres.ts sem editar; DDL real derivado de schema, semFK/RLSexternos. Sem criar migração.

Atualização medida depois do baseline e RED: também foi necessário adaptar a expectativa de descoberta de seed em server/tenant-g2-1-override-crud.test.ts. As duas mudanças mantêm os controles de criação e recebem nota HISTORY. Nenhum arquivo extra de seed foi necessário.

## Sequência e prova

1. Recuperar estado, hashes, remotos, fontes; baseline de tipos/suíte antes de alterar produção/testes existentes.
2. Escrever provas comportamentais; RED pela API tRPC estável de lista/stats e consumidores, não erro de assinatura. Helpers candidatos diretos identificados separadamente. Banco PostgreSQL descartável próprio, socket privado/TCPdesligado, dados sintéticos; nenhumSupabase.
3. Root só implementa após RED esperado. Testes PG guardam consultas reais e snapshots antes/depois; A/B/NULL, active, filtros, count driver, contexto ausente/admin, DBindisponível/rejeição e payload sem autoridade. Doubles apenas para dependências comerciais fora do claim; não implementar tenantfilter nofakecomo prova deisolamento.
4. Consumidores: guards e contexto de sete callers; resultados reais de preview/resolve persistLog:false e remodel onde aplicável; visualização/seed medidos só na fronteira adaptada. Não certificar workflows inteiros. Teste da entrada operacional só com todos colaboradores de seed substituídos; zero seed real.
5. GREEN focal/PG, tipos aplicação e tipos de testes (tsconfigpadrãoexcluitestes), suíte e medição tenant. Revisões interna/independente; manifesto e relatório delimitado. Sem publicação/merge/deploy; eventual consolidação local depende do resultado revisado e autorização de transição pertinente.

## Comandos fixados

Prefixo comum: env -i PATH=/usr/local/bin:/usr/bin:/bin NODE_ENV=test CI=1.

- pnpm check --incremental false
- pnpm test --pool=forks --maxWorkers=4 --minWorkers=1
- pnpm exec vitest run server/tenant-g2-rule-read-callers.test.ts server/tenant-g2-1-override-crud.test.ts server/tenant-g2-1-seed-context.test.ts --pool=forks --maxWorkers=1 --minWorkers=1
- Com G2_RULE_READS_POSTGRES=1 e G2_1_POSTGRES=1: pnpm exec vitest run server/tenant-g2-rule-reads-postgres.test.ts --pool=forks --maxWorkers=1 --minWorkers=1. Harness existente exige a flagG2_1; somente arquivo novo é selecionado.
- Regressão PG já existente, se necessária pela alteração do mesmo módulo: G2_1_POSTGRES=1 pnpm exec vitest run server/tenant-g2-1-override-crud-postgres.test.ts --pool=forks --maxWorkers=1 --minWorkers=1.
- pnpm exec tsc --project .superpowers/sdd/g2-rule-reads/test-tsconfig.json (testes novos/alterados e helper existentes,exclude=[],incrementalfalse).
- node --import tsx scripts/tenant-coverage-audit.ts, mesmo auditor publicado; invocador tsx IPC indisponível previamente, alternativa declarada. Zero exit não é segurança GO.

Registros em .superpowers/sdd/g2-rule-reads/. Não alterar registros anteriores. Ausência de objeto main8fa não será reparada comfetch. Não instalar dependências. TDD aplicável, sem60testes artificiais nem fechos globais de F2/F5.

## Matriz de impacto

IDs e nomes conferidos no registro canônico main8fa, blob b9e144e5b25b0c9dcfbcc0790b12931bc78713b2. Esta entrega não promove dimensão/status. A mudança é de leitura de regras, não do contrato inteiro de engines/logs/pipeline.

Os IDs, impactos e contratos foram registrados antes do patch (versão preservada por hash no manifesto RED); o detalhamento por arquivo, evidência e revisor nas seis colunas abaixo foi completado depois do GREEN. Isso não é uma alegação retroativa de formulário completo antes da implementação. Nenhuma capacidade foi adicionada nesta expansão documental. Caminhos relativos à raiz, resultados no relatório g2-rule-reads-evidence.md.

| Capacidade | Impacto | Mudança/claim | Arquivos e consumidores | Aceitação/evidência | Revisor e disposição |
|---|---|---|---|---|---|
| P-07 Platform reference data (geo override) | Direto | Lista/agregado estritos; nome não torna regras globais | server/geo-override-db.ts e sete callers | PG A/B/NULL, atividade e grupos corretos | lead_profile_scope_review: revisto tecnicamente |
| P-03 Tenancy and tenant scoping | Direto | Tenant obrigatório independente de TENANT_STRICT | Dois readers e server/seed.ts | Dois modos, ausente/admin, payload sem autoridade | lead_profile_scope_review: revisto tecnicamente |
| P-02 Authorization and RBAC | Direto | Seis boundaries tenant-aware; guards preservados | geo-override-router.ts, remodel-router.ts, workflow-visualization-router.ts | Gates antes de DB e pais B/NULL com guards reais | lead_profile_scope_review: revisto tecnicamente |
| P-06 Data access layer | Direto | Filtros AND, COUNT numérico, erros seguros | server/geo-override-db.ts | PG real, falha aquisição/consulta, vazio legítimo, snapshots | lead_profile_scope_review: revisto tecnicamente |
| C-19 Remodel modeling | Direto delimitado | Regras próprias fornecidas ao engine | server/remodel-router.ts → shared/remodel-engine.ts | PG+engine real, assembly e rulesEvaluated corretos | lead_profile_scope_review: revisto tecnicamente |
| C-38 Workflow visualization | Direto delimitado | Contexto explícito | server/workflow-visualization-router.ts → client/src/pages/Workflow.tsx | Callers reais; limite numérico/UUID preservado | lead_profile_scope_review: revisto só boundary |
| C-11 Scope review | Indireto | Preview usa regras próprias | geo-override-router.ts → client/src/pages/Review.tsx | PG preview; apresentação de erro pendente | field_readiness_audit: limitação identificada |
| P-05 Audit and audit trail | Indireto | Stats corretas no evento existente de resolução | geo-override-router.ts → server/audit.ts | Sink controlado; falha impede sucesso posterior | lead_profile_scope_review: revisto, sem durabilidade nova |
| C-16 Catalog and assembly library | Dependência indireta | Lookup/referências preservados | server/assembly-db.ts → callers e engines | Diff/inspeção; catálogo substituído no laboratório | lead_profile_scope_review: sem claim G4/FK |
| C-13 Scope model and structure | Dependência indireta | Drafts/items e semântica dos pais preservados | server/scope-db.ts, scope-review-db.ts → callers | Fixtures delimitam prova de regras | lead_profile_scope_review: sem fecho do domínio |
| C-07 Project formation | Dependência indireta | Guard/projeto preservados; pai NULL não reclassificado | project-access.ts, project-db.ts → callers | Guards reais; contexto A conservado com pai NULL | lead_profile_scope_review: revisto dentro recorte |
| P-09 Evidence and provenance substrate | Indireto limitado | Não repara histórico nem prova substrato completo | geo-override-router.ts → scope_override_log | Somente stats/ausência de sucesso após falha | lead_profile_scope_review: sem promoção |
| C-14 Estimating | Efeito indireto posterior | Logs podem influenciar etapas seguintes | scope_override_log → server/scope-to-estimate-pipeline.ts:549 → assemblySelections.overrideFlag | Sem alteração de engine/preço; pipeline não revalidado | field_readiness_audit: fora da prova dinâmica |
| P-08 Draft recovery | Efeito indireto potencial | Estado do estimate é uma dependência posterior; não há leitor direto novo de logs | estimate-db.ts → estimate-router/draft-recovery-db.ts | Nenhum reparo de histórico/recuperação nem prova de propagação ponta a ponta | field_readiness_audit: fora da implementação |
| P-10 Export and transmission | Efeito indireto condicional | Ponte de campos/export preservada | estimate-db.ts → estimate-router/jobtread-export-db.ts | Não reivindicar validação do caminho até export | field_readiness_audit: fora da implementação |

Limitação C-11: client/src/pages/Review.tsx ignora error do preview e pode apresentar ausência de overrides quando a API falha. O claim de erro sem falso vazio vale somente para helpers/API; não certifica a experiência do operador. Reparar a UI constitui outro recorte.

Revisão pré-patch independente confirmou estes contratos e não identificou nova decisão de ownership. RED PostgreSQL selecionará somente casos nomeados same-api; testes diretos da assinatura candidata serão executados no GREEN e não contarão como contraste de segurança no baseline.
