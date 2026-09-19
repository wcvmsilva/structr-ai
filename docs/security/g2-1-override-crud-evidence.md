# G2-1 — evidências do ciclo CRUD de regras geográficas

**Código implementado e verificado localmente; aceite humano do resultado ainda não registrado.** Este registro cobre criar, consultar por ID, editar, desativar e reativar regras do próprio tenant, com duas adaptações de contexto dos callers de criação. Não fecha a família G2, não autoriza publicação e não altera o NO-GO da PR #9 ou o B2 global NOT DEFENSIBLE.

## Identificação e autorização

| Campo | Observação |
|---|---|
| Repositório | `wcvmsilva/structr-ai`, remoto `https://github.com/wcvmsilva/structr-ai.git` |
| Fonte de código/provas revisada | `1459a559e849ccd01a5c06da9be224d0e3af4ba2` |
| Base/parent exato | `bf9fbb6bd917ceb207d7bf01ad77704e48ca8b2a` |
| Branch local | `codex/g2-1-override-crud-20260915`, sem upstream/publicação |
| Worktree candidata | `/private/tmp/structr-g2-1-20260915` |
| Baseline | `/private/tmp/structr-g2-1-baseline-20260915`, detached na base, quatro provas explícitas não rastreadas; produção intacta |
| Dossiê local | `/private/tmp/structr-g2-1-evidence-20260915` |
| Autor da integração/evidência | Codex `/root`, 2026-09-15; horários UTC de cada comando nos arquivos JSON |
| Verificação exata | [exact-sha-verification.json](/private/tmp/structr-g2-1-evidence-20260915/exact-sha-verification.json): sete comandos, árvore limpa antes/depois, arquivos idênticos aos blobs do commit |
| Âncora pré-commit documental | Código `1459a559`; hashes dos quatro documentos serão registrados no manifesto documental externo antes do commit |
| SHA documental resultante | Não existe na redação deste registro. Será identificado após o commit no delivery record externo; não é o SHA de código ensaiado |

A resposta humana “Autorizado” posterior à entrega do desenho aprovou sua execução em ambiente isolado, TDD, testes locais, PostgreSQL descartável próprio e commits locais de código e documentação. [authorization.json](/private/tmp/structr-g2-1-evidence-20260915/authorization.json) vincula os três originais aprovados pelos hashes abaixo. A aprovação de execução não é aceite do resultado no novo SHA, autorização de push/merge ou abertura da próxima unidade.

| Documento incorporado | SHA-256 do original aprovado |
|---|---|
| [Decisão de política](g2-1/2026-09-15-g2-policy-decision.md) | `8fb68231f760fa1c6d378029842287917eb28db1c01c414ac20b91290a85c5d6` |
| [Desenho](g2-1/2026-09-15-g2-1-design.md) | `349826de9ef02f9f597d9ccd6602c6e893c18bdbb1c53b0828bb93de13b70596` |
| [Plano](g2-1/2026-09-15-g2-1-implementation-plan.md) | `0677e9a62cf080b0b057859d57f70894ebb7c57ac342c3ecc265622e1bf3b414` |

Os originais permanecem em `/private/tmp/structr-g2-design-20260915/`, sem alteração. As cópias incorporadas acrescentam um aviso histórico e resolvem links externos; o [manifesto de incorporação](/private/tmp/structr-g2-1-documentary-draft-20260915/incorporation-manifest.json) lista cada alteração. “Não executado” e checkboxes abertos nesses documentos são o estado histórico do desenho; esta evidência registra a execução posterior. A [revisão independente do desenho](/private/tmp/structr-g2-design-20260915/independent-design-review.md), SHA-256 `dc4113850204738de86f291f12b229f8f3d48bfd9fa8796e48f4de93b09571bc`, foi DESIGN-READY, sem BLOCKER/REQUIRED; não foi GO de código.

## Autoridade e estado recuperado

