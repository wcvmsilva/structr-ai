# STRUCTR — precondição de perfil na criação de lead

Data: 15/09/2026. Entrega local delimitada; sem publicação. Repositório: https://github.com/wcvmsilva/structr-ai.

## Resultado e fronteira

A rota existente `leads.create` agora exige um perfil persistido ativo, identificado pelo ID interno e pertencente ao tenant confiável resolvido. A consulta ocorre antes da leitura de duplicidades. Perfil ausente, inativo, sem tenant ou de outro tenant resulta em FORBIDDEN; indisponibilidade/falha da consulta resulta em erro interno com mensagem constante, sem SQL ou causa original. Nenhum desses casos continua para os helpers comerciais.

O antigo `ensureProfileExists`, que podia inserir perfil admin e cuja falha era ignorada, foi removido. Seu substituto `requireExistingLeadProfile` realiza apenas SELECT parametrizado, sem troca de papel SQL, INSERT, UPDATE, UPSERT ou default de tenant. O payload do lead usa os mesmos `scope.userId` e `scope.tenantId` da precondição, incluindo o fallback de contexto já definido pelo resolver. Comparação UUID ocorre no PostgreSQL, preservando representações equivalentes em maiúsculas/minúsculas.

Claim aceito para esta candidata: **a criação de lead não cria/promove perfil e não continua após falha dessa precondição**. A inserção comercial foi observada por um double explícito no laboratório; esta prova não equivale a criar um lead real no Supabase nem a executar Lead→Estimate inteiro. A validação e a inserção continuam separadas; não há garantia de revogação concorrente/TOCTOU ou de auditoria comercial completa.

## Autoridade e identidade da candidata

- Autorização: “Perfeito! Vamos em frente”, após o contrato `/private/tmp/structr-identity-contract-20260915/contrato-identidade-provisionamento.md`, §§7–8. Plano fixado antes da implementação: `docs/security/lead-profile-precondition-plan.md`.
- Checkout: `/private/tmp/structr-lead-profile-precondition-20260915`; branch `codex/lead-profile-precondition-20260915`, sem upstream.
- Base comparada e HEAD pré-commit: `622e6afb9591c8b118c8661e5695f9870e26a53b`. **Esse SHA não contém a correção.** A candidata é identificada pelo diff e pelos hashes em `.superpowers/sdd/lead-profile-precondition/delivery-manifest.json`. Não existe SHA resultante nem observação de publicação.
- Instruções/decisões: AGENTS na base; workflow, Security Gate e decisões em `f60cf9a56679d4d7083b2c11ac4e2727d53d84c3`; ADR-001; handoff; contrato aprovado. A correção PostgreSQL do workflow resolve o texto MySQL antigo de AGENTS. Não se declara sprint encerrado/conformidade F2/F5 global.
- Task 6, PRs documentais #12/#13 e G2-1 permanecem encerradas nos respectivos limites. Nenhuma etapa concluída foi reaberta.
- Documentos canônicos consultados por respostas GitHub previamente salvas em `/private/tmp/structr-g3a3-sha-review-20260915/{canonical-product,feature-maintenance}-github-response.json`: main `8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf`; blobs `b9e144e5b25b0c9dcfbcc0790b12931bc78713b2` e `6455caef19bbabb293ffd9104c67a5b73f487988`. Conteúdo histórico de objeto fixo, relido localmente; não copiado para esta linhagem.

Refs reconfirmadas por leitura remota nesta execução: main `8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf`, workflow `f60cf9a56679d4d7083b2c11ac4e2727d53d84c3`, security/PR9 `b95ea0bf4741646f418fcc99a22d22a42d24be51`. PR9 OPEN, não draft, não merged; sua metadata de base informa `233569d68c014712ce3d25326bda8823aab1987e`, divergindo da main remota atual. Não houve fetch/pull nem atualização de refs.

O objeto commit `8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf` continua ausente localmente (cat-file exit 128). Isso não impede testar a base local explicitamente aprovada, mas impede tratá-la como main reconciliada ou release pronta. A leitura remota não resolve integração/ancestralidade por inferência.

`preservation-state.json` registra horários UTC, branches, HEADs e alterações locais. Main local permanece em `233569d68c014712ce3d25326bda8823aab1987e`, limpa; G2-1 permanece em `622e6afb...`, limpa; laboratório ACL anterior permanece no mesmo HEAD com seus seis arquivos conhecidos. Os 31 artefatos de seu manifesto e os dois documentos do contrato mantêm os hashes anteriores.

## Reprodução, testes e resultados

Ambiente: Node 24.14.0, pnpm 10.15.1, Vitest 2.1.9, PostgreSQL 17.11 Homebrew. Dependências instaladas previamente reutilizadas; nenhuma instalação. Todos os comandos usam `env -i PATH=/usr/local/bin:/usr/bin:/bin NODE_ENV=test CI=1`. O laboratório dedicado acrescenta somente `PROFILE_ACL_LAB=1`.

