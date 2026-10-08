# ADR-002 — leituras mínimas autenticadas, 8 de outubro de 2026

**Estado deste registro:** backend e UI integrados localmente, testes focais, TypeScript e build aprovados; verificação geral e publicação pendentes. Este documento **não encerra o sprint nem libera uso em campo**. Base `0cc3bc01a8942c83c95c25734e4b09c5a0b2f34a`, branch `codex/adr002-minimum-reads`.

## Contrato e superfície

A implementação segue a [ADR-002 aceita](../adr/ADR-002-pilot-authenticated-database-boundary.md) e os snapshots congelados em `tmp/adr002-minimum-read-v31/`:

| Documento | SHA-256 |
| --- | --- |
| `JIM-MINIMUM-READ-CONTRACT-v3.1.md` | `239bf7987ab2fc4f5262975ef3d4d1a028bdecc6485ab6289a64c7536bce928c` |
| `JIM-MINIMUM-READ-F2-ADDENDUM-v2.md` | `6e346d87a3baa7b55584dd26c5afb932b16bfc7365b3e4db53fe55b204803bdd` |

São atualizadas duas queries existentes, com comando fechado `{id}` e resposta pública tRPC preservada:

| Query | RPC público | Versão do envelope |
| --- | --- | --- |
| `estimate.getById` | `structr_estimate_draft_read_v1(command jsonb)` | `structr-authenticated-estimate-read-v1` |
| `estimate.getInternalApproval` | `structr_internal_approval_record_v1(command jsonb)` | `structr-authenticated-approval-record-v1` |

A [allowlist](../../server/_core/trpc.ts) passa a conter somente essas duas queries, `auth.me`, `auth.session` e `estimate.getInternalApprovalReview`. Todas as mutations e os demais caminhos continuam recusados no modo Data API. O [transporte](../../server/authenticated-data-api.ts) usa destinos fixos, o bearer da requisição e no máximo três tentativas HTTP completas para conflitos `40001`/`40P01`; não há fallback para SQL nem credencial administrativa no web. O modo direto mantém seus helpers anteriores.

## Respostas e integridade

O [decoder de detalhe](../../server/authenticated-estimate-draft-read.ts) preserva as **54 colunas** físicas de `estimate_drafts`, além de `historicalImportId`. Campos numéricos permanecem strings/null, datas canônicas UTC com milissegundos voltam a `Date`, e JSON é preservado sem coerção. Envelope, identidade e ID solicitado são conferidos; campos ausentes/extras, tipos inválidos e dados com getters/undefined são recusados. O comando geral aceita UUID em maiúsculas, normalizado antes da chamada e comparação; a leitura ausente por UUID NIL (todos zeros) mantém sua semântica no SQL.

A autorização geral continua pelo tenant do projeto: `draft.tenantId` pode ser null ou divergente, conforme o helper anterior. Não foi acrescentada recusa geral por `projects.deleted_at`, nem lock de negócio de A1 a essa query. Configuração, perfil e tenant ativos são protegidos no início da operação.

O [decoder do registro](../../server/authenticated-internal-approval-record.ts) recebe draft/projeto/cliente/tenant/perfil e evidência de snapshots, decisões, revogações, autores e `sourceMatches`. Reutiliza o [validador de evidência existente](../../server/internal-estimate-approval-db.ts) para hashes, política congelada, contexto e estado `none`, `active` ou `revoked`; não recalcula uma nova aprovação a partir da política atual. A capacidade é **read**, não approve. Cliente inativo ou excluído continua legível, enquanto projeto excluído é recusado pela autorização A1. Sem evidência, mantém-se `none`, inclusive para origem histórica; havendo evidência, lineage e contradições H1 continuam visíveis e provocam recusa quando incompatíveis.

## SQL, privilégios e auditoria

A [migration 0017](../../drizzle/0017_authenticated_estimate_reads.sql) acrescenta duas funções públicas `SECURITY INVOKER` e duas implementações privadas `SECURITY DEFINER`, todas `VOLATILE`, com `search_path` fixo. A execução exige a transação serializable real verificada pelo helper de claims, além da revalidação de expiração após esperas por locks. `0015` e `0016` permanecem inalteradas.