- `AGENTS.md`, ADR-001 e evidência do fechamento G3a-3 na base `bf9fbb6`. O workflow publicado corrige a referência histórica a MySQL e a aplicação literal de protectedProcedure: esta unidade usa PostgreSQL e os tenant/adminTenantProcedure existentes.
- Controlled Engineering Workflow, Security Gate, decision-correction-log e current-state lidos em `f60cf9a56679d4d7083b2c11ac4e2727d53d84c3`. O snapshot antigo não reabre Task 6, F5b, G3a-2 ou G3a-3. Task 6 está formalmente fechada; a publicação documental das PRs #12 e #13 está concluída e não autorizou implementação de segurança por si só.
- Registro canônico e manutenção de evidências consultados na main `8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf`, pelos blobs GitHub `b9e144e5b25b0c9dcfbcc0790b12931bc78713b2` e `6455caef19bbabb293ffd9104c67a5b73f487988`. As respostas exatas estão em `/private/tmp/structr-g3a3-sha-review-20260915/{canonical-product-github-response,feature-maintenance-github-response}.json`. Nenhum desses documentos foi copiado entre linhagens ou teve status promovido.
- [authority-manifest.json](/private/tmp/structr-g2-1-evidence-20260915/authority-manifest.json) guarda paths, SHAs e hashes; desenho/plano/decisão humana delimitam o recorte atual e prevalecem sobre estados históricos superados.

Leitura direta do remoto em **2026-09-15 14:56 UTC**, sem fetch/pull: main `8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf`; workflow `f60cf9a56679d4d7083b2c11ac4e2727d53d84c3`; security `b95ea0bf4741646f418fcc99a22d22a42d24be51`; G3a-3 `29c464931184de02556926fed4486ab93024185f`; branch G2-1 ausente no remoto. [Registro](/private/tmp/structr-g2-1-evidence-20260915/sha-remote-state.json).

A PR #9 permanece OPEN, não draft, sem mergedAt, head security/b95; a consulta informa base main/`233569d68c014712ce3d25326bda8823aab1987e`, diferente da main remota observada. **O objeto de commit main `8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf` falta localmente**; não houve fetch nem recuperação automática. Essa divergência permanece na integração final; não substitui a base explicitamente aprovada `bf9fbb6` para esta unidade isolada. A base contém o fechamento documental local de G3a-3, ainda não publicado, com código idêntico a `29c4649`.

O checkout principal em `/Users/wsilva/Desktop/structr-ai` foi preservado em main local `233569d`; as alterações documentais alheias da worktree task5 também foram preservadas. Ref de acompanhamento local não foi usada como observação remota atual.

## Mudança observável e fronteira

Antes, a criação podia gerar tenant NULL e os quatro pontos por ID podiam consultar ou alterar regras de outra empresa/NULL. Agora create carimba o tenant confiável e o ciclo próprio completo permanece disponível; os quatro pontos exigem igualdade tenant+ID, inclusive para administrador e com TENANT_STRICT ligado ou desligado.

| Superfície | Resultado implementado |
|---|---|
| Cinco helpers existentes | Tenant obrigatório, rejeição de contexto inválido antes de adquirir DB, UUID normalizado, sem fallback de assinatura antiga |
| getRule | tenantProcedure, somente row própria, inclusive inativa; B/NULL/ausente resultam NOT_FOUND |
| Create/update/deactivate/reactivate | adminTenantProcedure; tenant de ctx; nenhuma elevação do admin sobre ownership |
| Create | Whitelist literal, owner confiável, INSERT/RETURNING/readback no mesmo tx, audit aguardado após commit |
| Update/toggles | SELECT estrito com FOR UPDATE, before real, UPDATE com tenant+ID e RETURNING, readback confirmado no mesmo tx; falha de verificação desfaz o write |
| Mapper e payload | active→isActive, false/null/aliases preservados; owner/id/timestamps e undefined excluídos; patch vazio próprio retorna sem write/audit; patch vazio alheio indisponível |
| Audit | Ações existentes e before/after confirmados; recordId UUID real, userId:null e operatorId legado; negação/rollback sem sucesso auditado |
| Dois callers adicionais de create | seedCoastalRules usa adminTenantProcedure e ctx.tenantId; bootstrap passa seedTenantId já existente |