Logs e metadados abaixo ficam em `.superpowers/sdd/lead-profile-precondition/`. Comandos completos, testes incluídos e limites estão no plano; resultados observados:

| Verificação | Resultado | Evidência |
| --- | --- | --- |
| Tipos da base | exit 0 | baseline-check.log |
| Suíte da base | 2.867 passaram / 202 ignorados; exit 0 | baseline-suite.log |
| RED PostgreSQL real | 9 falhas comportamentais esperadas / 8 passaram; exit 1 | red-postgres.log |
| RED rota, matchers compatíveis | 10 falhas comportamentais esperadas / 5 passaram; exit 1 | red-route-compatible.log |
| GREEN PostgreSQL real | 17 passaram, zero falhas; exit 0 | green-postgres.log |
| GREEN rota + Sprint24 | 45 passaram (15 novos + 30 existentes); exit 0 | green-route.log |
| Tipos finais da aplicação | pnpm check --incremental false; zero erros, exit 0 | final-check.log |
| Tipos dos testes/helpers | tsc com test-tsconfig.json dedicado; zero erros, exit 0 | test-types.log |
| Suíte final | 2.882 passaram / 219 ignorados; 71 arquivos passaram / 7 ignorados; exit 0 | final-suite.log |
| Auditoria estática de tenant | script via loader Node: exit 0; 44 avisos, 6 lacunas conhecidas | tenant-audit.log |
| Diff | sem erro de whitespace | diff-check.log |

São **32 testes novos**: 15 de rota e 17 de PostgreSQL. Os 219 ignorados da suíte normal são os 202 preexistentes mais os 17 opt-in executados separadamente. Total de casos distintos aprovados nesta rodada: 2.899; continuam 202 casos preexistentes não executados. Nenhuma regressão observada nos testes executados; não se declara cobertura integral.

`pnpm audit:tenant` falhou antes de rodar o auditor porque o invocador tsx tentou abrir IPC bloqueado pelo sandbox (EPERM, exit 1; tenant-audit-launcher.log). O mesmo script foi executado com `node --import tsx scripts/tenant-coverage-audit.ts`. O resultado estático e a frase automática de readiness não aprovam B2 global.

Transparência sobre preparação: o primeiro red-route.log contém matchers indisponíveis no Vitest 2.1 e não é o RED aceito. Os matchers foram substituídos por contagem+argumentos antes da execução red-route-compatible.log e antes das mudanças produtivas. O manifesto RED original foi preservado; red-provenance-correction.json registra o hash corrigido, coletado no encerramento, sem fingir registro contemporâneo. O teste PostgreSQL permaneceu idêntico entre RED e GREEN. test-types-initial.log revelou o contexto antigo do Sprint24 sem authProvider; somente fixture/mock autorizados foram ajustados, conservando suas expectativas.

## Prova no PostgreSQL e seus limites

Os dois lados usam os mesmos helpers copiados, ACLs tratadas e conexão proprietária postgres da fixture. No RED, a chamada sem perfil fez **4→5 perfis**, criou papel **admin** e chamou uma vez cada helper comercial. No GREEN, permanece **4→4**, nenhum perfil é criado, o erro é FORBIDDEN e ambas as chamadas comerciais ficam em zero. Casos de atividade/tenant e falhas de infraestrutura também recusam antes do acesso comercial. Os controles positivos preservam todos os campos dos perfis e os argumentos de ator/tenant.

A fixture usa perfis sintéticos, FK real para auth.users mínimo, roles/ACL/RLS reais e auth.uid simulado em SQL. O cluster temporário usa socket privado, TCP desligado, ambiente limitado, opções de conexão explícitas e prova de propriedade por nonce/WeakMap. A execução desse PostgreSQL local exigiu elevação de sandbox autorizada. Houve também leitura Git remota elevada após falha de DNS no ambiente restrito; nenhuma dessas ações consultou o banco remoto. RED e GREEN confirmaram parada e remoção do diretório ao terminar.

Fingerprint de metadados tratados, idêntica nos dois lados: `9bf4bb6d24e32e2592a5f4af8e27ff6e9c260127874ce6189c8418ff44d6dfaf`. `fixture-provenance.json` fixa os hashes dos três helpers reutilizados; nenhuma alteração neles. Controles confirmam leitura do próprio perfil, invisibilidade do alheio, recusa de UPDATE/RPC de promoção e preservação do resolver lookup-only.

Limites herdados: grants reproduzem a reconstrução documentada do catálogo anterior, não um catálogo vivo completo; Auth triggers não são reproduzidos; PostgreSQL local 17.11 difere do 17.4.1 remoto registrado; papel efetivo da aplicação em produção não é demonstrado. O controle de IDs externos diferentes prova preservação do resolver/perfil nesta fronteira, não compatibilidade produtiva de JWT, triggers ou inserção comercial. Nenhuma consulta Supabase/DB remoto nesta execução.

