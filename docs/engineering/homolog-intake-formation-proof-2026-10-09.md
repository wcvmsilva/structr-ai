# Cadastro IF-1 na homologação — 9 de outubro de 2026

**Estado deste checkpoint:** cadastro sintético confirmado pela tela e prova
direta da RPC concluída na homologação. As três contas sintéticas foram retiradas,
a RPC foi fechada e o preview foi republicado com a flag de cadastro desligada.
Não libera projetos reais. Fonte executada: `8eef6a2951c10fcff86407c5b19a32ce3f32640c`;
[PR #44](https://github.com/wcvmsilva/structr-ai/pull/44), integração final acompanhada no GitHub.
Base: `afb5a4bf675ac0f94de1e6d9f1ad15526888177b`; branch
`codex/homolog-intake-formation-proof`. Este registro sucede o gate de cadastro
do [ensaio de leitura](homolog-project-access-proof-2026-10-09.md), preservando
os recibos e manifestos anteriores.

## Autorização e artefato nominal

Após apresentação do diff e do alcance de BYPASSRLS, o responsável autorizou
literalmente: “Autorizo especificamente esse ajuste da migração 0018 com
BYPASSRLS, somente na homologação.” A revisão automática havia rejeitado três
tentativas por considerar as respostas anteriores genéricas. Nenhum patch foi
aplicado por outra via; a mesma ferramenta aceitou a alteração depois dessa
autorização específica. Ela não autoriza instalação em produção.

| Artefato | SHA-256 |
| --- | --- |
| Candidato histórico, preservado fora do journal | `135c5200dbcc32b0653d54f17721659dbf34ef2f747666640d28c6b8e49db5a0` |
| `drizzle/0018_authenticated_intake_formation.sql`, nominal | `a54e7a937eec72bf14110f890d4fc379ee414259135f3f070fee1ebc40991b75` |
| Companion operacional `homolog-close.sql` | `156c718c0c27c64c7a95e7f2da4d09d4b241c8b0463276efa7d947d84ba5ca94` |
| Companion operacional `homolog-open.sql` | `fb08db635be439f1f846afdae298ff80d3176eb20de2751b47a82e74e5aa8068` |

Somente o preflight nominal mudou. Os três comentários iniciais são avisos
históricos, superados pela disposição IF-1 e por este registro; o candidato não
foi regravado. Todos os bytes desde `CREATE ROLE structr_intake_create_owner_v1`
até o fim, incluindo runtime, grants e postflight, permanecem idênticos.

O preflight distingue o dispatcher confiável `authenticator`: seus privilégios
próprios e herdados continuam inspecionados, mas seus caminhos SET-only da
plataforma, inclusive `service_role` com BYPASSRLS, não são tratados como
privilégios dos usuários. Todos os caminhos SET/USAGE de `anon`/`authenticated`
continuam inspecionados. Quatro guards explícitos recusam caminhos diretos e
transitivos aos dois owners privados anteriores. As exceções de schema/função
passam a depender da origem `authenticated`, corrigindo a aceitação indevida de
`anon SET authenticated`. A herança desse papel já era recusada; seu teste é
controle de preservação, não outro defeito descoberto.

Isso altera deliberadamente o controle de instalação. A arquitetura continua
dependendo do gateway que verifica JWT e da ausência de SQL arbitrário exposto;
não se remove a membership interna da plataforma nem se coloca service role,
credencial SQL ou segredo de assinatura no processo web.

Revisão local independente confirmou o diff exato e não encontrou novos P1/P2
no reparo. O journal passa a ter 19 migrations; o schema Drizzle espelha o owner
existente e as duas policies de configuração da 0018. Isso não habilita RLS nas
tabelas de negócio nem lhes concede acesso bruto pela API.

## Evidência local e verificação somente leitura do destino

O RED completo teve três falhas esperadas e um controle aprovado: baseline de
dispatcher recusado, caminho anon SET aceito e identidade nominal ainda antiga.
Depois do patch, quatro suítes tiveram **168 aprovados, uma fixture histórica
externa ignorada e zero falhas**: 49 lifecycle, 67 RPC físicos, 11 schema e 41
inventário. São 31 casos novos distintos nessa frente: 29 físicos e dois offline;
os 87 testes físicos anteriores foram preservados e reexecutados. PostgreSQL
17.11/PostgREST 16.4 locais não atestam a versão do serviço hospedado.

Logs em `/private/tmp/structr-if1-promotion-20261009-5OPIwg/`:

- `dispatcher-complete-red.log`: `2877c4f96f67192a3fa0afb08ce21fc0f7bb13cc864d39d24852a57bedd90f52`.
- `dispatcher-complete-green.log`: `5684e52230e707ca1b8d3a2b738313f3ee01f3814847ca9b254f58dfe54658fe`.
- `dispatcher-final-source-and-cleanup.json`: `ba57f93b5a72c25f7f31ae84fbc80e8c6cbfa1a8a3eb0122abec4453e27f9f01`.

Os três diretórios de clusters foram confirmados removidos. O teste de schema
gerado compara as 16 policies efetivas e exige os três owners sem privilégios.
As provas de instalação/abertura/fechamento usam migrador não-superuser e o
baseline do dispatcher com SET-only `service_role`.

No projeto `wmspwegbqtzamkhxhusg` (`structr-ai-homolog`), o novo DO de preflight
foi executado em `BEGIN READ ONLY`: retornou `preflight_passed`, principal
`postgres`, `transaction_read_only=on`. Isso comprova compatibilidade do catálogo
naquele instante, não instalação, criação de negócio ou rollback hospedado.

## Incrementos já preparados nesta branch

`6f95dc5b` valida o comando completo antes de congelar UUID/payload na tela,
inclusive limites UTF-8 e NUL. A suíte focal teve 82 aprovados, sete novos.
Um erro local permanece corrigível; não vira resultado incerto de envio.

`096f4432` acrescenta o ciclo administrativo nominal de reativação/retirada,
com manifesto novo ligado aos manifestos históricos imutáveis. Cada transição
usa `db.transaction()` SERIALIZABLE e `logAudit(..., tx)`: cinco linhas de
identidade e seis audits, com replay sem duplicação e readback integral.
A frente teve 318 casos distintos aprovados, 47 novos, sem mudança no Auth.
Esse processo é separado do web; operador O e issuer não são alvos.

As três frentes somam **85 casos novos distintos**, sem transformar repetições
focais ou casos físicos ignorados na suíte padrão em novas aprovações. Tipos,
build, suíte padrão, CI e prova hospedada são gates separados, registrados abaixo.

## Sequência operacional delimitada

1. Congelar e publicar o código revisado após as verificações integradas;
   configurar somente o preview desta branch, sem herdar credenciais SQL/serviço.
2. Instalar nominal e companion close **na mesma transação**. Conferir ledger,
   catálogo, owner e ausência efetiva de EXECUTE antes de abrir qualquer janela.
3. Criar manifesto nominal novo com commit executado e IDs novos, preservando
   integralmente o manifesto anterior. Reativar as identidades sintéticas pelo
   runner auditado e verificar replay, histórico e operador O.
4. Abrir janela de homologação pelo companion revisado. Ela abrange todos os
   operadores atualmente elegíveis, inclusive O; não é allowlist só das contas
   sintéticas. Comprovar criação pela tela separadamente do probe tRPC/RPC.
5. Conferir conjuntos completos: cada formação cria um client, um project, um
   intake e três audits íntegros. Replay, conflito, identidade forjada e input
   inválido não criam outro registro. Resultado incerto não comprova rollback.
6. Retirar a autorização de cinco linhas (três perfis e dois tenants) **com a RPC ainda aberta**;
   provar recusa organizacional `42501/FORBIDDEN` com os mesmos bearers ainda
   válidos no Auth. Depois fechar a RPC, conferir ACL e encerrar sessões.

O probe público não é prova visual e declara `uiVerified:false`. Reenvio pela
tela exige resultado incerto da entrega, página preservada e o mesmo comando;
criação visual confirmada não demonstra esse caso. Reload perde o comando local.

Mesmo após IF-1 aprovado na homologação, continuam pendentes a jornada de escopo,
cálculo e referência financeira independente, aprovação, versionamento,
exportação e recuperação aplicável antes de liberar projetos reais.

## Execução hospedada e encerramento — 9 de outubro

O `pnpm check` passou sem erros, o build hospedado passou (permanece o aviso de
chunk acima de 600 kB) e o hook obrigatório do primeiro push passou **7.644 testes,
1.346 ignorados, zero falhas**, sem bypass. O [CI da fonte executada](https://github.com/wcvmsilva/structr-ai/actions/runs/37999555120)
passou. Os 168 passes focais/uma fixture ignorada acima são evidência separada;
não representam a execução de todos os testes ignorados na suíte padrão.

A nominal e o companion de fechamento foram instalados na **mesma transação**,
ledger `20261009223221`, SHA-256 do SQL agregado
`5a3a85d604fe564419699f991a3cf8ddde52e00d535e5d2340750c4b5faa092a`.
O catálogo inicial confirmou execução fechada para todos os caminhos SET/USAGE
da API, zero caminhos aos owners e owner sem LOGIN/INHERIT/BYPASSRLS. O migrador
ficou sem SET/USAGE efetivos no owner. A plataforma conserva uma membership
ADMIN-only de `postgres`, concedida por `supabase_admin`; não se afirma ausência
absoluta de memberships. Não houve alteração de produção nem envio de credencial
SQL, service role ou segredo de assinatura ao web.

O preview `structr-lxv3tetkq-wcvmsilvas-projects.vercel.app`, deployment
`dpl_4sWXC7Zi3pA4UtR4cT39kghZRiWz`, ficou READY na fonte `8eef6a29`. As 21 variáveis
desta branch foram conferidas: modo Data API, provedor Supabase e tenant estrito;
valores herdados de SQL/serviço foram mascarados somente no preview da branch.
As contas Auth existentes e suas senhas não foram alteradas.

O novo manifesto de ciclo tem hash
`2084957cb37c1a68828b8ab9212b8a40fdbb63725fea579c6813a8d2c827e2a1`, operação de
reativação `c62ad7f5-d5fa-4e4b-b750-8f201560dad3` e retirada
`1449d3ca-032d-40d1-8346-8ba5cc3f2653`. Os manifestos históricos permaneceram
intactos. Reativação e retirada geraram seis audits cada; seus replays retornaram
`replayed` sem duplicação. O observer administrativo usou transações REPEATABLE
READ/READ ONLY, com TLS verificado, leitura integral dos conjuntos de negócio
dos tenants sintéticos, hashes dos audits e hashes do perfil/tenant O e issuer.

| Etapa | Clients | Projects | Intakes | Audits |
| --- | ---: | ---: | ---: | ---: |
| Baseline | 1 | 1 | 0 | 24 |
| Reativação nominal | 1 | 1 | 0 | 30 |
| Cadastro pela tela | 2 | 2 | 1 | 33 |
| Cadastro pela RPC | 3 | 3 | 2 | 36 |
| Replay e entradas recusadas | 3 | 3 | 2 | 36 |
| Retirada, recusas posteriores e fechamento | 3 | 3 | 2 | 42 |

Os demais conjuntos de negócio ficaram iguais. O draft e a membership antigos
permaneceram presentes. As linhas anteriores, os audits históricos, O e o issuer
foram comparados por conteúdo/hash, não apenas por contagem. Cada formação nova
teve client/project/intake coerentes, snapshots completos nos três audits e o
mesmo instante de criação da transação. São fixtures sintéticas retidas, não
projetos operacionais nem referência financeira.

### Prova visual e prova de RPC são distintas

No navegador, A1 entrou no preview, abriu Intake e recebeu o erro local
`State: Use 2 characters or fewer.`. O campo continuou editável; após corrigir
para `SC`, a tela confirmou o intake `5abd424d-3433-4740-afe2-b93931e3fa87`, projeto
`4edc7c55-d81a-4cea-a523-0fdd03f8a02f`, status `draft`. O readback comprovou os três
registros e três audits. Screenshot e texto do recibo foram preservados; a sessão
do navegador foi encerrada. Essa prova exercitou o caminho UI/tRPC positivo.

O primeiro probe de tRPC autenticou A1/A2/B1 no Supabase, mas recebeu 401 no
preview e encerrou as sessões. O corpo daquela resposta não foi retido. Uma
consulta separada com token artificial confirmou 302, `Protected by Vercel
Authentication`, para o SSO da hospedagem; a primeira consulta que retornou 200
havia seguido esse redirecionamento. O readback confirmou ausência de outra
formação. A janela de escrita foi pausada durante o diagnóstico. Não se classifica
o 401 como prova de autorização de negócio, rollback ou defeito do Structr.

O probe seguinte usou exclusivamente Auth/RPC do Supabase, novas sessões e
**exatamente o mesmo UUID/comando/preimagem já salvo**, cujo arquivo tem SHA-256
`e49c21ef65ad20d77178b064ac9d82c84c120bf534c2a579776ba2c2dbef8b69`.
Não houve novo UUID após resultado incerto, mudança de proteção Vercel ou chave
de bypass. O decoder real aceitou o intake `e127ad91-c155-4c9e-9f23-175a6329d0d8`,
projeto `7114382c-f2fb-4f58-a65f-31851d3681a9`. As seis verificações passaram:
criação, replay exato, conteúdo alterado recusado, UUID de outro tenant recusado,
tenant forjado recusado e campo desconhecido recusado. Replay e recusas não
alteraram nenhum registro/audit observado.

Após retirada auditada **com a RPC ainda aberta**, cada uma das três contas teve
sessão protegida, replay e novo cadastro recusados com `42501/FORBIDDEN`: nove
recusas. `getUser` confirmou os mesmos bearers antes/depois, ainda com pelo menos
516 segundos de validade. As três sessões foram encerradas (`204`). Só depois
a RPC foi fechada. O readback final e o replay da retirada confirmaram 42 audits,
as cinco linhas sintéticas inativas, preservação dos dados e apenas O ativo.
Os recibos diretos mantêm `trpcVerified:false` e `uiVerified:false`; o observer
mantém suas limitações próprias. O resumo agrega essas provas, sem reescrevê-las.

### Contenção final, evidências e limites

O catálogo final confirmou nenhuma execução efetiva da nova RPC pelos caminhos
da API, zero caminhos aos owners e nenhum SET/USAGE temporário do migrador.
`STRUCTR_INTAKE_FORMATION_ENABLED=false` foi aplicado somente ao preview desta
branch; o novo deployment `dpl_8SETsb8HJCFUrUWs4TW5CKCASauK`,
`structr-qra8c36ps-wcvmsilvas-projects.vercel.app`, ficou READY na mesma fonte.
O deployment anterior é imutável, mas a RPC fechada bloqueia sua escrita.

Os advisors continuam com os mesmos três avisos informativos de tabelas H1
fechadas sem policies e oito avisos preexistentes de search path; nenhum novo
aviso foi observado. As [orientações de RLS](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)
e de [search path](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable)
continuam referenciadas para o trabalho correspondente, sem declarar o ambiente
inteiro livre de alertas.

O [resumo estruturado](homolog-intake-formation-proof-2026-10-09.json) registra
hashes das evidências locais em `/private/tmp/structr-intake-proof-round8-20261009/`.
Esses artefatos locais são temporários; o JSON versionado preserva o resultado
sanitizado e os hashes, não credenciais. Houve dois reparos no observer temporário:
gitlink de tooling vazio ancorado sem deixar de hashear 922 blobs (24 testes), e
transação oficial do Drizzle para manter SQL/ORM na mesma conexão (sete testes).
O probe direto teve quatro testes de transporte/comando e revisão independente.
Esses testes operacionais não aumentam os 85 casos novos do produto.

Não foram comprovados nesta rodada concorrência/rollback por falha injetada no
serviço hospedado, reenvio visual após perda de resposta ou recuperação após reload.
As provas físicas locais de transação continuam atribuídas ao laboratório.
Também não foram executados escopo, cálculo, aprovação, versionamento, exportação
nem recuperação por e-mail nesta rodada. O próximo incremento de produto deve
conectar o cadastro autenticado ao escopo/cálculo com a referência financeira
independente já documentada, mantendo validação, auditoria e isolamento; depois
fechar aprovação/versionamento/exportação e recuperação. A liberação real exige
a jornada hospedada aceita e a verificação do ambiente de produção.

A1/A2/B1 e os dois tenants sintéticos estão inativos; replay do ciclo encerrado
não os reativa. A próxima jornada exige preparação nominal auditada com manifesto
novo e revisão do contrato/fronteira de escopo e cálculo antes de abrir seus
writers. A exceção IF-1 atual não os autoriza.

## Completion report do recorte

Validação de runtime atribuída à fonte congelada `8eef6a29`; a atualização final
é documental. O hook e o CI da publicação final são acompanhados no PR #44.

| Requisito | Evidência |
| --- | --- |
| TypeScript | `pnpm check`: zero erros. |
| Tests | 7.644 aprovados, 1.346 ignorados, zero falhas na suíte padrão; 85 novos distintos no recorte, com físicos atribuídos separadamente. |
| Build | `pnpm build:vercel` aprovado; aviso de chunk permanece. |
| Files created / modified | 7 novos e 21 modificados, listados abaixo. |
| New tables | 0; `homolog_identity_cycle` é rótulo de recibo em `audit_logs`. |
| New engine functions | 0; reutiliza schema/serializer existentes. |
| New helpers | Scripts: `parseHomologIdentityCycleManifest`, `planHomologIdentityCycle`, `reactivateHomologReadProofIdentities`, `withdrawHomologReadProofIdentities`; nenhum helper de domínio DB novo. |
| New endpoints | Nenhum tRPC novo; promoção da RPC pública `structr_intake_create_v1(text)` e seus três helpers privados do candidato revisado. |
| Security | Nenhum endpoint de negócio público introduzido; o `intake.create` existente usa `tenantProcedure`, cujo guard exige usuário e tenant. A RPC revalida identidade/organização. Não é inventário global de endpoints. |
| Audit / transactions | SIM no recorte: ciclo usa `logAudit` e `db.transaction()` SERIALIZABLE; formação usa os três audits SQL obrigatórios na mesma transação conforme IF-1. |
| Regressions | Zero falhas observadas nas execuções atribuídas; skips não são passes. |

Arquivos novos:

- `docs/engineering/homolog-intake-formation-proof-2026-10-09.json`
- `docs/engineering/homolog-intake-formation-proof-2026-10-09.md`
- `docs/security/intake-formation/homolog-close.sql`
- `docs/security/intake-formation/homolog-open.sql`
- `drizzle/0018_authenticated_intake_formation.sql`
- `server/homolog-identity-cycle-physical.test.ts`
- `server/homolog-identity-cycle.test.ts`

Arquivos modificados:

- `README.md`
- `client/src/pages/Intake.tsx`
- `docs/adr/ADR-002-pilot-authenticated-database-boundary.md`
- `docs/engineering/current-state.md`
- `docs/engineering/intake-f2-f5-reconciliation-2026-10-09.md`
- `docs/security/intake-formation/contract-2026-10-08.md`
- `drizzle/meta/_journal.json`
- `drizzle/schema.ts`
- `plans/current-sprint.md`
- `scripts/homolog-access-runner.ts`
- `scripts/homolog-read-proof.md`
- `scripts/homolog-read-proof.ts`
- `server/adr002-intake-formation-migration-physical.test.ts`
- `server/adr002-intake-submission-ui.test.ts`
- `server/historical-estimate-schema-security.test.ts`
- `server/homolog-access-runner-physical.test.ts`
- `server/homolog-access-runner.test.ts`
- `server/migration-history-reconcile.test.ts`
- `server/test-support/adr002-postgrest.ts`
- `todo.md`
- `vercel.json`