O audit é **pós-commit do negócio**: retorno NULL do sink deixa a auditoria não confirmada e preserva a resposta do negócio; throw inesperado pode escapar depois da gravação. Não há outbox, garantia de audit durável ou transação conjunta dado+audit.

Arquivos de produção alterados: `server/geo-override-db.ts`, `server/geo-override-router.ts`, `server/seed.ts`. A busca das cinco assinaturas encontrou todos os callers de produção nesses arquivos; create tem três callers, todos adaptados. Não houve alteração de schema, engine, UI, pipeline, guard compartilhado, serviço de audit, package/lock, configuração ou scanner.

Quatro arquivos criados: `server/tenant-g2-1-override-crud.test.ts`, `server/tenant-g2-1-seed-context.test.ts`, `server/tenant-g2-1-override-crud-postgres.test.ts`, `server/test-support/g2-1-postgres.ts`. Novas tabelas: zero; novos endpoints: zero; funções de engine novas: zero. Privados DB novos: pickDefined, requireOverrideTenant, overrideRuleWhere, loadRuleInTenant, changeRuleInTenant e classe de verificação; cinco helpers públicos existentes evoluídos.

## Ambiente, TDD e evidência executada

Node v24.14.0, pnpm 10.15.1, Vitest 2.1.9, PostgreSQL 17.11 Homebrew. Dependências instaladas previamente foram reutilizadas por symlink; nada instalado. O runner externo usa allowlist de ambiente, CI=1, NODE_ENV=test e GIT_OPTIONAL_LOCKS=0, sem URLs operacionais ou variáveis PG herdadas. No comando PG acrescenta somente as flags da prova e do trace.

PG usa cluster e Unix socket privados em `/private/tmp/structr-g2point-pg-*`, TCP desligado, verificação de PID/data-dir e encerramento das conexões/processo. A fixture deriva colunas/tipos/defaults/PK/NOT NULL do schema real de geographic_overrides; omite FKs externos, índices e RLS. Callers/helpers reais; substituições limitadas à aquisição da conexão, contexto externo e sink de audit. Observer independente compara estado completo; traces preservam SQL, parâmetros, resultados, before/after e audit. Isso não comprova referências de assemblies, RLS ou ambiente operacional.

As provas normais substituem helpers de negócio e verificam middleware/mapper/contexto; não são prova SQL. O teste de bootstrap importa a entrada real com todos os colaboradores de efeito substituídos, aguarda a conclusão e restaura mocks. Ele não executa seed operacional nem certifica seu funcionamento completo.

| Rodada | Resultado real e interpretação |
|---|---|
| Base bf9, check/regressão | 0 erros; 2.833 passaram / 152 pulados, produção original |
| RED PG inicial, mesma API | 17 falhas tenant/stamp esperadas + 4 controles ausente passaram; ciclo antigo chegou ao fim antes da asserção de owner NULL |
| RED PG completo, mesma API | 35 falhas = 17 segurança + 18 compatibilidade/transação/audit; 6 controles passaram; 9 casos de nova assinatura excluídos |
| RED normal | 27 falhas de boundary/mapper/contexto/compatibilidade + 7 controles; não 27 provas de isolamento SQL |
| GREEN antes do commit | 34 normais + 50 PG, tipos e regressão passaram; hashes estáveis vinculados ao commit posterior |

