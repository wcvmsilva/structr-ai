# ADR-002 — desenho mínimo de privilégios para revisão

Data: 7 de outubro de 2026. **Desenho implementado e revisado, com provas físicas locais aprovadas; este documento não autoriza abertura do piloto.** O arquivo local [0015](../../drizzle/0015_authenticated_review_boundary.sql) concretiza a alternativa reduzida. As seções de proposta abaixo preservam as decisões e os limites; o [registro de execução](adr002-review-access-2026-10-07.md#evidência-local-de-7-de-outubro) identifica 88 testes físicos distintos aprovados, incluindo as provas de wrappers, normalizador, claims, privilégios e rollback aqui solicitadas. Compatibilidade hospedada e configuração Auth permanecem gates separados.

A direção Data API da ADR-002 foi aprovada. O desenho inicial de implementação que consultaria `auth.users` e `auth.sessions` não foi aprovado em detalhe: a revisão automática bloqueou a criação do arquivo SQL local. Após reduzir materialmente a ação, eliminando acesso a Auth e grants amplos, a ferramenta permitiu criar somente o arquivo local 0015. Isso não comprova a segurança da implementação nem autoriza aplicação cloud. Este documento identifica os limites e as provas ainda necessárias.

## Capacidade observada e alternativa de sessão

Inspeção somente de catálogo em `structr-ai-homolog` encontrou `auth.users` e `auth.sessions` com RLS habilitado, sem políticas, pertencentes a `supabase_auth_admin`. A conexão de inspeção era `postgres`, sem superuser, sem membership e sem capacidade de SET ROLE para esse proprietário. Ter SELECT/UPDATE próprios não concede o poder de criar políticas: PostgreSQL exige ownership para essa operação. Não se propõe contornar isso com definer `postgres`, BYPASSRLS ou alteração de tabelas Auth. [Regra PostgreSQL](https://www.postgresql.org/docs/17/sql-createpolicy.html).

**Alternativa proposta:** nenhuma leitura, grant, política, trigger, função ou ownership em `auth.*`. A Data API valida a assinatura; cada operação valida novamente claims e resolve perfil/tenant/RBAC protegidos nas tabelas de negócio. Logout, exclusão ou bloqueio apenas no Supabase Auth não cancelam retroativamente um access token já emitido. Para bloquear imediatamente novas operações organizacionais, desativar o perfil/tenant ou revogar a permissão protegida; a operação seguinte verifica esse estado sob locks. Operações já iniciadas mantêm a semântica serializável, sem promessa de cancelamento retroativo.

O Supabase documenta que access tokens são curtos e que a expiração pode ser configurada; o padrão é uma hora. Também recomenda ajustar a expiração quando a aplicação não precisa consultar o estado de sessão para invalidar imediatamente tokens após logout. Valores inferiores a cinco minutos são desaconselhados. Uma configuração do provedor ainda precisa ser escolhida, aplicada por bootstrap autorizado e verificada; este documento não altera essa configuração. [Sessões Supabase](https://supabase.com/docs/guides/auth/sessions).

Política de claims proposta, baseada no relógio do banco:

- Issuer exato da configuração privada; audience `authenticated` como string ou presente em array somente de strings.
- Subject UUID canônico não nulo/zero; papel exatamente `authenticated`; `is_anonymous` booleano exatamente falso. `session_id` UUID pode ser validado como formato de token Supabase, mas não comprova sessão ainda ativa.
- `iat` e `exp` obrigatórios, números inteiros representáveis com segurança; diferença estritamente positiva de no máximo 900 segundos.
- `exp` estritamente posterior ao relógio atual e no máximo 900 segundos à frente. Conferir novamente após esperas, antes do retorno. Não conceder tolerância após expiração.
- Tolerância proposta de até 30 segundos somente para `iat` futuro. `nbf`, quando presente, deve ser inteiro e não futuro. A regra estrita de `exp` prevalece sobre essa tolerância.
- Um emissor adiantado com TTL exatamente 900 segundos pode produzir recusa temporária pela regra de prazo restante. A abertura exige prova dos relógios e tokens reais; configurar um TTL abaixo do teto deixa folga sem aumentar o teto. Não presumir que a configuração padrão de uma hora serve: esses tokens devem ser recusados mesmo perto de expirar, por `exp - iat`.

O Supabase documenta `iat`, `exp`, subject, papel, `session_id` e `is_anonymous`, além de audience string ou array. O teto de 900 segundos e a tolerância de emissão são escolhas locais desta proposta, não garantias do provedor. [Claims Supabase](https://supabase.com/docs/guides/auth/jwt-fields).

## Papéis, schemas e operações

- Papel dedicado proposto: `structr_review_owner_v1`, NOLOGIN, NOINHERIT, NOBYPASSRLS, sem superuser/CREATEROLE/CREATEDB/REPLICATION, sem ownership de tabelas ou membership privilegiada. Os papéis de API e o login web não podem assumir esse papel.
- Schema privado proposto: `structr_private`, pertencente ao principal de migração; runtime sem CREATE nem USAGE nele. O definer recebe USAGE; eventual privilégio temporário necessário à transferência de funções deve ser retirado na mesma migração.
- No PostgreSQL 17, o criador não-superuser recebe automaticamente ADMIN sobre o papel novo, sem SET nem INHERIT, por grant do bootstrap superuser. A migração retira somente sua membership temporária adicional; preserva essa administração padrão para futuras janelas explícitas de manutenção. Nenhum papel de API recebe essa capacidade. [Semântica PostgreSQL](https://www.postgresql.org/docs/17/role-attributes.html).
- Duas funções públicas fixas, invoker: `structr_authenticated_session_v1()` e `structr_internal_approval_review_v1(command jsonb)`. Somente `authenticated` pode executá-las. Sem acesso bruto a tabelas, sequências ou outras rotinas de negócio.
- Duas entradas privadas definer executam a operação completa. Helpers privados de validação, datas e permissões são executáveis somente pelo definer.
- Um wrapper invoker requer EXECUTE na entrada privada transitiva. A proposta usa corpo SQL vinculado na criação e não concede USAGE do schema privado ao usuário. Isso precisa de prova física: wrapper público funciona; chamada direta privada e exposição da função privada pela Data API falham. Não declarar essa propriedade comprovada antes do teste.
- Objetos qualificados, search_path fixo somente em `pg_catalog`, sem SQL dinâmico nas operações, sem setters de claims, tenant, tabela ou papel.
- Requerer conexão `session_user=authenticator`, papel efetivo de entrada `authenticated`, POST, função VOLATILE, transação de leitura/escrita para locks e isolamento SERIALIZABLE efetivo. O transporte repete a chamada inteira no máximo três vezes somente em serialization failure/deadlock.

Dependências frozen executáveis somente pelo definer, caso o preflight encontre EXECUTE público já retirado: `internal_approval_draft_matches_v1(estimate_drafts,jsonb,boolean)`, `internal_approval_trim_v1(text)`, `internal_approval_legacy_number_v1(jsonb,integer)`, `internal_approval_pricing_channel_v1(text)`, `internal_approval_channel_v1(text)` e `internal_approval_lookup_key_v1(text)`, todas no schema `public`. Elas são necessárias ao resultado `sourceMatches`; não se concede execução dessas primitivas ao papel autenticado. Não é necessário conceder a função de linhagem SQL antiga: os locks de ancestrais da revisão exigem a sequência SHARE própria já especificada.

## Matriz exata de leitura proposta

Todos os nomes abaixo são colunas físicas. A permissão de leitura é por coluna, não um grant em todas as tabelas. **Cada tabela bloqueada também precisa de UPDATE somente na coluna `id`, exclusivamente para o definer.** PostgreSQL exige esse privilégio até para FOR SHARE/KEY SHARE. O corpo das duas operações não executa DML. [Privilégios de SELECT com locks](https://www.postgresql.org/docs/17/sql-select.html).

| Tabela | Colunas de leitura | Motivo |
| --- | --- | --- |
| `structr_private.authenticated_boundary_config` | `id, issuer, audience, deleted_at` | Configuração de confiança; uma linha, inicialmente ausente, leitura sob SHARE. |
| `profiles` | `id, tenant_id, external_open_id, email, login_method, full_name, company_name, role, is_active, last_signed_in, created_at, updated_at` | Resolução de identidade, perfil próprio de `auth.me`, ACL e autores de evidências. |
| `tenants` | `id, is_active` | Tenant ativo sob SHARE. |
| `projects` | `id, tenant_id, client_id, owner_user_id, deleted_at, commercial_channel, channel, geo_risk_class, address, city, state, zip, county, latitude, longitude, geocoded_at, geocode_confidence, geocode_source, geocoded_address, zone, zone_modifier_snapshot` | Lock principal, vínculo cliente/tenant, autorização e contexto atual. `owner_user_id` não sai no DTO de revisão. |
| `clients` | `id, tenant_id, is_active, deleted_at` | Cliente atual e vínculo de identidade. |
| `estimate_drafts` | `id, tenant_id, project_id, client_id, version, created_at, pricing_schema_version, source, estimate_id, intake_form_id, bundle_id, supersedes_id, change_order_of, bundle_name, notes, subtotal_price, discount_applied, discount_amount, final_total_price, subtotal_cost, line_items, assembly_selections, pricing_snapshot, draft_data, commercial_channel, channel, zone, finish_level, region, trade, coastal_modifier, scope_draft_id, assembly_count, status, superseded_by, approved_at, approved_by, locked_at` | Draft atual, ambas as arestas de linhagem e entradas do adaptador puro. Ver exceção do normalizador abaixo. |
| `project_members` | `id, tenant_id, project_id, user_id, project_role, permissions, is_active` | Aprovação por membership e contradições, inclusive membership inativa. |
| `roles` | `id, name` | Resolver papel global pelo nome protegido do perfil. |
| `role_permissions` | `id, role_id, permission_id` | Grants atuais e ordem estável de locks. |
| `permissions` | `id, resource, action` | Slugs de permissões e `project:approve`. |
| `tenant_settings` | `id, tenant_id, updated_at, profit_shield_overrides, geo_floor_overrides` | Política atual sob SHARE, sem configurações de integração. |
| `geo_zones` | `id, tenant_id, is_active, zone_name, name, coastal_exposure_level, cost_multiplier, labor_modifier, material_modifier, logistics_modifier, contingency_pct, min_profit_shield_pct` | Contexto geográfico de revisão, sem consulta de catálogo para recalcular preço. |
| `scope_drafts` | `id, project_id, tenant_id` | Associação de scope, sem conteúdo desnecessário. |
| `historical_estimate_imports` | `id, estimate_draft_id` | Detectar qualquer vínculo H1 da linhagem, inclusive vínculo contextual contraditório. |
| `estimates` | `id, project_id, tenant_id` | Referência de origem bloqueada e validada. |
| `bundles` | `id, tenant_id` | Referência de origem; inatividade não invalida proveniência. |
| `intake_forms` | `id, project_id, tenant_id, form_data` | Conferir referência e claims project/client. Somente esses claims são lidos; o form completo não sai no retorno. |
| `estimate_internal_approval_snapshots` | Identidade comum abaixo + `draft_version, contract_version, content_hash, currency_code, currency_basis, subtotal_price_minor, discount_minor, final_price_minor, estimated_cost_minor, policy_version, policy_hash, snapshot_payload, policy_evaluation, captured_by` | Evidência completa necessária à validação existente, após conferir contexto. |
| `estimate_internal_approvals` | Identidade comum + `snapshot_id, request_id, request_hash, approved_by, approved_at, reason, contract_version` | Decisão existente e reconstrução do hash do comando. |
| `estimate_internal_approval_revocations` | Identidade comum + `approval_id, request_id, request_hash, revoked_by, revoked_at, reason, contract_version` | Revogação existente e reconstrução do hash do comando. |

Identidade comum A1: `id, tenant_id, project_id, client_id, estimate_draft_id, created_at, updated_at, deleted_at`.

O normalizador frozen `internal_approval_draft_matches_v1` recebe o tipo composto completo de `estimate_drafts`, embora leia apenas 28 campos presentes nessa projeção. O candidato 0015 reconstrói internamente esse argumento tipado com os valores exatos da projeção, deixando nulos somente campos não lidos pelo normalizador. Isso ainda exige teste de equivalência com o argumento original completo. Não há grant SELECT integral nem preenchimento de campos ausentes do DTO. O normalizador financeiro frozen permanece intacto.

A configuração privada pode conter `created_at, updated_at, deleted_at` para rastreabilidade e retirada. O definer não precisa ler os dois primeiros. Não há FK a inventar. Apenas bootstrap administrativo auditado pode gravar essa configuração, e a ausência de linha mantém o caminho fechado.

## RLS e contenção

Policies novas propostas somente para o definer em quatro tabelas de evidência existentes: imports H1 e as três A1. Elas precisam de visibilidade de SELECT e de linhas para locks UPDATE, sem filtrar tenant e esconder contradições por ID global. A condição de gravação será sempre falsa. Também se aplicam políticas equivalentes à tabela privada de configuração. Nenhuma policy Auth faz parte desta alternativa. A necessidade das policies de UPDATE em SELECT FOR SHARE é documentada pelo PostgreSQL; a condição de gravação não é aplicada ao simples lock. [Aplicação das policies](https://www.postgresql.org/docs/17/sql-createpolicy.html).

Essa visibilidade existe apenas no papel sem login e não assumível pelo runtime. A operação autoriza o projeto primeiro, percorre referências restritas à operação e rejeita vínculos contraditórios antes de devolver JSON. O usuário autenticado não recebe SELECT, UPDATE(id), USAGE do schema privado nem papel de definer.

Preflight proposto, **sem revogação global**:

1. Inventariar nominalmente tabelas, sequências, views e assinaturas de funções business definidos pelas migrations versionadas deste repositório; excluir objetos de extensões e objetos externos não inventariados.
2. Recusar a instalação/abertura se `PUBLIC`, `anon`, `authenticated` ou papéis alcançáveis por herança/SET ROLE conservarem acesso bruto efetivo a esses objetos; considerar ACL de coluna, ownership, BYPASSRLS e funções antigas executáveis.
3. Aceitar como novas exceções apenas as duas assinaturas públicas desta proposta e suas duas entradas privadas estritamente necessárias ao wrapper. Helpers transitivos não recebem EXECUTE do runtime.
4. Conter privilégios legados por plano separado e explícito por objeto, com compatibilidade do caminho SQL legado testada. Não presumir que a contenção manual já aplicada na homologação acompanha um replay de migrations.
5. Não alterar `row_security=off` da migração 0010 nem conceder writers H1/A1 ao novo papel.
6. Exigir RLS habilitado e nenhuma policy preexistente nas quatro tabelas de evidência. Uma policy restritiva poderia ocultar contradições mesmo com a nova policy permissiva; drift causa recusa de instalação.
7. Inspecionar também funções e relações desconhecidas no schema público: recusar qualquer execução/acesso efetivo pelo API principal ou seus papéis alcançáveis. Isso é apenas preflight de catálogo, sem revogar ou modificar objetos externos. Não há exceção automática para extensões; eventual assinatura permitida exige revisão explícita. Views, tabelas externas e sequências acessíveis também impedem a instalação.

## Retorno e semântica preservados

Sessão: perfil próprio completo, tenantId, slugs de permissões sem duplicatas e indicador de papel admin coerente com o perfil. O indicador não amplia autorização.

Revisão: versão `structr-authenticated-review-v1`, contexto actor/tenant, oito projeções mínimas do adaptador, e evidências snapshots/approvals/revocations/autores mais `sourceMatches`. A coluna `numeric` sai como texto; datas tipadas como UTC de milissegundos; JSON persistido mantém tipos e ordem. Contextos A1/H1/zone/scope contraditórios recusam antes de sair do banco.

Manter os controles em `server/internal-estimate-approval-db.ts`: permissão approve; project → draft; identidade/ACL; duas arestas e limite de 1.000 ancestrais; evidência A1 validada antes de classificar já decidido; elegibilidade somente quando não há decisão; contexto e referências. Não substituir validação de evidência por simples EXISTS. O servidor mantém os validadores puros de hashes/evaluation e o motor de revisão; a RPC não produz aprovação nem autoridade comercial.

## Evidência e pendências

- RED físico anterior à implementação: as duas RPCs ausentes produziram PGRST202; assinatura ES256 inválida foi recusada pelo PostgREST real. Isso prova o controle e a ausência das operações, não o desenho SQL.
- A migração 0015, seu journal e metadata ORM existem. Após as provas locais, a SQL exata foi aplicada somente na homologação às 22:48:47 UTC, com issuer vazio e acesso ainda fechado; o [registro de execução](adr002-review-access-2026-10-07.md#homologação-instalação-fechada) contém ledger e catálogo. O ORM espelha as dez policies e referencia o papel dedicado como existente, sem criá-lo pelo processo web.
- O laboratório deve manter Auth RLS fechado e comprovar que a alternativa não lê esse schema; não introduzir policies artificiais Auth para facilitar o teste.
- Provar claims ausentes/errados, TTL de uma hora recusado, limites 899/900/901 segundos, iat futuro, prazo restante, expiração durante espera, logout com token ainda válido até exp, revogação organizacional na próxima operação, A1/A2/B1, replay de conexões e locks/retries.
- Provar grants de coluna, nenhuma escrita de negócio, helpers privados inacessíveis, dados contraditórios recusados e paridade com o helper atual. Provas locais não substituem tokens reais e catálogo da homologação.
- Prova local do ciclo do migrador: quatro casos passaram com `current_user` não-superuser/CREATEROLE e proprietário das 90 tabelas, usando cluster isolado de supervisor. O primeiro RED de implementação revelou GRANT privado depois da retirada de ownership; os mesmos grants foram movidos antes da transferência. A versão corrigida prova rollback integral após falha final, ausência de SET/INHERIT ao final, manutenção explícita das funções e fechamento posterior dessa capacidade. A sessão supervisora do laboratório não representa o login hospedado; o catálogo do provedor continua sendo gate separado.
- A alternativa local reduzida passou pela revisão automática de escrita de arquivo; a primeira tentativa mais ampla continua registrada como rejeitada. A aplicação posterior da migração na homologação também foi aceita pela ferramenta, com a configuração vazia. Não houve configuração Auth nem abertura do piloto.