## Matriz de impacto — sem promoção canônica

IDs/nomes abaixo vêm do registro publicado. O autor `/root` preparou a mudança; revisor independente `/root/lead_profile_scope_review` examinou código, testes, fixtures e logs. “Revisado no recorte” não altera implementação, validação operacional, segurança, confiança, verificação, lifecycle ou roadmap. P-09 continua com correspondência insuficiente. As demais linhas preservam suas âncoras históricas; nenhum conjunto de 48 capacidades foi declarado CURRENT.

| ID / capacidade | Impacto | Comportamento / arquivos e consumidores | Aceitação / evidência / limite | Revisor e disposição |
| --- | --- | --- | --- | --- |
| P-01 Identity and authentication | Direto | lead-db/router exigem perfil existente; resolver Supabase preservado | Ausente/inativo negado, IDs intactos; PG e rota; OAuth/Auth pendentes | lead_profile_scope_review: revisado no recorte |
| P-02 Authorization and RBAC | Direto | Retirada da atribuição automática admin | Zero promoção/criação na rota; rbac.assignRole não corrigido | Mesmo revisor: revisado no recorte |
| P-03 Tenancy and tenant scoping | Direto | Consulta exige tenant confiável; payload usa resolveLeadScope | NULL/B recusados, fallback válido preservado; sem B2 global/TOCTOU | Mesmo revisor: revisado no recorte |
| P-06 Data access layer | Direto | ensureProfileExists substituído por SELECT em lead-db | Perfis completos e ACLs iguais; demais bypasses fora | Mesmo revisor: revisado no recorte |
| P-05 Audit and audit trail | Indireto | Retirada da escrita de perfil sem auditoria | Nenhum novo emissor; dívida da mutação de lead permanece | Mesmo revisor: limite aceito, F2 aberto |
| C-01 Lead capture and qualification | Direto | routers.ts:61 → leads.create → LeadModal.tsx:29 | Recusa visível pelo onError existente; positivos/scoring/duplicidade preservados em testes; sem ensaio de UI real | Mesmo revisor: revisado no recorte |
| C-02 Deal and pipeline management | Indireto | LeadModal convertToProject; lead-conversion e pipeline-db | A origem leads.create exige perfil elegível; nenhuma mudança de conversão; suíte de regressão, não fluxo completo | Mesmo revisor: fronteira preservada |
| C-06 Client formation | Indireto | lead-conversion forma client a partir do lead | Sem novo esquema/RLS/CRUD de clients; regressão existente | Mesmo revisor: fronteira preservada |
| C-07 Project formation | Indireto | lead-conversion/pipeline formam project | Sem novo esquema/RLS/CRUD de projects; regressão existente | Mesmo revisor: fronteira preservada |
| P-09 Evidence and provenance substrate | Indireto limitado | Vínculo owner/UUID preservado | Sem reatribuição de IDs; não prova substrato canônico completo | Mesmo revisor: limite preservado |

Um único caller produtivo da nova precondição foi encontrado; nenhum caller executável do escritor removido permanece. Sem alteração em imports dinâmicos, montagem de routers, telas, schema, migrations, taxonomy ou engines. Mudanças a SDK/trpc/rbac globais ou provisionador exigiriam novo escopo. Capacidades financeiras/estimativa/exportação não recebem promoção ou nova prova por consequência desta correção de identidade.

## Inventário e pendências

- Modificados: server/lead-db.ts, server/lead-router.ts, server/sprint24-lead-router.test.ts.
- Criados: os dois testes lead-profile-precondition*.test.ts, os três helpers profile-acl-* copiados, este relatório e o plano. Artefatos locais ignorados incluem logs, configuração de tipos, revisão e manifesto.
- Novas tabelas: zero. Engines alterados/novas funções de engine: zero. Novo helper: requireExistingLeadProfile; classe de erro: LeadProfileError. Novos endpoints: zero; leads.create mantém protectedProcedure e Zod.
- Auditoria completa de mutações: **não comprovada**, dívida preexistente rule-F2; nenhuma nova mutação de perfil. Atomicidade/revogação concorrente: não resolvidas. Isso não constitui encerramento de sprint/release.

Para esta correção local: verificações concluídas; revisão documental final e identidade do diff registradas nos artefatos. Para outras unidades: OAuth/upsertUser/rbac.assignRole/Auth triggers, createLead sem ator, demais bypassRLS, G2 listagem/aggregate, G1 rule-F2/F5 e G4a permanecem separados. Para produção/merge #9: integração das linhagens, objeto main ausente, contrato físico de IDs, grants atuais, papel real da conexão, ensaio operacional e aprovação de implantação permanecem necessários. G2 aberta, PR9 NO-GO.

**Próximo ponto proposto:** aceite deste diff local e de seus limites para preparar a integração documental/código em uma unidade própria. Esta entrega não autoriza nem executa commit, push, merge, deploy, migração, reativação de API ou provisionamento de usuários.