As quatro provas sobrepostas na baseline são idênticas às provas candidatas; não foi copiada implementação candidata para a base. Nove casos diretos de helpers são candidate-only (5 contexto + 4 payloads): sua assinatura nova impede tratá-los como reprodução da mesma API antiga. Saídas em `red-pg-tenant.*`, `red-pg-same-api.*`, `red-normal.*`; observações/classificação em `initial-contrast-summary.json` e `red-pg-*-observations.json` no dossiê.

| Comando no código exato 1459a559 | Resultado | Registro no dossiê |
|---|---|---|
| pnpm check | 0 erros, exit 0 | sha-check.* |
| pnpm exec vitest run server/tenant-g2-1-override-crud.test.ts server/tenant-g2-1-seed-context.test.ts | 34/34 passaram | sha-normal.* |
| pnpm exec tsc --project /private/tmp/structr-g2-1-evidence-20260915/proof-types-all.json | 0 erros, todos os quatro arquivos de prova/suporte incluídos | sha-proof-types.* |
| pnpm test | 2.867 passaram / 202 pulados | sha-regression.* |
| pnpm exec vitest run server/tenant-g2-1-override-crud-postgres.test.ts, G2_1_POSTGRES=1 e G2_1_TRACE=1 no ambiente | 50/50 passaram | sha-pg.* |
| pnpm audit:tenant | exit 0; 44 warnings, 6 known gaps, iguais à base | sha-scanner.* |
| GIT_OPTIONAL_LOCKS=0 git diff --check bf9fbb6bd917ceb207d7bf01ad77704e48ca8b2a HEAD | exit 0 | sha-diff-check.* |

Cada `*.json` guarda argv/cwd/SHA/UTC/exit/ambiente e hashes antes/depois; `*.stdout` e `*.stderr` são completos. O runner `run.py` tem SHA-256 `222aa4bf0a7b7626a0f32afae56fb9d58c59349e2a5406d4b70b200bc9913871`. A config de tipos externa usa noEmit, incremental=false, exclude vazio, typeRoots explícitos e ES2022; tsconfig global não foi alterado. As primeiras tentativas de configuração/resolução de tipos falharam e foram preservadas; não foram contadas como RED de segurança. O scanner inicial encontrou EPERM no IPC local do sandbox; a mesma medição autorizada foi repetida com sucesso, sem mudar a ferramenta.

**84 casos novos previstos e coletados: 34 normais + 50 PG, todos passaram. Total único executado: 2.917 passaram, sem regressão observada.** Os 202 pulados da suíte normal incluem os 50 PG novos executados separadamente e 152 casos herdados não executados. Esses 152 são: 73 provas PG de unidades anteriores sem seus opt-ins; 40 testes que exigem DATABASE_URL; 39 casos explicitamente suspensos no código histórico (migração/pendências). Nenhum skip histórico foi alterado. [Disposição detalhada](/private/tmp/structr-g2-1-evidence-20260915/skips-and-warning-disposition.md).

Avisos OAuth sem configuração e de mock ensureProfileExists permanecem nos testes antigos; nenhuma nova linha de mensagem iniciada por colchetes foi observada em comparação com a base. Stderr das provas focais novas é vazio. Não declarar saída global limpa ou todos os testes do repositório executados. Scanner exit 0 é medição, não evidência de segurança fora do recorte.

## Matriz dos critérios de aceitação

