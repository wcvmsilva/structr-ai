# ADR-002 — implementação do primeiro recorte autenticado

Data: 7 de outubro de 2026. Base: `5d97c5ec61d50f39909c5ea0b3d5d92b535f29f1`.

**Recorte implementado, regressão local fechada e migração instalada na homologação com acesso ainda fechado. Publicação em andamento. Piloto e produção não liberados.**

## Limite desta entrega

Modificar a consulta existente `estimate.getInternalApprovalReview` para usar uma operação nomeada através da Data API autenticada. O recorte exige permissão `approve`, embora não grave negócio. Bootstrap de identidade também precisa usar a Data API: o fluxo anterior depende do pool SQL e não satisfaz a ADR.

O modo explícito `STRUCTR_DATABASE_MODE=authenticated-data-api` permitirá somente a superfície de sessão necessária e a consulta de revisão. Demais procedimentos serão recusados antes dos helpers. Nesse modo, conexão SQL, chave de serviço, segredo de assinatura e fallback legado serão recusados; o modo anterior permanece separado. Nenhuma falha de RPC selecionará o caminho anterior.

## Contrato de identidade e banco

- Duas operações públicas fixas: `structr_authenticated_session_v1()` e `structr_internal_approval_review_v1(command jsonb)`.
- O comando de revisão contém somente `id` e `confirmedCurrencyCode: "USD"`; actor e tenant vêm do vínculo protegido entre subject e perfil ativo.
- A entrada PostgREST valida a assinatura. As rotinas verificam issuer/audience, subject, papel de sessão comum, ausência de login anônimo, formato de `session_id`, emissão e expiração. A duração original e restante do JWT é limitada a 900 segundos. O formato de `session_id` não é prova de sessão ainda ativa.
- Configuração de issuer/audience fica em schema privado sem grants ao runtime. Instalação sem configuração permanece fechada.
- Funções privilegiadas têm owner dedicado NOLOGIN/NOBYPASSRLS, não proprietário das tabelas, search_path fixo e EXECUTE público revogado. Privilégios de coluna necessários aos locks pertencem somente ao owner da rotina.
- A prova usa `session_user=authenticator`, papel autenticado, POST, VOLATILE e SERIALIZABLE. Repetir a chamada inteira no máximo três vezes somente em `40001`/`40P01`.
- Cada nova operação confere o perfil/tenant e todas as fontes aplicáveis de autoridade organizacional. Desativar o perfil ou tenant impede novas operações; retirar uma membership não retira uma permissão concedida por outra fonte válida. Chamadas já em curso conservam o snapshot serializável e seus locks; a expiração é conferida novamente após esperas antes do retorno.
- Logout, banimento ou exclusão apenas no Supabase Auth não cancelam imediatamente um JWT já emitido. O limite é sua expiração, no máximo 900 segundos; retirada imediata de acesso organizacional exige desativação do vínculo protegido. Não há acesso, grant ou policy em `auth.*`. A configuração padrão de uma hora será recusada; TTL compatível e sessões reais precisam de prova na homologação antes da abertura.

O desenho inicial consultaria as tabelas internas Auth para revogação imediata. A inspeção de catálogo constatou ownership/RLS que a conta disponível não pode alterar. A revisão automática também rejeitou a primeira tentativa de criar esse SQL local por privilégios considerados amplos. A alternativa reduzida passou pela revisão independente e sua escrita local foi aceita: somente colunas de negócio necessárias, papel privado sem login/bypass e preflight que recusa privilégios ou políticas incompatíveis sem revogar objetos externos. A aprovação da escrita local não é aplicação de DDL nem prova de autorização em ambiente hospedado. Ver [matriz exata e limites](adr002-review-grants-design-2026-10-07.md).

## Autorização e conteúdo

Preservar project → draft, locks de perfil/tenant/cliente e ACL, precedência de admin do mesmo tenant → owner → membership → RBAC, recusa de membership contraditória e ausência de fallback quando a membership ativa não concede aprovação.

