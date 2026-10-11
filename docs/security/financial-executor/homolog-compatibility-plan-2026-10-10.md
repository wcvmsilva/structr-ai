# Compatibilidade da homologação Calculator — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Checkboxes registram trabalho local comprovado; não autorizam ações hospedadas.

**Goal:** preparar um candidato local revisado e um pacote T8 de confirmação específica, preservando permissões geridas, a role compartilhada `user` e a identidade SQL real.

**Architecture:** quatro operações Calculator, executor isolado, transações Drizzle reais e auditoria transacional; administração nominal de O, fixture e retirada em commits separados com compensação. Nenhuma exceção nova a F2/F5.

**Tech Stack:** PostgreSQL 17.11, TypeScript, Drizzle/postgres, Zod, Vitest; runtime proposto Node 22. Sem biblioteca financeira ou provedor adicional.

**Spec:** [ADR-003](../../adr/ADR-003-pilot-financial-executor.md), [T8](../../superpowers/plans/2026-10-10-adr003-calculator.md#t8--confirmação-específica-e-homologação-controlada), [AGENTS](../../../AGENTS.md), [pacote operacional](../../engineering/calculator-homologation-package-2026-10-10.md), [aceitação](../../engineering/calculator-homologation-acceptance-2026-10-10.md).

**Checkpoint de 11 de outubro de 2026:** as três frentes foram implementadas e aprovaram a revisão independente de seus candidatos locais. A revisão SQL exigiu fixar todos os registros de default ACL, inclusive os de outros owners em schemas aplicativos; a correção v2 e suas contraprovas passaram, e a revisão subsequente aprovou sem achados remanescentes. Suíte geral, revisão integrada e CI final também permanecem gates. Base integrada `a6e518b4044f339e51fd1e10a80d33eeef820609` ([PR #50](https://github.com/wcvmsilva/structr-ai/pull/50)); conexão revisada `e7af7390`. O [registro de resultados](../../engineering/calculator-hosted-compatibility-2026-10-11.md) e o [mapa de hashes](homolog-compatibility-review.md) identificam os checkpoints finais, sem transportar hashes intermediários para a confirmação.

Nenhuma criação de projeto, credencial, grant, binding, fixture, cobrança, alteração de proteção ou ativação hospedada foi executada por este incremento. **T8 hospedado e uso em campo não estão concluídos.**

## Restrições e decisões reconciliadas

- Somente `calculator.context`, `calculator.calculate`, `calculator.create`, `calculator.recover`. Entrada SQL privada no schema `structr_financial`: `calculator_context_v1(jsonb)`, `calculator_snapshot_v1(jsonb)`, `calculator_create_v1(jsonb,jsonb)`, `calculator_recover_v1(jsonb)`.
- Web sem SQL, service role, signing secret ou fallback. IF-1/SWR-1, aprovação, versões, JSON/PDF e autorização de obra ficam fora deste incremento.
- Login/owners financeiros NOINHERIT/NOBYPASSRLS, sem memberships de saída, CREATE/TEMP ou autoridade bruta além do manifesto. O requisito inicial de “nenhum membership” foi reconciliado para instalação não superuser: três edges recebidas de `postgres`, ADMIN TRUE/INHERIT FALSE/SET FALSE no estado final. Somente edges autoconcedidas dos dois owners recebem manutenção transitória, removida antes do COMMIT: INHERIT/SET TRUE na instalação; INHERIT TRUE/SET FALSE nos REVOKEs da retirada. Sem SET ROLE ou leitura de pg_authid; confirmar esse alcance antes de aplicá-lo.
- F2/F5 permanecem literais nos helpers administrativos. Cada transação é real, SERIALIZABLE, com `logAudit`, snapshots/readback e rollback em falha. Retry só `40001`/`40P01`, até três tentativas no orçamento monotônico de 30 s de cada operação; não há uma única transação de toda a coordenação.
- TEMP existente da API/owners legados é preservado explicitamente. A proposta não introduz uma restrição API ausente de 0015–0019; nega TEMP aos principals financeiros. A contenção PUBLIC TEMP tem transação/auditoria própria e efeito duradouro após a retirada Calculator.
- ACLs geridas não são ignoradas por nome de schema. Só as duas views exatas pg_stat_statements retêm SELECT PUBLIC latente, sem USAGE financeiro ou wrapper alcançável, com contraprovas físicas. Toda mudança fora do catálogo exato deve bloquear.
- Não conceder permissão a `user`, promover admin, reativar A1/A2/B1 ou alterar tenant/issuer por consequência. Role exclusiva de O e identidades negativas são confirmações nominais distintas.
- Fonte, IDs, horário UTC, operador administrativo e observador ficam no pacote restrito. Nenhuma senha, token, UUID pessoal ou connection string no Git/chat/evidência pública.

## Fatos que delimitam a implantação

| Observado | Tratamento local / gate hospedado |
| --- | --- |
| PG 170011, migrations até 0019, zero schema/roles Calculator; 1.011 objetos aplicativos comuns e 36 membros pgcrypto em `extensions`. | Normalização só de membros comprovados pgcrypto 1.3; catálogo aplicativo preservado por hash exato. Não mover a extensão hospedada. |
| 96 funções com EXECUTE PUBLIC e 264 entradas de default ACL incluindo owners, sem USAGE PUBLIC nos schemas não sistema observados. | Manifesto completo de objetos/superfície, revisão de wrappers/definers e catálogo exato de defaults. As contagens não são prova de segurança ou alcance. |
| PUBLIC TEMP no banco. | Artefato separado retira PUBLIC TEMP e preserva explicitamente destinatários já efetivos; aplicar somente após confirmação e checks exatos. |
| O ativo em GCHI, `profiles.role=user`, sem role/estimate:create resolvíveis. | Proposta `calculator_pilot_operator_v1` atribuída apenas a O, com uma permission/edge, retirada auditada para `user`. |
| Vercel Pro Active confirmado em 2026-10-10 22:57 UTC; executor ausente; host SQL direto inicialmente IPv6. | Não contratar Pro novamente; propor Preview dedicado Node 22/iad1 e add-on IPv4 separado, com TLS/identidade reais a comprovar após confirmação. |
| Amostra 2026-10-11 22:53 UTC: 5 conexões cliente, 13 backends totais, max 60, reserva superuser 3, reserva ordinária 0. | `CONNECTION LIMIT 2` nominal mais admin 1; admissão/aborto exige 10 slots ordinários após projeção. Sem reserva garantida, limite de instâncias ou inferência de “47 livres”. |

## Tarefa 1 — catálogo efetivo e pgcrypto

**Fontes:** `scripts/financial-executor-homologation/compatibility-inspect.sql`, `compatibility-inspect-supplement.sql`, `compatibility.ts`; [manifesto](homolog-compatibility-manifest.json); testes em `server/financial-executor-homologation-compatibility.test.ts`.

- [x] Coletar metadados somente leitura com `search_path=pg_catalog`: extensões/membros, schemas, roles/flags/memberships, ACLs de database/tabela/coluna/sequência/função, defaults por owner/schema/tipo, definições/config/targets, views/regras/triggers/event triggers.
- [x] Materializar a observação exata e as projeções aplicativo/gerida; comparar hashes de envelopes e ordenação UTF-8 explícita. Dois envelopes de intake tiveram os bytes confirmados por recaptura read-only UTF-8 hexadecimal após perda de caracteres no transporte; não substituir por normalização inventada.
- [x] Provar parsing/projeção/pgcrypto/membership/drift com RED/GREEN comportamental; o checkpoint anterior à correção final tinha 29 casos puros.
- [x] Examinar corpos e caminhos transitivos dos definers/wrappers capturados; manter API/owners legados sem ponte nova ao financeiro. Nenhuma análise genérica por nome de schema autoriza dados novos.
- [x] Corrigir o conjunto de defaults para fixar todo registro, sem exclusão por owner/schema: perfil gerido hospedado 205, laboratório reduzido 51; preservar o aplicativo 1.011 e os catálogos instalados 1.099/1.108.
- [x] Concluir a revisão independente da correção, sem achados remanescentes; os hashes finais estão no mapa compacto.

## Tarefa 2 — SQL compatível e contenção TEMP

**Fontes:** migrations 0020/0021, [manifesto de permissões](permission-manifest.json), `boundary.ts`, `preflight.sql`, `managed-catalog.sql`, laboratório gerido e suítes físicas próprias. O [mapa compacto](homolog-compatibility-review.md) enumera todos os artefatos e hashes.

- [x] Reproduzir instalação sob `current_user=session_user=postgres`, não superuser, com capacidades equivalentes às observadas. Conferir as edges automáticas de manutenção, ownership e remoção das edges transitórias antes do COMMIT.
- [x] Reproduzir pgcrypto em `extensions`, manter permissões geridas e provar preservação exata, rollback atômico e recusas de alterações em schema, wrapper, coluna, sequência, owner, membership, RLS e constraints. Corrigir o wildcard `pg_%` para prefixo literal e negar `pgoutside`.
- [x] Isolar perfis laboratoriais vazios/reduzidos por socket Unix próprio, listen_addresses vazio e bootstrap verificado; GUC do caller não habilita exceção. O perfil hospedado exige sua igualdade exata.
- [x] Preparar o [plano TEMP](database-temp-containment-plan.json), [SQL fixo](../../../scripts/financial-executor-homologation/database-temp-containment.sql) e wrapper `applyCalculatorDatabaseTempContainment`: principal/banco/versão reais, antes/depois exatos, uma transação SERIALIZABLE e auditoria com readback. Duas provas físicas exercitam aplicação e rollback de auditoria sob administrador não superuser.
- [x] Reexecutar as provas físicas existentes de fronteira/coexistência/pré-requisitos no checkpoint SQL inicial: 177 aprovações em seis arquivos, incluindo 61 casos novos, sem recusar o estado gerido por revogação artificial.
- [x] Corrigir a lacuna de revisão incluindo **todos** os registros de pg_default_acl, também defaults de postgres e supabase_admin em public. Dez novos casos físicos demonstram RED no candidato anterior e recusa nas duas migrations/checker corrigidos. Resultado v2: 69/69 puros/geridos mais 116/116 físicos anteriores afetados, em execuções novas; os dois TEMP inalterados permanecem aplicáveis da prova anterior. Não foi uma única execução nova de 187 casos.
- [x] Obter aprovação da revisão SQL corrigida.
- [ ] Confirmar o commit integrado exato, validação geral e CI antes da confirmação hospedada. Não interpretar a proteção de um preflight como execução hospedada bem-sucedida.

## Tarefa 3 — RBAC nominal existente e sua coordenação

**Fontes:** `scripts/financial-executor-homologation-rbac.ts`, seus testes unitários/físicos e `orchestration-contract.ts`. A preparação RBAC do PR #50 é baseline; não foi reconstruída nem recontada como nova.

- [x] Preservar `create-absent`: uma permission `estimate:create`, uma role `calculator_pilot_operator_v1`, uma edge e somente `profiles.role` de O; recusar colisões/duplicatas/assignees alheios. Sem ampliar `user` ou criar Auth/tenant/membership.
- [x] Preservar parser/auth.me e identidade protegida. Autoridade de owner inclui read/write/approve/delete em helpers existentes; uma permission nova não elimina esse poder. Allowlist e quatro rotinas continuam limitando os writers deste recorte.
- [x] Parear manifestos RBAC/fixture estritos: operationIds distintos; mesmo operador, fonte, principal/database e janela. Registrar receipts e compensação real entre commits, inclusive resposta perdida de COMMIT, sem retry cego ou promessa de atomicidade agregada.
- [x] Preservar CAS de restauração por identidade/role e edits alheios não identitários. Restaurar O para `user`, remover edge e manter definições/histórico. Drift não é sobrescrito.
- [ ] Obter confirmação nominal de O/IDs/horário real antes de qualquer aplicação hospedada. Contas A1/A2/B1 e tenants inativos não estão incluídos nesta autorização.

## Tarefa 4 — conexão, hosting e custo

**Fontes:** `connection.ts`, `infrastructure.ts`, `shared/financial-executor-tls.ts`, config do executor e testes de conexão/Auth. **Revisão independente aprovada**, fonte `e7af7390`; 154 casos focais, **56 novos**, checks de tipos e build do executor aprovados.

- [x] Implementar factory administrativa sem efeitos no import, sem CLI/fallback por ambiente, com arquivo privado canônico 0400/0600, pins independentes, CA pública exata e limpeza do cliente em falha. Caller fecha em `finally`; expiresAt é admissão, não revogação.
- [x] Exigir CA/hostname/cadeia verificados no runtime e na factory; manter username e principal SQL nominais. Testes reais de TLS recusam CA/hostname errados; prova local sem credencial em Node 24.14 não é prova de Node 22/Vercel.
- [x] Delimitar proposta Preview/Node 22/iad1, Git desabilitado, uma credencial executor Preview somente; proteção None somente no novo executor, sem bypass secret ou alteração web/equipe. Pooler permanece não configurado.
- [x] Delimitar até 2 h/200 chamadas intencionais/US$ 5 allowance Vercel, mais IPv4 US$ 0,0055/h separado. Sem teto rígido, sem compra, sem promessa de custo zero. Conferir CPU/memória antes do segredo; abortar manualmente em desvio de tráfego/custo/capacidade.
- [x] Provar localmente duas sessões nominais e recusa da terceira com `CONNECTION LIMIT 2`; distinguir limite de conexões normais de reserva de capacidade/limite de instâncias.
- [ ] Preparar/revisar o procedimento exato de provisionamento/rotação da senha nominal, protegido e auditado, antes do item B. A factory só lê uma credencial existente, e openCalculatorPilot só abre LOGIN/validade/limite; nenhum deles cria a senha. Não usar ALTER improvisado.
- [ ] Confirmar projeto/ambiente/proteção/custo/rede e depois pins reais; comprovar Node 22/Vercel, TLS autenticado, session_user/current_user, PID/txID, capacidade, rotação/encerramento e recuperação. Nenhum desses resultados hospedados foi executado.

## Tarefa 5 — fixture, W2 e retirada terminal

**Fontes:** `admin.ts`, `orchestration.ts`, `orchestration-contract.ts`, RBAC e testes. **Revisão independente após correções aprovada**, 156 casos focais, **38 novos**: 22 unidades de coordenação e 16 adições físicas. Os 118 casos do pacote anterior são baseline.

- [x] Preservar fixture A/B/C e settings existentes conferidos, sem reescrita de overrides ou chamada paga inferida de geolocalização sintética.
- [x] Implementar prepare/open coordenados e compensação por receipts íntegros. Limitar reads de evidência que adquirem locks e o orçamento de retry; prova física mantém outra sessão com lock real e confirma timeout.
- [x] Implementar fase auditada de binding inativo antes de NOLOGIN/REVOKE/kill. Com mesmo bearer local válido, SQL e executor recusam por autoridade enquanto transporte/sessões continuam ativos: W2 é executável no candidato, mas ainda não comprovado hospedado.
- [x] Fechar LOGIN/senha e quatro EXECUTEs com manutenção temporária de owners auditada em snapshots 3/5/3, sob postgres não superuser. Falha de auditoria faz rollback desse COMMIT; binding previamente desativado não reabre.
- [x] Encerrar sessões por PID+backend_start, com intenção auditada/readback; falta de visibilidade não grava intenção inutilizável, e retry permite concluir a limpeza. Preservar `cleanup_pending` até limpeza e restauração completas.
- [x] Distinguir drift atual com história íntegra de evidência histórica ausente/corrompida. O segundo pode recusar antes da contenção; footprint financeira sem receipt retorna `financial:null`, não fechamento comprovado. Não adicionar bypass de evidência ou afirmar contenção universal.
- [ ] Nomear responsável/observador e janela UTC, validar encerramento hospedado e conferir remoção da credencial/configuração. Nenhum watchdog foi implantado. Binding é terminal; outra rodada exige desenho próprio, sem reativação/delete/rebind.

## Tarefa 6 — integração, revisão final e confirmações

A integração usa as suítes existentes e as novas suítes focais conforme o domínio exercitado; não foi criado um arquivo artificial `financial-executor-homologation-compatibility-integration.test.ts`. Isso evita duplicar provas só para satisfazer o nome originalmente previsto. Nenhum motor de domínio novo justifica repartir infraestrutura em testes fictícios de engine/router.

- [x] Reexecutar 61 provas físicas de transação, DB Calculator, integração e jornada web em PostgreSQL descartável; preservar criação única, recuperação, identidade/transação e concorrência. Esses casos são existentes, não novos.
- [x] Acrescentar integrações comportamentais na coordenação: perda de resposta COMMIT RBAC, compensação, W2 JWT/SQL, administrador não superuser, cleanup/retry e restauração. Manter evidência da ausência de instalação parcial e preservação gerida nas suítes SQL.
- [x] Separar contagens finais locais: conexão 56 novos; coordenação 38; SQL 71 (29 puros + 40 geridos físicos + 2 TEMP). **165 únicos**: 107 padrão e 58 físicos opt-in. Reexecuções e os 118 do PR #50 não contam como novos.
- [x] Concluir typechecks administrativos/executor e builds web/executor nos checkpoints registrados, com exit 0; não afirmar sprint completo com isso.
- [ ] Concluir suíte geral obrigatória, revisão integrada do commit e CI. Registrar resultados finais/hashes publicáveis no [registro da rodada](../../engineering/calculator-hosted-compatibility-2026-10-11.md).
- [ ] Resolver manifestos privados e fases específicas do [pacote](../../engineering/calculator-homologation-package-2026-10-10.md): preparação fechada de destino/rede/proteção; readback de pins; credencial/SQL/TEMP/RBAC/fixture/janela/retirada. A1/A2/B1/tenants ativos e mecanismos de falha precisam de alcance nominal próprio antes de suas provas, sem extensão implícita.
- [ ] Executar somente a homologação especificamente confirmada, obter readback independente e registrar cada caso aprovado/falhou/bloqueado. Todos os casos hospedados continuam não executados neste checkpoint.

## Condição de saída

A implementação local termina com fonte e manifesto revisados, regressão sem falhas e proposta concreta de configuração/permissões/retirada. A abertura hospedada depende das confirmações exatas e do readback do destino; seu aceite exige todas as provas aplicáveis, inclusive identidades ativas e falhas controladas devidamente preparadas. O efeito persistente de TEMP e as limitações de retirada sob evidência corrompida devem permanecer visíveis. Nenhum resultado local libera aprovação, versões, exportação ou uso em campo.