| Critério aprovado | Prova / contraste e disposição |
|---|---|
| Acessar somente regra própria, admin incluído, strict on/off | 16 pares get/update/toggles × B/NULL × flags: base expõe/altera, candidato nega sem audit/mudança; controles de ID ausente passam |
| Criar A e preservar o ciclo completo, inclusive inativo | Roundtrip real create/get/update/deactivate/reactivate; base cria NULL, candidato A, ambos executam o ciclo para comparação |
| Contexto obrigatório, papel e identidade do chamador | 17 casos sem usuário/tenant/papel adequado, 6 de contexto nas rotas, 1 bootstrap; 5 helpers candidate-only verificam antes de DB |
| Dados protegidos e compatibilidade dos inputs | 4 PG de payload forjado persistem A; 6 normais active/null/aliases/whitelist; uppercase tem 2 controles; patch vazio próprio/alheio tem 2 PG |
| Write verificado atomicamente | 3 UPDATEs suprimidos, 6 readbacks sabotados após create/update, 2 erros SQL; snapshots/SQL provam execução e rollback, sem sucesso auditado |
| Audit aguardado após commit | 4 NULL e 1 throw no sink, observer independente e barreira assíncrona; estado committed, payload/ordem observados, durabilidade não provada |
| Mesmo resultado de indisponibilidade | 4 normais NOT_FOUND; PG controla B/NULL/ausente; diagnósticos sem DB preservados, sem claim de disponibilidade |
| Nenhuma regressão ou expansão | Tipos normais e das provas, regressão executada, revisão completa dos sete arquivos; 152 skips herdados e caminhos adjacentes explicitamente excluídos |

## Impacto nas capacidades publicadas

IDs/nomes da main8fa; a matriz acompanha o procedimento publicado, sem alterar registro canônico. “Aceito no recorte” significa evidência de código local e limitação reconhecida, não promoção de implementação, validação operacional, segurança global, confiança, verificação, lifecycle ou roadmap da capacidade. Linhas não modificadas mantêm suas âncoras históricas; não se declara o conjunto de 48 capacidades CURRENT.

Revisores nomeados: **Q = Codex `/root/g2_proof_review`**, qualidade interna; **I = Codex `/root/g3a2_independent_sha_gate`**, gate independente, ambos distintos dos autores desta implementação. Os relatórios vinculados abaixo registram o alcance e a disposição, sem atribuir validação funcional nova aos consumidores excluídos.

| Capability ID / nome | Impacto e mudança/limite | Arquivos e consumidores | Critério/evidência | Revisor/disposição |
|---|---|---|---|---|
| P-07 Platform reference data (geo override) | Direto: cinco CRUD estritos; seed parcial | geo-override-db/router, server/seed | Roundtrip A, 16 B/NULL, todos callers create | Q/I: recorte/evidência aceitos |
| P-03 Tenancy and tenant scoping | Direto: owner confiável, sem NULL/admin bypass | Cinco helpers, tenant/adminTenantProcedure | Contexto, ambos strict; guard global intacto | Q/I: recorte/evidência aceitos |
| P-02 Authorization and RBAC | Direto nas seis rotas tocadas | geo-override-router | Auth/tenant/role distintos; admin B/NULL negado | Q/I: recorte/evidência aceitos |
| P-06 Data access layer | Direto: tx/predicate/RETURNING/readback | CRUD, DB/tx, schema-fonte | Estado/SQL/rollback; FKs/RLS excluídos | Q/I: recorte/evidência aceitos |
| P-05 Audit and audit trail | Direto nos emissores | CRUD → audit.ts inalterado | before/after/ordem; NULL/throw, sem durabilidade | Q/I: recorte/evidência aceitos |
| P-09 Evidence and provenance substrate | Indireto: owner/snapshots; sem substrato completo | Rows/audit/seed contexto | Legado sem reatribuição; classificação insuficiente preservada | Q: escopo conferido; I: recorte/evidência aceitos; sem promoção |
| C-16 Catalog and assembly library | Dependência: IDs continuam sem prova de ownership | Referências create/update | UUID sintético válido; nenhum claim G4/existência | Q: escopo conferido; I: recorte/evidência aceitos |
| C-19 Remodel modeling | Indireto: regras mutáveis influenciam resolução | listOverrideRules → remodel | Engine inalterado; leitura global ainda aberta | Q: escopo conferido; I: recorte/evidência aceitos |
| C-38 Workflow visualization | Indireto; contrato UUID excluído | list/log → workflowViz/client | Sem ativação/correção UI; influência potencial registrada | Q: escopo conferido; I: recorte/evidência aceitos |
| C-11 Scope review | Indireto via preview/log | Review.tsx, previewForDraft | Aprovação/delta intactos, reader ainda aberto | Q: escopo conferido; I: recorte/evidência aceitos |
| C-13 Scope model and structure | Dependência da família, excluída | scope-db/draft/items | Sem stamp/semântica nova de pai; F15 não fechado | Q: escopo conferido; I: recorte/evidência aceitos |
| C-07 Project formation | Dependência da família, excluída | project-access | Sem mudança de autorização project NULL/formação | Q: escopo conferido; I: recorte/evidência aceitos |
| C-14 Estimating | Indireto via logs, excluído | pipeline → draftData | Sem reaplicação/repricing ou ponte de flags inventada | Q: escopo conferido; I: recorte/evidência aceitos |
| P-08 Draft recovery | Consumidor de log, excluído | estimate.retryPartialDraft | Retry/autoridade do partial não alterados | Q: escopo conferido; I: recorte/evidência aceitos |
| P-10 Export and transmission | Condicional da família, excluído | export/UI/assemblySelections | Ponte draftData ausente continua aberta | Q: escopo conferido; I: recorte/evidência aceitos |