Preservar as duas arestas de linhagem, o limite de 1.000 drafts, ciclos, ancestrais ausentes ou fora do contexto e vínculos históricos. RLS não pode ocultar contradições. Políticas específicas do definer garantem a visibilidade necessária sem abrir tabelas ao papel autenticado; o `row_security=off` da migração 0010 permanece intacto.

A RPC retorna projeções explícitas dos oito conjuntos consumidos pelo adaptador, mais evidências A1 existentes e o resultado do normalizador SQL de origem. Decimais SQL são texto, datas tipadas têm formato UTC explícito, JSON persistido mantém tipos e ordem. Dados de contexto contraditório causam recusa antes do retorno. O servidor valida o envelope fechado, as evidências e os hashes com as regras existentes antes de calcular a revisão pelo motor puro. A revisão não autoriza aprovação futura.

## Provas e ordem de execução

1. Registrar esta decisão e preparar branch isolada.
2. Escrever testes de comportamento e observar RED antes da implementação correspondente.
3. Implementar transporte, contenção do runtime, DTO e operação SQL com testes separados.
4. Executar PostgreSQL/PostgREST locais reais com chaves assimétricas efêmeras e papéis restritos; contexto SQL colocado manualmente não é prova do vínculo JWT → banco.
5. Validar A1 autorizado, A2 sem permissão, B1 de outra organização, adulteração/expiração e retirada de acesso organizacional, chamadas diretas, contexto entre requisições, locks e tentativas concorrentes. Distinguir essas provas do logout Auth com JWT ainda válido.
6. Executar TypeScript e suíte completa; obter revisão técnica independente e integrar via PR somente após evidências satisfatórias.
7. Repetir as provas no ambiente isolado `structr-ai-homolog` com sessões reais antes de qualquer abertura. Credenciais, catálogo, contas e permissões novas exigem bootstrap explícito, auditado e verificável.

Este primeiro recorte não inclui aprovação, revogação, versionamento ou exportação pelo caminho novo. A jornada completa e o primeiro projeto real dependem das integrações e provas seguintes.

## Evidência local de 7 de outubro

As provas usam PostgreSQL 17.11 e PostgREST 16.4 reais, chaves ES256 efêmeras e dados sintéticos. Não há conta Auth hospedada, segredo remoto nem execução cloud nos laboratórios. O guia de reprodução está em [test-support](../../server/test-support/adr002-postgrest.md).

| Prova | Resultado observado | Evidência local |
| --- | --- | --- |
| HTTP/JWT, ACL A1/A2/B1, TTL, contenção, pool, concorrência e retry | 67 passaram; 2 RED históricos opcionais ignorados | `/private/tmp/structr-adr002-final-http-umscxuhn/` |
| Metadata ORM/SQL, dez policies, cinco tabelas RLS do recorte, A1/H1 e normalizador frozen | 17 passaram | `/private/tmp/structr-adr002-record-evidence-lbvcv78e/` |
| Instalação por migrador não-superuser, retirada de capacidade temporária, manutenção e rollback integral | 4 passaram | `/private/tmp/structr-adr002-principal-6cI8i8/` |

São **88 testes físicos novos distintos**, não somados novamente à suíte padrão, que os ignora por opt-in. A migração final testada tem SHA-256 `88fcc8c3627f7bc041f1664ad3218c9669fed8bdaf80818aa083df9286c06241`. Os três laboratórios comprovaram encerramento dos processos e remoção dos clusters temporários.

O teste de transporte troca somente o destino HTTPS sintético pelo serviço loopback; bearer, corpo, resposta, verificação criptográfica, locks, SQLSTATE 40001 e retry são reais. Não comprova TLS ou comportamento da versão hospedada. O teste de migração executa como `current_user` sem superuser, CREATEROLE e owner das tabelas dentro de sessão supervisora isolada; não se apresenta como login real do provedor.

