# SWR-1 — prova hospedada encerrada

**Resultado:** leitura autenticada de projeto/intake comprovada na homologação, com recusas, retirada auditada e fechamento confirmados. **Uso em projetos reais não liberado.** A ADR-003 financeira permanece PROPOSED, aguardando decisão do responsável.

Fonte congelada durante toda a prova: `7dd4052662107c2b6092de73bcf79aab18b6054e`, projeto Supabase `wmspwegbqtzamkhxhusg` (`structr-ai-homolog`). Execução em 9 de outubro de 2026, horário de Charleston; último readback `2026-10-10T00:49:45.555Z`. Base do PR: `17f276322c7a97972404d034e672a4d216e67cd4`. A documentação de encerramento é posterior à fonte testada e não altera seu código executável.

## Evidência por superfície

| Superfície | Executado e conferido |
| --- | --- |
| UI hospedada / tRPC | Login A1 com credencial protegida; abertura dos dois pares IF-1; atualização do primeiro; troca para segundo sem dados do primeiro; combinação projeto/intake incompatíveis recusada sem dados anteriores; logout. Não houve login UI de A2/B1 nesta rodada. |
| RPC autenticada direta | Três logins novos, `getUser` e sessão protegida coerentes; A1 lê cada par duas vezes com decoder real e respostas iguais; A2 sem membership/`project:read` e B1 de outra organização recusados nos dois pares; combinação incompatível, autoridade extra e acesso bruto a quatro tabelas recusados; IF-1 fechado. Foram 13 checks antes da retirada. |
| Revogação | Após a retirada, `getUser` ainda aceita os mesmos três bearers, com 566–567 segundos de validade restantes; sessão protegida e os dois pares recusam cada identidade. SWR permaneceu aberto durante essas recusas, portanto o fechamento de grants não explica o resultado. Três signouts locais posteriores retornaram 204. |
| Banco, observer independente | Snapshot integral de 91 tabelas e hashes das linhas físicas. Histórico de audits, duas formações IF-1 e seus seis audits, operador real, issuer e demais registros preservados. Só cinco identidades e os 12 audits previstos mudaram. Nenhuma escrita de negócio/audit resultou das leituras. |
| Fechamento | Três profiles e dois tenants sintéticos inativos; EXECUTE público e privado de SWR-1 false; ambos de IF-1 false. Companion close não alterou linhas. Flag SWR da branch preview false e novo deploy fechado READY na fonte testada. |

A prova direta não atravessa o tRPC: seu recibo mantém `trpcVerified=false` e `uiVerified=false`. A evidência UI é separada e comprova o caminho da tela para A1. O diagnóstico HTTP sem autenticação do preview recebeu 302 para Vercel, preservando sua proteção; não foi interpretado como login da aplicação.

## Continuação auditada

Manifesto nominal novo `structr-homolog-identity-continuation-v1`, hash canônico `153737f08d2fac8d92d10e31c8b1ab4a8cd495bb83ce98ef379dbdc6a82e58f5`; predecessor encerrado `2084957cb37c1a68828b8ab9212b8a40fdbb63725fea579c6813a8d2c827e2a1`. Operação de ativação `4ea6897d-8dbe-4554-aa2d-fee7ac855d57`; retirada `c4477e4f-5d34-4607-abb2-153dfa662962`. O runner verificou fonte e destino TLS, usou Drizzle SERIALIZABLE e `logAudit`, com cinco linhas e seis audits por transição. A2 não recebeu autoridade adicional.

| Readback | Tabelas | Linhas totais | Audits | Estado SWR |
| --- | ---: | ---: | ---: | --- |
| Baseline | 91 | 61 | 42 | fechado |
| Após ativação | 91 | 67 | 48 | fechado |
| Após leituras | 91 | 67 | 48 | aberto |
| Após retirada | 91 | 73 | 54 | aberto |
| Após fechamento | 91 | 73 | 54 | fechado |