- Novo owner `structr_estimate_read_owner_v1`: `NOLOGIN`, `NOINHERIT`, `NOSUPERUSER`, `NOBYPASSRLS`, sem criação de bancos/roles ou replicação. Possui SELECT por coluna nos objetos necessários, INSERT apenas nas sete colunas do evento operacional e `UPDATE(id)` para os locks de configuração/perfil/tenant/H1. Não possui tabelas.
- O registro A1 reutiliza `structr_review_owner_v1` e seus privilégios existentes. O novo owner recebe EXECUTE somente dos helpers de claims/UUID necessários, além de USAGE nos schemas definidos pelo contrato.
- Quatro policies novas, espelhadas no ORM: SELECT e UPDATE para o novo owner em configuração e H1; UPDATE tem `USING(true) WITH CHECK(false)` para permitir lock e impedir alteração nessas relações. Não há acesso a `auth.*`, nova tabela, modificação de emissor, grant de relação para API ou revogação global.
- O público autenticado alcança os wrappers nomeados. O EXECUTE privado necessário à chamada está acompanhado da ausência de USAGE em `structr_private`; não se abre uma rota de chamada privada por lookup. Grants temporários de SET/CREATE usados na transferência de ownership são retirados ao fim.
- Preflight recusa drift de privilégios efetivos/inherited/SET, relações/colunas/views/sequences acessíveis, funções desconhecidas executáveis e policies incompatíveis que esconderiam configuração ou H1. Postflight confirma a contenção; a aplicação deve ocorrer atomicamente.

`estimate.getById` preserva o evento **best effort** `estimate_viewed`: ator resolvido pelo banco e os quatro campos anteriores (`bundleName`, `status`, `source`, `pricingSchemaVersion`). Somente o INSERT de auditoria fica dentro do bloco de exceção; falhas de autenticação, autorização ou integridade continuam fechando a operação. O router não grava uma segunda auditoria. Esse SQL **não chama literalmente** `logAudit()`/`withAuditLog()`; a disposição F2 congelada trata uma query com log operacional, sem auditoria recursiva do próprio evento e sem usar a exceção administrativa do bootstrap. Futuras mutations continuam sujeitas a alteração, readback e auditoria durável na mesma transação, conforme ADR-002, item 10. A leitura do registro A1 permanece sem novo audit, como no helper existente.

## Evidência local e contagem

Não foram executados novos testes para escrever este documento. Os resultados abaixo vêm dos logs já produzidos:

| Conjunto | Resultado | Composição |
| --- | --- | --- |
| TS: decoders, transporte, routers e barreira | **304/304**, 8 arquivos | **155 novos** e 149 regressões existentes |
| PostgreSQL/PostgREST e inventário | **115/115**, 4 arquivos | **58 novos físicos** (47 HTTP + 11 lifecycle), 17 físicos existentes e **40 de inventário offline** |
| `pnpm check` | **exit 0**, zero erros | Candidato local compartilhado |

Os oito arquivos do grupo 304 não incluem `migration-history-reconcile.test.ts`; seus 40 casos aparecem apenas no grupo 115. As contagens são mantidas separadas e **115 não é apresentado como 115 testes físicos novos**. A primeira execução de typecheck encontrou somente restrição de escrita do cache local; a execução final autorizada terminou com sucesso.

TDD observado: decoders 31 falhas esperadas antes da implementação; dispatch/rotas 39; compatibilidade de casing 3. A frente física registrou RED real para RPCs ausentes, UUID, policies e inventário, seguido de GREEN. Falhas de preparação/expectativa de fixture estão identificadas separadamente no recibo físico, sem serem usadas como prova de defeito do produto. A revisão estática independente do candidato não identificou bloqueadores no backend examinado.

A primeira suíte geral do backend terminou com **7.132 aprovados, duas falhas e 1.144 opt-in ignorados**: `historical-estimate-schema-security.test.ts` ainda esperava duas policies H1 e dez no inventário global. O teste foi atualizado para comparar integralmente as quatro H1 e as 14 globais, e seu fixture físico passou a preparar os dois owners sem conceder acesso bruto. A regressão focal posterior passou **77 casos**, incluindo os dois físicos existentes de schema gerado, com um caso histórico externo ignorado. Essas execuções não aumentam a contagem de testes novos. SQL 0017 e seus hashes permaneceram iguais. A nova suíte geral integrada ainda é necessária antes do aceite. `pnpm build:vercel` do backend passou, com avisos existentes de tamanho de chunks.

O pre-push protegido posterior terminou em **7.132 aprovados, duas falhas e 1.144 opt-in ignorados**: timeout no import frio/geração do schema e término sem status de sucesso na CLI offline de bootstrap. Foram identificados e encerrados quatro workers órfãos das suítes interrompidas da cópia Munder, após conferir PID, ausência de pai e diretório exclusivo. No teste do schema, a preparação compartilhada passou a `beforeAll` com limite de 30 segundos; os testes mantêm cinco segundos e os mesmos asserts. GREEN focal: **8 aprovados, três opt-in ignorados**; o caso afetado executou em 15,95 ms. A CLI passou **24/24 offline** após a limpeza, com os 76 físicos explicitamente ignorados, sem alteração de código/limite/asserts; o caso anterior passou em 1.644 ms. `status=null` após 10.077 ms é compatível com o timeout de 10 segundos do subprocesso, mas o log não identifica definitivamente a causa. A nova execução geral permanece necessária; o envio não foi publicado. Evidências em `pre-push-protected-backend.log`, `bootstrap-post-cleanup.log` e `schema-cold-setup/`, sob o diretório privado desta entrega.