RED de implementação observado: RPCs ausentes; decoder/envelope e integração da rota ainda sem o novo comportamento; GRANT emitido depois da transferência de ownership, recusado pelo migrador restrito. A correção final preserva os privilégios e antecipa esses grants à transferência. Falhas de preparação dos laboratórios estão identificadas nos respectivos registros e não contam como RED funcional.

Revisões independentes também corrigiram autorização indevida de membership com `permissions=NULL`, classificação de evidência A1 após alteração da política atual e tratamento de contexto contraditório. A consulta usa a validação existente de evidências/hash e o motor financeiro existente. Não há novo cálculo financeiro nem mutation de negócio neste recorte.

## Regressão e relatório do recorte

- `pnpm check`: zero erros (`tmp/auth-foundation-20261006/adr002-regression-typecheck.log`).
- `pnpm test`: **6.703 passaram, 981 ignorados, zero falhas**, em 188 arquivos aprovados e 35 ignorados; execução iniciada às 18:45:53 local, duração 159,27 segundos (`adr002-regression-closed.log`). Os testes opt-in não foram contados como aprovados nessa execução.
- Há **186 novos testes na suíte padrão**, comparados aos 6.517 da base. Separadamente: 88 novos casos físicos ADR-002 e dois novos casos físicos do gerador de schema, sem dupla contagem. Os laboratórios operacionais/reabertura preservaram 82 casos aprovados e dez skips históricos intencionais.
- `pnpm build:vercel`: aprovado (`adr002-final-build.log`); permanece o aviso de tamanho de chunks. Isso não é deploy.
- Revisão técnica independente final: nenhum novo bloqueador no transporte, contexto, DTO, A1/H1, locks ou privilégios. SQL final também foi repetida no teste HTTP após a correção do migrador restrito.
- Nova tabela: `structr_private.authenticated_boundary_config`. Dez policies representadas no ORM e comprovadas no PostgreSQL. Nenhum motor novo; motor financeiro existente preservado. Novos helpers principais: `getAuthenticatedDataApiSession`, `callAuthenticatedReview`, `buildAuthenticatedInternalApprovalReview`; validação de evidência existente extraída sem alterar seus controles. Endpoint de negócio existente continua protegido e valida entrada com Zod.
- Audit: nenhuma nova mutation de negócio. As operações SQL são consultas transacionais com locks; mutations anteriores conservam seus caminhos. Nenhuma regressão conhecida ficou aberta neste recorte.

A suíte geral inicialmente revelou uma importação com efeito de startup, contagem antiga de migrations e expectativas anteriores à policy H1. Foram corrigidas, preservando falhas e logs anteriores. Os laboratórios de reabertura agora usam corretamente a base histórica 0000–0011; o operacional continua aplicando todas as migrations, incluindo 0015 após contenção explícita somente no laboratório.

O gerador de schema preserva todo o DDL atual e recebe um pré-requisito explícito para o role `.existing()` apenas após conferir o banco vazio e pertencente ao laboratório. Os dois testes físicos provaram rollback sem esse papel e criação completa com ele: 90 tabelas públicas, uma privada, dez policies, sem grants, memberships, RPCs ou triggers adicionados por esse preparo. Evidência: `adr002-generated-schema-{red,green}.log`; o grupo focal passou 42 testes e ignorou um teste que depende de configuração externa.

O verificador real do laboratório também foi corrigido para os contratos atuais de revisão e exportação: execução `tmp/ed-pilot/p2/ed-pilot-U4kjh7` terminou com código zero e cleanup confirmado. A fixture incompleta recebe `PRECONDITION_FAILED` na revisão e `INTERNAL_APPROVAL_CONTENT_UNRESOLVED` na exportação; a tentativa bloqueada foi persistida e o draft ficou integralmente igual. Aprovação não foi exercitada; não se usa uma rejeição Zod como evidência de regra de negócio. Essa é uma prova local legacy, distinta da autenticação Supabase hospedada.

## Homologação: instalação fechada