C-05 sem nova política geo; C-15 sem repricing; C-10/C-33 sem alteração de geração/baseline; C-18/C-30/C-32/C-35 não recebem impacto automático pelo homônimo geoOverrides em settings. Nenhuma feature foi promovida a operacional ou segura globalmente.

## Revisões, gates e achados

Autoria: produção por `/root/g3a3_implementation_design`; provas por `/root/g2_normal_proofs` e `/root/g2_pg_proofs`; execução/integração por `/root`. Revisores não editaram a implementação ou a evidência avaliada. Na revisão preliminar da prova, um REQUIRED de cleanup da barreira assíncrona foi corrigido pelo autor e reavaliado; [revisão da correção](/private/tmp/structr-g2-1-evidence-20260915/task-1-proof-rereview.md) deixou zero pendências. A revisão final de qualidade cobriu o commit completo.

| Camada | Disposição no código 1459a559 / evidência |
|---|---|
| 1 — Estado vivo | PASS no limite local autorizado; branch/SHA/base/limpeza conferidos; remoto/PR reconfirmados pelo independente até 15:08:19 UTC, divergência de integração preservada |
| 2 — Recuperação | PASS; autoridades e decisão reconciliadas, sem reabrir unidades encerradas |
| 3 — Escopo | PASS; sete arquivos e cinco CRUD, contexto parcial de seed; matriz de 15 capacidades conferida sem promoção |
| 4 — Técnica | PASS nos sete comandos exatos; 84 casos novos, 2.917 únicos passaram; 152 herdados não executados |
| 5 — Medição estática | PASS como medição; 44 warnings/6 gaps preservados; nenhum GO derivado de exit 0 |
| 6 — Evidência de segurança | PASS no claim delimitado; contraste da mesma API, controles e candidate-only separados; sem claim global/live |
| 7 — Qualidade interna Superpowers | PASS; [internal-quality-review.md](/private/tmp/structr-g2-1-evidence-20260915/internal-quality-review.md), zero BLOCKER/REQUIRED |
| 8 — Codex independente | PASS; [independent-security-gate.md](/private/tmp/structr-g2-1-evidence-20260915/independent-security-gate.md), zero BLOCKER/REQUIRED, cinco NOTE preservados |
| 9 — Aceite humano do resultado/transição | Pendente; aprovação anterior autorizou executar e fazer commits locais, não atestou o resultado neste SHA |