Evidências locais privadas, não incluídas como fixtures públicas:

- `/private/tmp/adr002-minimum-read-final-green.log` e `adr002-minimum-read-typecheck-final.log`.
- `/private/tmp/adr002-minimum-read-decoder-red.log`, `adr002-minimum-read-dispatch-red.log` e `adr002-minimum-read-case-red.log`.
- `/private/tmp/structr-minimum-reads-20261008/final-green.log`, `final-green.json` e `final-source-cleanup.json`; este último discrimina REDs, hashes e encerramento/remoção dos dois laboratórios próprios.
- `/private/tmp/structr-minimum-reads-20261008/backend-check.log`, `backend-full.log`, `backend-build.log`, `schema-inventory-red.log` e `schema-inventory-green.log`.

O laboratório usou PostgreSQL **17.11** e PostgREST **16.4**, com JWT ES256 e HTTP reais. Cobriu paridade de dados e estados com o legado, recusa de acesso, grants/policies, auditoria best effort, locks/expiração/conflitos, rollback completo e instalação por migrador não superuser. Isso não substitui teste positivo hospedado da nova fatia.

| SQL verificado | SHA-256 dos bytes |
| --- | --- |
| `0015_authenticated_review_boundary.sql` | `88fcc8c3627f7bc041f1664ad3218c9669fed8bdaf80818aa083df9286c06241` |
| `0016_authenticated_public_schema_usage.sql` | `3c71f95cff486119d2367667e54be1dbd3b1ce0e8b8cc7a4ddb0a1259e78d542` |
| **`0017_authenticated_estimate_reads.sql`** | **`60ce257a9e6a2c65b3aced4ca1190b0204d9d09220d4524aaea6b5d95a5187c1`** |

## Homologação e pendências

### Integração da interface: handoff parcial, sem aceite implícito

Munder liberou a autoria exclusivamente ao Codex às **21:31:50 UTC**, em `OWNERSHIP-RELEASE.json` da missão `adr002-parallel-field-readiness-20261008`. Jim encerrou as edições e os runners. O snapshot `9c78f90b2bc8874727130c75f76c954ad61058b6`, base `0cc3bc01`, está congelado e classificado **PARTIAL, NOT APPROVED**: manifest SHA-256 `387fe0bedc1aac5074652df8d792e7b519472a8f2dbea9aa68da983b10f54db7`; patch `30554ff458ed0ec3f7a67cdb9ebfcab09c032c465db2e1dd3334d28a1ff2a198`.

Restavam o fechamento seguro quando o descritor não traz a flag, guards em quatro handlers de exportação, navegação para listagem indisponível, diálogos abertos e testes comportamentais correspondentes. Os 28 testes verdes do autor não encerram esses itens. Sua cronologia foi implementação inicial, testes e depois stash/RED/restauração/GREEN; não é certificada como TDD integral. O integrador prepara primeiro os testes adicionais contra a UI de base, antes de incorporar ou corrigir a implementação parcial. Os testes legados conservam casos/asserts; somente os mocks e scopes recebem o modo direto explícito. A revisão final é do conteúdo integrado.

Esse fechamento local passou pelo RED de **43 falhas comportamentais** antes de qualquer mudança nos dois arquivos de produto, seguido de **361 passes = 47 casos novos + 314 legados**, zero falhas e dois skips históricos reportados. Os nove arquivos de testes foram preservados byte a byte entre RED e GREEN. `auth.session` anuncia o modo de banco como metadado público de apresentação; somente um `estimateReadOnly:false` explícito e resolvido libera os controles existentes. Erro, atualização, pausa ou flag ausente mantêm a tela restrita. As queries indisponíveis são suspensas, todos os handlers correspondentes têm guard, links para listas/custos ficam ocultos e diálogos de relatório/exportação/printable já abertos não permanecem disponíveis. A revisão de aprovação pode ser solicitada sem expor confirmação de decisão. O gate real do backend permanece independente desse descritor.

`pnpm check` e `pnpm build:vercel` integrados terminaram com exit 0; o aviso existente de chunks grandes permanece. Evidências `ui-integration-{red,green}.{log,json}`, `integrated-check.log` e `integrated-build.log` no diretório privado da entrega. UI SHA-256 `2371a1b9457f93cdfaefa69183454cf271a65ed54f33cfae58e8ea887f270f20`; auth-router `b1290fbec433b1425f561796612df439997418b0048a1b83c5d3a862084c2416`. A revisão estática independente dos mesmos hashes não encontrou bloqueadores na fatia examinada. O harness exercita elementos/handlers reais com estado controlado e SSR; não é uma prova de navegador montado ou ambiente hospedado.

