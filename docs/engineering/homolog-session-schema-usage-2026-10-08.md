# Homologação: diagnóstico da permissão de schema na sessão

**Estado — 8 de outubro de 2026, 18:23 UTC:** a correção 0016 foi aplicada na homologação; login real e perfil `user` foram resolvidos, e as cinco sondas negativas repetidas após DDL continuaram recusadas. Isolamento entre organizações, revisão com dados e jornada completa permanecem pendentes. Nenhum writer de negócio foi aberto e projetos reais continuam não liberados.

A PR #32 documental foi integrada em `2cb57c2b`, com CI `37822201757` concluída com sucesso. Seu [checkpoint anterior, às 17:57 UTC](homolog-access-coordination-2026-10-08.md#checkpoint-provisionamento-administrativo-aplicado--8-de-outubro-1757-utc), permanece como histórico. Este diagnóstico acrescenta a observação posterior de login e não substitui as provas de autorização pendentes.

## Evidência inicial da falha — 18:11 UTC

O registro privado `tmp/auth-homolog-20261008/administrative-provisioning/login-permission-failure.private.json` reúne observações de Auth, gateway, PostgreSQL e catálogo, até **18:11:15 UTC**. Não contém bearer. Identificadores pessoais e dados de login não são reproduzidos neste documento.

| Observação | Resultado |
| --- | --- |
| Supabase Auth, 18:05:15 UTC | Login registrado, e-mail confirmado, audience e papel `authenticated`; endpoint de token com HTTP 200. |
| Metadados do JWT nos logs das chamadas de sessão | ES256, issuer esperado, subject correspondente ao operador e `exp - iat = 600` segundos. Não houve coleta do token. |
| RPC `structr_authenticated_session_v1`, duas tentativas | HTTP 403, `PostgREST; error=42501`. |
| PostgreSQL, 18:05:16 e 18:06:50 UTC | `permission denied for schema public`, SQLSTATE `42501`, conexão `authenticator`, aplicação PostgREST 14.18. |
| Catálogo, 18:09:37 UTC | `authenticated` possui EXECUTE na RPC de sessão, mas não USAGE em `public`. `anon` e `authenticator` também não têm USAGE. O owner privado possui USAGE; nenhum desses quatro papéis possui CREATE em `public`. SELECT bruto de `profiles` por `authenticated` permanece ausente. |
| Inventário, 18:11:15 UTC | Privilégios EXECUTE em `public` limitados às duas RPCs previstas; nenhuma relação pública acessível no recorte consultado. |