O gate independente de Codex `/root/g3a2_independent_sha_gate` concluiu Layers 1–8 PASS, com GO estreito para apresentar o resultado ao aceite humano e continuar a etapa documental já autorizada. Releu fonte/callers, todas as 50 traces PG candidatas e 41 da base, hashes e estado local/remoto. A matriz de 15 capacidades foi aceita apenas quanto ao impacto/exclusão e evidência de G2-1; não certifica consumidores intocados. Âncoras SHA-256 dos pareceres: interno `68ac689f7fb752fdb3d04580c786b76dc79a9611c259e27e6627ca5a4e59dedd`; independente `b33436c0121af0dd4b95533d5b72d9f48d4c753a1b8d4809a89f041ac14a8b57`. As cinco NOTE são: exposição restante da família, seed parcial, limites de audit/DB, skips/gaps históricos e integração/publicação pendente.

Notas preservadas: listagem global pode revelar uma regra negada por get; seed só recebeu contexto; FK/RLS/live e durabilidade de audit não demonstrados; escritores concorrentes arbitrários/triggers diferidos não provados; 152 skips e avisos históricos permanecem. Não há waiver de REQUIRED ou transferência de GO de outras unidades. O futuro commit documental exige conferência própria; o resultado de código acima não é reatribuído automaticamente a esse novo SHA.

## Pendências separadas e limite de entrega

**Dentro deste recorte:** nenhum BLOCKER/REQUIRED remanescente nas revisões de código no SHA 1459a559; o aceite da entrega ainda está pendente. As cinco operações foram implementadas e as duas adaptações de callers verificadas no seu limite. Aceite humano do resultado e publicação permanecem decisões distintas.

**Outras unidades de G2:** listagem/aggregate e sete callers, resolvers/remodel/viz; logs e autoridade de draft/projeto; UUIDs de visualização/seed; discovery/skip globais, placeholders, audit agregado `"0"` e atomicidade do lote/etapas do bootstrap; ponte draftData→assemblySelections para UI/export. A próxima candidata continua sendo o desenho de listagem/aggregate e seus consumidores; não foi iniciado por esta entrega.

**Bloqueios da PR #9/B2 final:** G1 rule-F2/F5, demais lacunas G2, G4a, precondições operacionais e reconciliação/revisão da integração final. G3b/G4b, provenance/backfill mantêm disposição própria; não são incluídos implicitamente. Nenhum fechamento antigo é repetido. Nenhum push/merge, alteração da PR #9, acesso operacional/Supabase, migração, seed/backfill, instalação, automação ou Phase 3 ocorreu nesta execução.

## Relatório de conclusão técnica do recorte

TypeScript: 0 erros em pnpm check e no check separado das provas. Testes: 84 novos passaram; 2.917 únicos executados passaram; 152 herdados não executados; zero regressão observada no conjunto executado. Código: quatro arquivos criados, três modificados; zero tabelas/endpoints/engines novos. Segurança: as seis rotas tocadas usam procedimentos autenticados com tenant, escritas com admin. Audit: quatro mutações CRUD chamam logAudit aguardado depois do commit; demais mutações da família não certificadas. A unidade não está formalmente encerrada sem a decisão humana aplicável.

Decisões de execução registradas no ledger: ambientes isolados aprovados e dependências reaproveitadas prevaleceram sobre defaults genéricos de setup; provas independentes foram preparadas em paralelo com propriedade de arquivos separada antes do patch; ledger/dossiê foram retidos para preservar rastreabilidade. Reuso de agente ocorreu após limite de threads do ambiente, preservando revisores distintos. A skill de finalização foi aplicada com a escolha já autorizada de manter branch/worktree locais; nenhum menu de merge/push ou limpeza destrutiva foi imposto.

O dossiê bruto e anexos são **locais em /private/tmp**, não publicados nem backup durável garantido; esta documentação preserva as conclusões e âncoras, mas reprodução detalhada depende de conservar esses arquivos e as dependências descritas. Um delivery record externo identificará o commit documental real, seus hashes/revisões e o estado final observado, sem autorreferência de SHA futuro.

## 2026-09-15 — Aceite humano e encerramento local de G2-1