O preview automático da branch `codex/adr002-minimum-reads` está desativado em `vercel.json`, assim como já estava o da `main`. A inspeção de metadados da Vercel, sem decifrar valores, identificou overrides de teste somente na branch designada de homologação e variáveis globais com alvo production/preview. Por isso, o primeiro envio foi interrompido preventivamente durante o hook: a consulta posterior não encontrou a branch no remoto nem deployments dela. Publicar código para revisão não deve iniciar um runtime com configurações herdadas; a atualização hospedada permanece restrita à branch de homologação já configurada.

Em 8 de outubro, o integrador executou pelo conector Supabase **somente** `BEGIN READ ONLY`, o bloco `DO $read_preflight$` exato de 0017, `SELECT` com resultado `minimum_read_preflight_passed`, e `ROLLBACK`. Recibo sanitizado: `/private/tmp/structr-minimum-reads-20261008/hosted-readonly-preflight.json`. A hora de registro do recibo não deve ser tratada como hora exata da consulta.

Separadamente, a preparação de aplicação usou o mesmo `apply_migration` para uma falha controlada: schema e tabela de sonda exclusivos, armazenamento/comparação do ID de transação e uma exceção nominal deliberada. A mensagem confirmou a mesma transação; a leitura posterior encontrou zero schema, relações ou entrada no ledger da sonda, quatro auditorias existentes e zero drafts. A sonda foi revertida integralmente, sem limpeza destrutiva adicional. Recibo: `/private/tmp/structr-minimum-reads-20261008/hosted-atomic-probe.json`. O [MCP oficial](https://github.com/supabase/mcp/blob/main/packages/mcp-server-supabase/src/platform/api-platform.ts) encaminha o SQL à Management API, cuja [referência](https://supabase.com/docs/reference/api/v1-apply-a-migration) não explicita atomicidade; esta é uma prova observada do executor, não garantia permanente do provedor nem aplicação de 0017.

**0017 ainda não foi aplicada à homologação neste snapshot.** O preflight não demonstra criação de funções/policies nem autoriza afirmar paridade do catálogo hospedado com o candidato. O levantamento do integrador ainda registra zero dados comerciais de piloto hospedados; conta, perfil e configuração de acesso já existentes são um escopo separado.

Relatório parcial exigido pelo repositório:

- Novas tabelas: **0**. Novo owner: **1**. Novas funções SQL: **4**. Novas policies: **4**.
- Endpoints: **0 novos**; duas queries protegidas existentes atualizadas. Engine financeiro: **sem alteração**.
- Arquivos novos: `server/authenticated-estimate-draft-read.ts`, `server/authenticated-internal-approval-record.ts`, `server/adr002-minimum-read.fixtures.ts`, `server/adr002-minimum-read-decoders.test.ts`, `server/adr002-minimum-read-router.test.ts`, `server/adr002-minimum-read-transport.test.ts`, `server/adr002-estimate-reads-physical.test.ts`, `server/adr002-estimate-read-migration-physical.test.ts` e `drizzle/0017_authenticated_estimate_reads.sql`.
- Arquivos existentes ajustados: `server/authenticated-data-api.ts`, `shared/domain/taxonomy.ts`, `server/estimate-router.ts`, `server/_core/trpc.ts`, `server/authenticated-internal-approval-review.ts` (exports mínimos), `server/adr002-router-guard.test.ts`, `drizzle/schema.ts`, `drizzle/meta/_journal.json`, `server/test-support/adr002-postgrest.ts`, `server/adr002-review-record-physical.test.ts` e `server/migration-history-reconcile.test.ts`.
- Segurança: queries de negócio mantêm `protectedProcedure`/`tenantProcedure`; nenhum writer liberado.
- Auditoria: evento operacional preservado na query geral conforme adendo F2; nenhuma mutation comercial acrescentada.
- UI: novos `server/adr002-partial-read-ui-session.test.ts` e `server/adr002-partial-read-ui-estimate-detail.test.ts`; modificados `server/auth-router.ts`, `client/src/pages/EstimateDetail.tsx` e sete harnesses/mocks legados. Nenhuma tabela, função financeira ou mutation acrescentada por essa frente.
- Regressões focais: **zero**. TypeScript e build integrado: **aprovados**. Suíte geral integrada: **pendente**.
- Navegação real integrada, dados do piloto, teste positivo hospedado, aplicação de 0017, PR/CI/publicação e aceitação em campo: **pendentes de fechamento pelo integrador**.

Acesso e essas duas leituras não liberam formação completa do orçamento, aprovação, versionamento ou exportação. O sprint permanece aberto até a conclusão das verificações e da entrega integrada.