As fontes são complementares: gateway registra requisições HTTP; PostgreSQL registra a recusa de privilégio. Campos ausentes em um evento não anulam os campos presentes em outro. A [referência oficial de campos de logs do Supabase](https://supabase.com/docs/guides/observability/log-field-reference) descreve essas fontes e seus limites. Os resultados acima são observações locais preservadas no registro privado, não garantias derivadas da documentação.

O ambiente hospedado usa **PostgreSQL 17.11 / PostgREST 14.18**; o laboratório local anterior usou **PostgreSQL 17.11 / PostgREST 16.4**. O diagnóstico inicial de ACL antecedeu a prova positiva descrita abaixo e não demonstrava equivalência entre as versões ou isolamento SERIALIZABLE efetivo na chamada hospedada.

## Causa e lacuna da prova anterior

A [migração 0015](../../drizzle/0015_authenticated_review_boundary.sql#L128) concede USAGE em `public` e `structr_private` ao owner dedicado. Os [grants das entradas](../../drizzle/0015_authenticated_review_boundary.sql#L503) concedem EXECUTE a `authenticated`, mas não concedem USAGE em `public` a esse papel. PostgreSQL exige que a permissão do objeto e a permissão de acesso ao schema sejam satisfeitas; USAGE permite localizar objetos no schema sem conceder os privilégios próprios desses objetos. [PostgreSQL 17: privilégios](https://www.postgresql.org/docs/17/ddl-priv.html).

O [harness PostgREST anterior, fixado em `2cb57c2b`](https://github.com/wcvmsilva/structr-ai/blob/2cb57c2b/server/test-support/adr002-postgrest.ts#L132-L137), concedia explicitamente USAGE em `public` a `anon` e `authenticated` antes de instalar a fronteira. Além disso, o [bootstrap do cluster local](../../server/test-support/app-principal-postgres.ts#L313) retirava CREATE de PUBLIC, conservando seu USAGE herdado. Essa preparação mascarava o requisito ausente na baseline hospedada mais restritiva. Remover somente o grant explícito do harness não reproduz a falha enquanto PUBLIC conservar USAGE. O harness corrigido retira USAGE de PUBLIC e dos três papéis API; a migração fornece a permissão explicitamente.

Os campos opcionais nulos do perfil, o papel `user` e a lista de permissões vazia são aceitos pelo [decoder de sessão](../../server/authenticated-data-api.ts#L24). Não explicam esta recusa. O [contexto do servidor](../../server/_core/context.ts#L57) transforma a falha da RPC em ausência de usuário, e `auth.me` retorna `null`; a interface exibe conta indisponível mesmo com sessão Auth existente. O erro identificado antecede a resolução bem-sucedida do perfil.

## Correção delimitada

O agente responsável pelo laboratório implementou a migração incremental [0016](../../drizzle/0016_authenticated_public_schema_usage.sql), preservando os bytes da `0015` já aplicada. Seu efeito é somente USAGE em `public` para `authenticated`, condicionado a preflight dos privilégios efetivos, das entradas permitidas e da autoridade do executor para conceder o privilégio. Não concede privilégios a PUBLIC, `anon` ou `authenticator`, CREATE, acesso bruto, alteração de RLS ou novas rotas. O processo web continua sem credencial SQL, service key ou segredo de assinatura.

É uma correção de ACL de namespace, não uma alteração de tabelas, colunas ou policies. Portanto, não exige alteração estrutural em `drizzle/schema.ts`; exige migração versionada, journal e prova física do catálogo. O [snapshot estrutural existente](../../scripts/migration-schema-snapshot.sql#L3) exclui ACL de seu escopo e não substitui essa prova. DDL administrativo não abre um writer de negócio nem altera os requisitos de auditoria das mutações do produto.

## Provas locais concluídas

Evidências privadas em `/private/tmp/structr-schema-usage-20261008-GeSk8O/`, produzidas em PostgreSQL 17.11 / PostgREST 16.4:

| Etapa | Resultado observado | Registro |
| --- | --- | --- |
| RED de sessão | Uma falha comportamental: JWT ES256 sintético válido recebeu HTTP 403 / `42501`, `permission denied for schema public`, onde o teste exigia sessão resolvida. | `red.log`, `red.json` |
| RED de preflight | 15 casos de privilégios incompatíveis não foram recusados pela candidata inicial; outros 12 passaram. | `preflight-red.log`, `preflight-red.json` |
| RED de autoridade do executor | Um caso falhou porque a reexecução não recusava executor sem poder de grant quando USAGE já existia; um controle passou e 27 casos ficaram fora dessa execução focal. | `executor-red.log`, `executor-red.json` |
| GREEN final físico | **96 passaram: 29 novos e 67 existentes; zero falhas; dois casos RED históricos opcionais ignorados.** | `final-green.log`, `final-green.json` |
| TypeScript | `pnpm check` concluído pelo integrador com exit 0. | `typecheck.log` |
| Inventário de migrations | RED com três falhas e 37 passes ao introduzir a 17ª migration; GREEN focal posterior com **40 passes**, atualizando as expectativas do inventário legado. | `history-red.log`, `history-green.log` |
| Limpeza e fontes | Diretórios dos clusters removidos, nenhum processo próprio restante e hashes das fontes preservados. | `cleanup-and-source-readback.json`, `final-source-hashes.txt` |

O GREEN cobre a sessão HTTP, revisão autorizada e recusas A2/B1 existentes, isolamento de namespace, tabelas brutas e helpers privados inacessíveis, grant único sem grant option, ACLs de tabela/coluna inalteradas, rollback e reexecução. Também comprova execução por não-superuser com autoridade de grant delimitada e recusa de executor sem essa autoridade. A falha inicial de preparação do sandbox, preservada em `initial-sandbox-startup.log`, não conta como RED comportamental.

SHA-256 da `0016` testada: `3c71f95cff486119d2367667e54be1dbd3b1ce0e8b8cc7a4ddb0a1259e78d542`. A `0015` permanece intacta: `88fcc8c3627f7bc041f1664ad3218c9669fed8bdaf80818aa083df9286c06241`.

## Aplicação hospedada e primeiro login — 18:20 UTC

A migração `structr_0016_authenticated_public_schema_usage`, versão `20261008182017`, foi aplicada pelo integrador com SHA-256 `3c71f95cff486119d2367667e54be1dbd3b1ce0e8b8cc7a4ddb0a1259e78d542`. O recibo privado `tmp/auth-homolog-20261008/administrative-provisioning/hosted-schema-usage-execution.json` preserva a aplicação, readbacks, logs de sessão e observação da interface.

O readback das **18:20:26 UTC** confirmou USAGE em `public` para `authenticated`, ausente para `anon` e `authenticator`. CREATE em `public` e acesso ao schema privado permaneceram ausentes para os três papéis. SELECT bruto de `profiles` continuou ausente; somente `structr_authenticated_session_v1()` e `structr_internal_approval_review_v1(jsonb)` conservaram EXECUTE para `authenticated` no schema `public`; isso não é um grant ao papel PUBLIC. A comparação antes/depois confirmou hashes de funções e policies inalterados e as mesmas contagens: **um perfil, quatro auditorias, zero clientes, projetos ou drafts**.

Entre **18:20:41 e 18:20:50 UTC**, nove chamadas à RPC de sessão retornaram HTTP 200. Os metadados observados nos logs registraram ES256, papel `authenticated`, correspondência do subject ao operador e TTL original de 600 segundos. O navegador alcançou o Dashboard com role `user`; nenhum bearer foi coletado. A captura privada comprova a chegada à tela e o perfil observado. Seus rótulos legados MySQL/CSV ready não comprovam tecnologia do banco nem exportação ativa: o contrato de allowlist e os gates de cada operação continuam sendo a autoridade.

Os advisors antes/depois conservaram os mesmos grupos e contagens: três INFO de RLS sem policies, oito WARN de search_path mutável e um WARN de proteção contra senhas vazadas desativada. Portanto, este registro não afirma zero alertas ou sua resolução. A 0016 não ampliou funções, tabelas ou policies.

### Negativos repetidos após DDL — 18:23 UTC

O registro privado `/private/tmp/structr-homolog-access-20261008/post-schema-usage-negative-probes.json`, às **18:23:03 UTC**, confirmou novamente as cinco recusas:

| Sonda | Resultado |
| --- | --- |
| RPC de sessão anônima | HTTP 401, `42501` |
| JWT forjado com kid inexistente | HTTP 401, `PGRST301` |
| JWT forjado com kid publicado | HTTP 401, `PGRST301` |
| Leitura anônima de `profiles` | HTTP 401, `42501` |
| Leitura anônima de `projects` | HTTP 401, `42501` |

Não houve arrays de dados nem uso de JWT real nessas sondas. São repetições dos cinco controles anteriores para comprovar preservação após a nova DDL, não dez controles distintos. Os negativos não identificam o ramo criptográfico interno nem substituem o positivo de sessão observado separadamente.

## Gates ainda pendentes

1. Regressão global do produto no pre-push e publicação validada. A revisão independente aprovou o recorte SQL; os 96 casos físicos e os 40 focais do inventário não substituem a suíte completa, cujo resultado será registrado na PR desta correção.
2. Isolamento entre organizações, revisão autenticada com dados e demais provas de sessão/autoridade, incluindo expiração, retirada de acesso e troca de identidade no serviço hospedado.
3. Leituras mínimas do produto, formação, aprovação, versionamento e exportação pela jornada completa, com aceitação e recuperação comprovadas antes de liberar projetos reais.

A fase de primeiro login e perfil está comprovada. Esse resultado não abre writers, não encerra a homologação da jornada e não libera uso real.