A [primeira tentativa recusada](scope-workspace-read-implementation-2026-10-09.md#instalação-e-primeira-tentativa-hospedada) foi preservada, inclusive o erro de sequenciamento e seu fechamento imediato. Ela não conta como prova positiva.

## Instalação e deploys

A nominal `0019_authenticated_scope_workspace_read.sql` permanece byte a byte igual ao candidato (`de4272f63d94fc330b68108a7abc78f11a94a7a2b43521e2d1fbad65796df7c9`). Foi instalada fechada no ledger `20261010002415 / 0019_authenticated_scope_workspace_read_closed`. Esta janela usou `swr1_continuation_proof_open` e `swr1_continuation_proof_close`. O owner dedicado permanece NOLOGIN/NOINHERIT/NOBYPASSRLS/NOSUPERUSER; não foi concedido BYPASSRLS pela 0019.

- Prova: `dpl_5v3tRRj7jLujtJPH9EPeNGES1H1V`, [preview de prova](https://structr-gxn37qksv-wcvmsilvas-projects.vercel.app), fonte `7dd40526`.
- Encerramento: `dpl_H6SpQikQiSm32YrKnNkUL2bDSkMK`, [preview fechado](https://structr-boxucy8er-wcvmsilvas-projects.vercel.app), READY, mesma fonte, flag SWR false.
- A flag false é específica da branch `codex/scope-workspace-contract`, target preview. Não houve mudança de produção. Os previews anteriores são imutáveis e alguns conservam flag true, mas a RPC fechada no banco recusa o acesso.

## Verificação do código

`pnpm check` passou sem erros. O hook obrigatório de publicação em `7dd40526` passou **7.832 testes**, com **1.457 ignorados** e zero falhas; 225 arquivos aprovados e 46 ignorados. O [CI exato](https://github.com/wcvmsilva/structr-ai/actions/runs/38010298277) passou tipos, testes e build. Foram adicionados **299 casos distintos**, sem somar execuções focais sobrepostas: 250 SWR-1 e 49 de continuação. As provas físicas opt-in foram executadas separadamente; os skips da execução padrão não são declarados passes.

Os [resultados RED/GREEN e revisões](scope-workspace-read-implementation-2026-10-09.md) incluem 88 casos físicos SWR-1, 152 do helper de continuação (39 novos/113 anteriores) e 115 do runner (dez novos/105 anteriores). Oito checks dos scripts operacionais passaram fora da contagem do produto.

## Recibos e limites

Os recibos locais completos estão em `/private/tmp/structr-swr1-attempt2-20261009`, com permissões restritas. Os hashes abaixo são SHA-256 dos **bytes dos arquivos**, distintos dos hashes canônicos dos snapshots/manifestos. Senhas, tokens, configuração administrativa e linhas privadas não são anexados ao GitHub.

As duas primeiras entradas AX do recibo UI são diferenças incrementais; a de refresh registra o carregamento intermediário. A captura `ui-a1-pair1.jpg`, obtida em seguida, confirma o primeiro par novamente carregado. As entradas do segundo par, recusa e logout têm árvore completa; o JSON AX sozinho não substitui essas capturas.

| Arquivo local | SHA-256 |
| --- | --- |
| `swr1-readback-baseline.json` | `738df1659624e7e220e163e04bd1419829aec08c45f1a2e650d7adbb2b768ea1` |
| `swr1-readback-after-reactivation.json` | `c6d2bf784ac5873e89cdb7d23dbec0496b069bd501b64215084c2bbadba6a0ee` |
| `swr1-readback-after-reads.json` | `326c226969de492cdf0d294e3623bbf11938849959c5b748bbc2df1aff524d4d` |
| `swr1-readback-after-withdrawal.json` | `b1024a1e0ef5038921aa41899a0d977c029b44dcd84984519b49a3448a0b43cb` |
| `swr1-readback-after-close.json` | `0ac2e407ad9abe5b7bfe027ffa7c13a77c32a490975baa29af5dd802e80973f1` |
| `swr1-probe-final.json` | `7a787552bde69b405027f334deb5ef3ce3f6d62bceb725eaa257a05c70b40e7d` |
| `swr1-ui-proof.json` | `4ea03481b6585957b9583e16d1368d7a209531f5feb7c8e050d76fcf826f4302` |
| `ui-a1-pair1.jpg` | `c47de6f88ab3e19bb14414db6dff6efd95737928c2242402e4680e1acc3bf8a6` |
| `ui-a1-pair2.jpg` | `c332ab1fa0427481efdc88a0ce467d1be08a02472befd01ef206cadf6d8e74c7` |
| `ui-cross-pair-denied.jpg` | `6ff93bd05625d5a3b775cf05a5b2ab1b8ede8eac551ba76bf1286ab9b8f25874` |

Não foram executadas injeções de falhas/DDL administrativas contra o serviço hospedado. Concorrência, perda de autoridade e falhas de auditoria são cobertas pelas provas físicas locais específicas, não por esta janela hospedada. A prova não inclui cálculo, escopo gerado, aprovação financeira, versionamento, exportação ou restauração do ambiente. Não implica equivalência financeira do PDF nem liberação de produção. O próximo pacote depende da decisão sobre [ADR-003](../adr/ADR-003-pilot-financial-executor.md).

## Completion report — incremento SWR-1

- TypeScript: zero erros.
- Tests: 299 novos distintos; suíte padrão 7.832 aprovados/1.457 ignorados/zero falhas; provas físicas separadas conforme acima.
- New tables: nenhuma; schema existente espelha duas policies privadas adicionais.
- New engine functions: nenhum motor financeiro novo; schemas puros de comando/identidade/envelope em `shared/scope-workspace-read.ts`.
- New helpers: `decodeAuthenticatedScopeWorkspaceRead`, `loadAuthenticatedScopeWorkspace`, `callAuthenticatedScopeWorkspaceRead`; preparação administrativa nominal `parseHomologIdentityContinuationManifest`, `planHomologIdentityContinuation`, `verifyHomologIdentityContinuationEvidence`, `reactivateHomologIdentityContinuation`, `withdrawHomologIdentityContinuation`.
- New endpoints: nenhum endpoint tRPC paralelo; `scopeGeneration.loadWorkspace` existente modificado. RPC SQL nominal `structr_scope_workspace_read_v1` adicionada.
- Security: endpoint de negócio protegido — YES; autorização atual também exigida na chamada RPC direta.
- Audit: todas as novas mutations administrativas têm `logAudit` na transação — YES; SWR-1 não contém mutation.
- Regressions: testes existentes quebrados — NO.
- Files created/modified: inventário revisável no [diff do PR #45](https://github.com/wcvmsilva/structr-ai/pull/45/files), base e fonte acima; documentação de fechamento posterior não altera o código comprovado.

Este relatório encerra somente o incremento SWR-1; o sprint completo de liberação para campo continua aberto.

### Inventário de arquivos do incremento

Criados:

- `client/src/components/scope/AuthenticatedScopeWorkspace.tsx`
- `docs/adr/ADR-003-pilot-financial-executor.md`
- `docs/engineering/scope-to-field-coordination-2026-10-09.json`
- `docs/engineering/scope-to-field-coordination-2026-10-09.md`
- `docs/engineering/scope-workspace-read-hosted-proof-2026-10-09.md`
- `docs/engineering/scope-workspace-read-implementation-2026-10-09.md`
- `docs/security/scope-workspace-read/candidate.sql`
- `docs/security/scope-workspace-read/contract-2026-10-09.md`
- `docs/security/scope-workspace-read/homolog-close.sql`
- `docs/security/scope-workspace-read/homolog-open.sql`
- `docs/security/scope-workspace-read/identity-continuation-contract-2026-10-09.md`
- `drizzle/0019_authenticated_scope_workspace_read.sql`
- `server/adr002-scope-workspace-contract.test.ts`
- `server/adr002-scope-workspace-gate.test.ts`
- `server/adr002-scope-workspace-physical.test.ts`
- `server/adr002-scope-workspace-router.test.ts`
- `server/adr002-scope-workspace-transport.test.ts`
- `server/adr002-scope-workspace-ui.test.ts`
- `server/authenticated-scope-workspace-read.ts`
- `server/homolog-access-continuation-runner-physical.test.ts`
- `server/homolog-identity-continuation-physical.test.ts`
- `server/homolog-identity-continuation.test.ts`
- `server/test-support/adr002-scope-workspace-fixtures.ts`
- `server/test-support/homolog-continuation-fixtures.ts`
- `shared/scope-workspace-read.ts`

Modificados:

- `AGENTS.md`
- `README.md`
- `client/src/pages/Intake.tsx`
- `client/src/pages/ScopeGeneration.tsx`
- `docs/adr/ADR-002-pilot-authenticated-database-boundary.md`
- `docs/engineering/current-state.md`
- `drizzle/meta/_journal.json`
- `drizzle/schema.ts`
- `plans/current-sprint.md`
- `scripts/homolog-access-runner.ts`
- `scripts/homolog-read-proof.ts`
- `server/_core/database-mode.ts`
- `server/_core/trpc.ts`
- `server/adr002-intake-integration-router.test.ts`
- `server/auth-router.ts`
- `server/authenticated-data-api.ts`
- `server/historical-estimate-schema-security.test.ts`
- `server/homolog-access-runner.test.ts`
- `server/migration-history-reconcile.test.ts`
- `server/scope-generation-router.ts`
- `server/scope-navigation-ui.test.ts`
- `server/test-support/adr002-postgrest.ts`
- `shared/domain/taxonomy.ts`
- `todo.md`
- `vercel.json`
