# ADR-002 — fronteira autenticada para o primeiro piloto

**Status:** Accepted — direção aprovada pelo responsável pelo projeto em 7 de outubro de 2026; API permanece fechada até as provas do recorte.
**Data:** 6 de outubro de 2026.
**Decisor:** responsável pelo projeto, com revisão técnica independente.
**Base:** `264443a65b3d4efaae3364c7f363ff3d1195895e`.

> **Adendo financeiro aprovado — 10 de outubro de 2026:** a [ADR-003](ADR-003-pilot-financial-executor.md) altera nominalmente a confiança apenas para o pacote financeiro enumerado: executor TS separado verifica JWT e calcula, com principal SQL fixo e rotinas limitadas; o banco não verifica independentemente JWT/motor. O web continua sem SQL, service role ou segredo de assinatura. IF-1/SWR-1 e os recortes Data API deste ADR não mudam. Desenho e implementação testada estão aprovados; criar credenciais ou ampliar acesso exige confirmação específica posterior com revisão independente. Não libera uso em campo. [Inventário](../security/financial-executor/inventory-2026-10-10.md) e [plano Calculator](../superpowers/plans/2026-10-10-adr003-calculator.md).

## Contexto

O usuário autorizou continuar a fundação login → transação → organização. A regra do [AGENTS.md](../../AGENTS.md) é “Do not improvise architecture”. O [contrato G4b](../security/g4b-catalog-ownership/2026-09-17-design.md#L847) exige que o PostgreSQL direto valide o bearer contra JWK aprovado e estabeleça um envelope autenticado por transação. Esse mecanismo não está implementado.

A inspeção somente leitura de `wmspwegbqtzamkhxhusg` encontrou PostgreSQL 17.11, `pgcrypto 1.3` instalado e linguagens SQL/PLpgSQL/internal/C. A extensão não expõe verificador JWS ES256. `pgjwt 0.2.0`, `pgsodium 3.1.8`, `http 1.6` e `pg_tle 1.4.0` estão disponíveis no catálogo, não instalados; PLV8/PLPython/PLRust não foram listados.

Às 20:35:58 UTC, o [JWKS público](https://wmspwegbqtzamkhxhusg.supabase.co/auth/v1/.well-known/jwks.json) publicou chave ES256/P-256, identificador `4fdb5ed2-865e-49bb-8b9a-b0c8baca1576`. Isso não prova qual chave assina novas sessões; não foi criada conta nem obtido JWT real.

O [pgcrypto](https://www.postgresql.org/docs/17/pgcrypto.html) fornece HMAC/hash, não esse verificador JWS. O [pgjwt](https://supabase.com/docs/guides/database/extensions/pgjwt) está depreciado no PG17; ser listado no catálogo não demonstra adequação ao ES256. O Supabase recomenda [chaves assimétricas](https://supabase.com/docs/guides/auth/signing-keys). Não se propõe mudar para HS256 ou implementar ECDSA manualmente.

## Decisão aprovada

**Recomendação: delimitar o caminho do piloto pela Data API autenticada do Supabase/PostgREST, com funções de banco nomeadas e autorização dentro da mesma transação.** A assinatura passa a ser verificada pelo serviço de entrada confiável; o banco resolve perfil/tenant protegidos e autoriza cada operação.

Fluxo proposto: usuário com bearer → endpoint existente Structr → Data API verifica assinatura → transação autenticada → mapeamento protegido e autorização da operação.

A função também é uma entrada diretamente acessível a quem possui bearer. Validação de argumentos e claims, autorização e limitação do snapshot precisam resistir a chamadas diretas à Data API, sem depender do Zod ou middleware Node do Structr.

O [PostgREST documenta verificação JWT simétrica e assimétrica](https://docs.postgrest.org/en/stable/references/auth.html). Cada chamada ocorre em uma [transação](https://docs.postgrest.org/en/stable/references/transactions.html); isolamento e privilégios precisam ser configurados e comprovados na versão efetivamente hospedada. Documentação não substitui essa prova.

O processo web habilitado não terá credencial SQL, service role, segredo de assinatura nem acesso a tabelas brutas. Encaminhará bearer e comandos estritos a funções específicas. Não haverá login SQL da aplicação capaz de chamar as mesmas rotinas com claims forjadas. Identidade não virá de actor/tenant enviados como argumentos.

Esta é uma mudança explícita da fronteira do contrato. O responsável aprovou expressamente nesta conversa a opção recomendada em 7 de outubro de 2026. A aprovação autoriza seu detalhamento e implementação testada em homologação; não aprova grants ainda não escritos nem libera o piloto ou produção.

## Alternativas consideradas

| Opção | Vantagem | Consequência | Parecer |
| --- | --- | --- | --- |
| Data API autenticada e funções nomeadas | Usa verificador mantido pelo provedor; evita novo protocolo próprio de atestação | Adapta contexto, locks e operações A1; exige retirar credenciais SQL do processo habilitado | Recomendada |
| Verificador independente e atestação autenticada por transação | Pode preservar mais consultas Drizzle | Novo serviço, segredo separado, protocolo contra replay/rebind, expiração, rotação e disponibilidade; chave no processo web é vetada | Alternativa, se escolhida |
| ES256 no banco conforme contrato atual | Mantém a fronteira literal | Nenhuma implementação madura e suportada identificada no ambiente; exige prova do provedor ou mudança de infraestrutura | Bloqueada pela capacidade observada |
| Auth remoto via HTTP no definer | Delega validação ao provedor | Também muda o contrato; exige destino/TLS/configuração HTTP controlados, timeout e manejo seguro do bearer | Não recomendada como atalho |

Não há estimativa validada de prazo/custo adicional. Nenhum recurso novo ou alteração cloud é autorizado por esta proposta isoladamente. A autorização anterior de USD 10/mês cobre o projeto já criado.

## Contrato mínimo do recorte recomendado

1. Modificar o endpoint existente `estimate.getInternalApprovalReview`, sem endpoint paralelo ou fallback administrativo.
2. Resolver subject externo → perfil interno → tenant ativo no canal protegido. Não auto-provisionar perfil, escolher tenant padrão ou aceitar autoridade de metadados editáveis pelo usuário.
3. Exigir assinatura, issuer, audience, expiração e papel previstos. Conferir a configuração real do provedor e validar claims adicionais na rotina; os defaults de PostgREST não bastam para presumir todos esses requisitos.
4. Preservar a ordem project → draft e locks de identidade/RBAC/contexto. A [revisão A1](../../server/internal-estimate-approval-db.ts#L249) usa FOR UPDATE/FOR SHARE; não remover locks nem conceder UPDATE amplo como atalho. Usar RPC via POST, função VOLATILE e transação SERIALIZABLE efetivamente comprovada no serviço hospedado; repetir a operação inteira em serialization failure/deadlock, preservando o limite atual.
5. Adquirir um snapshot autorizado coerente dentro de uma operação transacional nomeada e passá-lo ao motor puro existente. Múltiplas chamadas HTTP não compartilham uma transação; snapshot fornecido pelo cliente não serve como autoridade para futura aprovação.
6. Manter a detecção de linhagem H1 e vínculos contraditórios. RLS não pode ocultar evidência que deveria causar recusa. Preservar o `row_security=off` fail-closed da migração 0010.
7. Funções privilegiadas terão owner dedicado NOLOGIN/NOBYPASSRLS, não proprietário das tabelas, privilégios mínimos, objetos qualificados, search_path fixo e EXECUTE público revogado. Provar a visibilidade necessária sem grants amplos.
8. Testar isolamento por requisição/transação, contexto limpo no pool e retries. Não expor SQL arbitrário, setter de claims ou seleção de tabela/tenant.
9. Aprovar, revogar, versionar e exportar permanecem fechados no caminho novo até integração própria. O wrapper atual é compartilhado com esses consumidores; não substituí-lo globalmente neste recorte.
10. Mutations futuras manterão mudança, readback e audit durável na mesma transação. Não alterar autoridade comercial ou de execução de obra.

## Provas antes da abertura

- Assinaturas reais e inválidas; issuer/audience ausentes/incorretos; token expirado/sem expiração; papel de serviço não aceito como sessão comum.
- Acesso SQL direto, tabelas brutas, RPC indevido, setter de claims e escalada de papel recusados.
- A1 autorizado, A2 sem direitos e B1 de outro tenant; perfil/tenant inativos; mudança concorrente de membership; isolamento entre chamadas e conexões reutilizadas.
- Locks e retry serializável completo; recusa após revogação de membership/permissão; nenhuma tentativa com papel privilegiado. Logout/revogação de sessão Auth é uma garantia diferente: assinatura válida não implica sessão ainda ativa. O detalhamento deve definir e provar essa política; invalidação imediata exige verificação adicional do estado protegido de sessão, não apenas do JWT ([Supabase Sessions](https://supabase.com/docs/guides/auth/sessions)).
- Linhagem H1 e evidência contraditória preservadas com RLS real.
- Snapshot compatível com o motor atual, sem escrita de negócio pela revisão.
- Configuração/versão/roles do próprio ambiente verificadas, com recuperação antes de writes reais.

Contexto colocado manualmente em GUC e verificador simulado não comprovam JWT → banco. Falha ou prova inconclusiva mantém o caminho fechado.

## Trabalho independente

Exigir `exp` no verificador Supabase Node corrige uma ausência de validação sem mudar a fronteira de confiança. O reparo tem testes criptográficos reais e verificação separada; não implementa nem comprova esta proposta.

## Ações

- [x] Responsável aprova a direção recomendada — 7 de outubro de 2026, aprovação explícita nesta conversa.
- [x] Revisar detalhamento de bootstrap, snapshot/locks, claims, transporte e privilégios — revisão independente final sem novos bloqueadores em 7 de outubro de 2026; [desenho](../engineering/adr002-review-grants-design-2026-10-07.md).
- [x] Executar RED físico e de integração antes das implementações correspondentes — falhas funcionais e falhas de preparação distinguidas no [registro](../engineering/adr002-review-access-2026-10-07.md).
- [x] Implementar e provar localmente o recorte escolhido — 88 testes físicos novos distintos aprovados; isso não é prova hospedada nem jornada completa.
- [x] Reconciliar explicitamente a seção 13 G4b no escopo aprovado, preservando o histórico — nota delimitada em 7 de outubro de 2026; não é abertura do catálogo ou conclusão G4b.
- [ ] Somente após os critérios acima avaliar abertura na homologação.

## Adendo IF-1 — 9 de outubro de 2026

Por solicitação explícita do responsável para resolver a diferença F2/F5 do
cadastro, o integrador registra a [decisão IF-1](../engineering/intake-f2-f5-reconciliation-2026-10-09.md),
com revisão técnica independente. Apenas `intake.create(newProject)` pelo RPC
`public.structr_intake_create_v1(preimage text)` pode cumprir F2 e a frase de
wrapping da arquitetura por auditoria SQL obrigatória, e F5 pela transação
PostgreSQL única, autenticada, SERIALIZABLE/read-write efetivamente conferida.
O [AGENTS](../../AGENTS.md#if-1--authenticated-intake-formation-only) delimita as
obrigações substitutas e preserva os requisitos dos demais caminhos.

O artefato desta decisão tem SHA-256
`135c5200dbcc32b0653d54f17721659dbf34ef2f747666640d28c6b8e49db5a0`.
Mudança, três audits completos distintos e readback final permanecem na mesma
transação; falha aborta a formação. Replay reautoriza e retorna o intake atual,
sem repetir formação ou audits de criação. A decisão não acrescenta credencial
SQL ao web nem estende uma transação Drizzle através de HTTP.

A direção aprovada e o histórico deste ADR permanecem preservados. O adendo
resolve a regra de implementação desse cadastro; não abre as demais mutations,
não inclui geocoding/financeiro e não aplica SQL, grants ou alteração da allowlist.
A futura integração deve modificar o endpoint existente, separar o cadastro do
pós-processamento geográfico legado e cumprir as provas específicas da
homologação antes de qualquer liberação do recorte.

### Promoção nominal IF-1 — 9 de outubro de 2026

O responsável autorizou especificamente o ajuste de preflight que aceita o
caminho interno `authenticator → service_role` com BYPASSRLS, somente na
homologação. O [registro nominal](../engineering/homolog-intake-formation-proof-2026-10-09.md)
identifica o novo artefato `a54e7a937eec72bf14110f890d4fc379ee414259135f3f070fee1ebc40991b75`,
o diff limitado ao preflight, revisão independente e evidência renovada. O
candidato `135c…db5a0` acima permanece histórico e inalterado. Corpo, grants e
postflight não mudaram; não há nova arquitetura, privilégio bruto de usuário ou
credencial administrativa no web. Abertura e comprovação hospedada permanecem
operações delimitadas separadas, sem autorização de produção ou campo.

## Adendo SWR-1 — 9 de outubro de 2026

O responsável ratificou a pergunta específica sobre o [contrato SWR-1](../security/scope-workspace-read/contract-2026-10-09.md)
com autorização de avançar para implementação e testes. Exclusivamente a leitura
`scopeGeneration.loadWorkspace({projectId,intakeFormId})` pode cumprir F5 pela
transação autenticada única do RPC `public.structr_scope_workspace_read_v1(command jsonb)`.
O [AGENTS](../../AGENTS.md#swr-1--authenticated-read-of-one-known-projectintake-pair-only)
registra essa substituição e seus limites. O projeto e o intake conhecidos são
validados e autorizados no mesmo snapshot SERIALIZABLE, com locks, sem DML de
negócio/audit e sem credencial SQL no web. Escopos e catálogo não são consultados.

F2, IF-1 e demais recortes permanecem distintos. A intenção autorizada de concluir
a jornada para campo orienta a implementação; não demonstra prontidão nem aprova
bytes futuros sem revisão. Abertura de cada operação permanece condicionada a
evidência local e hospedada do artefato exato, antes da avaliação de uso real.