**G2-1 está ENCERRADO LOCALMENTE por aceite humano**, limitado ao código **`1459a559e849ccd01a5c06da9be224d0e3af4ba2`**, à documentação **`d87dee7e74d5e3cecf873c90c5b3c7e04ce5cb6d`** e ao recorte e limites registrados acima.

Depois da entrega com esses commits, resultados, revisões e pendências, foi apresentada a pergunta: **“Aprova o encerramento local do G2-1 nesses commits, com os limites registrados?”** O usuário respondeu **“Autorizada”** nesta sessão. Registra-se a decisão posterior à entrega; não se inventa um horário de envio nem se infere autorização para outra transição.

### Camada 9 e evidências aceitas

- **Camada 9: PASS para o aceite e encerramento local desse resultado exato.** Aplica-se o Security Gate publicado em `f60cf9a56679d4d7083b2c11ac4e2727d53d84c3`, §9. As camadas 1–8 permanecem vinculadas ao código `1459a559`; o novo registro documental não transfere o parecer de segurança para outro SHA ou para todo o projeto.
- Código aceito: cinco operações CRUD de regras geográficas com tenant estrito, inclusive para administrador, mais a passagem de contexto nos dois callers adicionais de criação. Base comparada: `bf9fbb6bd917ceb207d7bf01ad77704e48ca8b2a`.
- Resultados aceitos da execução anterior: 84 testes novos passaram (34 normais e 50 PG); 2.917 únicos executados passaram; 152 herdados não executados; tipos sem erros; zero regressão observada no conjunto executado; scanner com 44 warnings e 6 gaps. Esses testes não foram repetidos nem reapresentados como execução deste suplemento exclusivamente documental.
- Revisões interna e independente: zero BLOCKER/REQUIRED pendente; cinco NOTE preservadas. Documentação `d87dee7e`: conferências pré e pós-commit PASS. Na retomada para este registro, os sete arquivos de código/provas foram conferidos contra [exact-sha-verification.json](/private/tmp/structr-g2-1-evidence-20260915/exact-sha-verification.json); os quatro documentos e os quatro pareceres, contra o [manifesto da entrega aceita](/private/tmp/structr-g2-1-evidence-20260915/delivery-manifest.json). Nenhuma divergência foi encontrada.
- Limites aceitos no recorte: exposição remanescente por listagem e consumidores; seed apenas parcialmente adaptado; audit pós-commit pode ficar não confirmado ou falhar após a gravação; sem garantia durável/conjunta de audit; sem prova operacional, FK/RLS, concorrência arbitrária ou triggers diferidos; skips/gaps históricos e integração final pendente. Nenhum status canônico de capacidade é promovido.

### Efeito e continuidade

Este suplemento acrescenta a decisão efetivamente recebida. Os trechos anteriores que indicam aceite pendente continuam como evidência histórica da entrega anterior; são superados apenas quanto ao aceite e encerramento local de G2-1. Os pareceres, logs, desenhos aprovados e manifests anteriores permanecem intactos.

**Publicação continua pendente. PR #9 permanece NO-GO e B2 global NOT DEFENSIBLE.** A falta local do objeto main `8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf` e a diferença entre a base informada pela PR (`233569d6`) e a main remota observada permanecem limitações da integração final, sem recuperação automática.

O próximo recorte previsto é o **desenho de listagem/aggregate de G2 e seus consumidores**, conforme a sequência aprovada. Este aceite encerra a unidade entregue; não inicia esse desenho, outra implementação, publicação, merge, operação de banco, migração, seed/backfill, instalação, automação ou Phase 3. G1, G4a e as demais pendências conservam suas disposições próprias.

O registro deste encerramento e seu commit são locais e exclusivamente documentais, na mesma branch. O SHA do suplemento e sua conferência serão registrados depois de existirem em `/private/tmp/structr-g2-1-closure-20260915/`, separadamente do código aceito e sem inventar SHA futuro.