Às **22:48:47 UTC**, a ferramenta Supabase aplicou somente a migração `structr_0015_authenticated_review_boundary` no projeto isolado. O ledger registrou versão `20261007224847`, uma entrada SQL, cujo SHA-256 é exatamente o da migração testada. O catálogo pós-instalação confirmou **91 tabelas, oito tabelas RLS e dez policies ADR-002**, role dedicado sem login/bypass e zero acesso desse role às tabelas Auth. `authenticated` executa somente as duas funções públicas; `anon` e `authenticator` não executam função pública alguma nem assumem o owner ou acessam o schema privado.

A configuração privada, perfis, usuários Auth e projetos continuaram vazios. Quatro probes reais receberam HTTP 401: sessão anônima, revisão anônima e tabela de projetos (`42501`), e sessão com assinatura inválida (`PGRST301`). A [evidência sanitizada](adr002-homolog-boundary-2026-10-07.json) contém catálogo e resultados sem credenciais. Não houve alteração de configuração Auth, deploy da aplicação, prova positiva com usuário hospedado ou mudança em produção.

## Próximo gate hospedado

O projeto isolado é `structr-ai-homolog` (`wmspwegbqtzamkhxhusg`). A configuração privada continua vazia após 0015; a instalação não habilita revisão. A abertura ainda exige bootstrap auditado do issuer e dos vínculos protegidos; sessões reais com TTL compatível; A1 autorizado, A2 sem permissão e B1 de outro tenant; negações por expiração/adulteração/retirada de autoridade; prova de isolamento SERIALIZABLE no PostgREST hospedado e recuperação documentada. O projeto de produção não participa desta etapa.

Somente após esse gate a próxima integração deve habilitar individualmente as operações de aprovação, revogação, versionamento e exportação, preservando transação e audit durável. A jornada completa com um projeto real ainda não foi validada.

## Inventário da entrega

Criados (20):

- `docs/engineering/adr002-homolog-boundary-2026-10-07.json`
- `docs/engineering/adr002-review-access-2026-10-07.md`
- `docs/engineering/adr002-review-grants-design-2026-10-07.md`
- `drizzle/0015_authenticated_review_boundary.sql`
- `server/_core/database-mode.ts`
- `server/adr002-data-api-physical.test.ts`
- `server/adr002-migration-principal-physical.test.ts`
- `server/adr002-review-envelope.test.ts`
- `server/adr002-review-evidence.test.ts`
- `server/adr002-review-record-physical.test.ts`
- `server/adr002-review-router.test.ts`
- `server/adr002-review.fixtures.ts`
- `server/adr002-router-guard.test.ts`
- `server/adr002-runtime.test.ts`
- `server/adr002-transport.test.ts`
- `server/authenticated-data-api.ts`
- `server/authenticated-internal-approval-review.ts`
- `server/test-support/adr002-fixtures.ts`
- `server/test-support/adr002-postgrest.md`
- `server/test-support/adr002-postgrest.ts`

Alterados (26):

- `README.md`
- `docs/adr/ADR-002-pilot-authenticated-database-boundary.md`
- `docs/engineering/current-state.md`
- `docs/security/g4b-catalog-ownership/2026-09-17-design.md`
- `drizzle/meta/_journal.json`
- `drizzle/schema.ts`
- `plans/current-sprint.md`
- `scripts/ed-pilot-lab/app.ts`
- `server/_core/application.ts`
- `server/_core/context.ts`
- `server/_core/env.ts`
- `server/_core/trpc.ts`
- `server/a1-operational-reductions-postgres.test.ts`
- `server/auth-router.ts`
- `server/db.ts`
- `server/estimate-router.ts`
- `server/historical-estimate-schema-security.test.ts`
- `server/internal-estimate-approval-adapter.ts`
- `server/internal-estimate-approval-db.ts`
- `server/migration-history-reconcile.test.ts`
- `server/project-geocode-review-evidence.ts`
- `server/project-reopen-product-physical.test.ts`
- `server/project-reopen-provenance-regression-control.test.ts`
- `server/test-support/ed-pilot-lab.ts`
- `shared/domain/taxonomy.ts`
- `todo.md`
