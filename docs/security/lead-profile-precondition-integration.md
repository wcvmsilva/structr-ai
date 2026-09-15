# Lead profile precondition — consolidação local

Data: 15/09/2026. Repositório: https://github.com/wcvmsilva/structr-ai. Registro posterior ao relatório de implementação, com fronteira de integração local explícita.

## Autorização e resultado

Após a apresentação da candidata revisada e da próxima etapa de integração controlada, o usuário respondeu: “Ótimo! Estamos próximo de poder levar o sistema para campo, seguimos avante.” Essa decisão foi aplicada à consolidação local do resultado apresentado. Não foi interpretada como aprovação para publicação, integração em main/PR9, merge, banco real ou uso em campo.

Código consolidado em **`3c75d6ec7ff75988cd13831a4ac7d18d8a6ffccb`**, com pai **`622e6afb9591c8b118c8661e5695f9870e26a53b`**, na branch `codex/lead-profile-precondition-20260915`. Oito arquivos de código/testes, com bytes iguais aos aprovados pelo manifesto anterior. Não houve nova implementação nesta consolidação. Documentação permanece em commit separado; seu SHA resultante será registrado externamente depois de criado, sem autorreferência.

O claim permanece: `leads.create` exige perfil persistido ativo do tenant confiável e não cria/promove perfil nem continua após falha da precondição. A escrita comercial continua sendo fronteira controlada na prova PostgreSQL; nenhuma promoção a fluxo operacional completo, auditoria durável, autorização atômica/TOCTOU ou segurança global.

Os documentos `lead-profile-precondition-plan.md` e `lead-profile-precondition-evidence.md` e o manifesto anterior foram preservados byte a byte. Suas afirmações “sem commit/SHA resultante” e “sem autorização de commit” descrevem a rodada anterior; este registro as sucede exclusivamente quanto à consolidação local agora autorizada. Resultados históricos não foram convertidos em execução nova.

## Verificação no commit de código

Evidências desta consolidação: `/private/tmp/structr-lead-integration-20260915/`. Horários UTC, comandos e hashes: `integration-plan.json`, `code-verification.json`, registros de revisão e manifesto final. A pasta é local e temporária, não é publicação nem backup durável.

| Verificação em 3c75d6ec | Resultado novo | Log |
| --- | --- | --- |
| pnpm check --incremental false | exit0, zero erros | code-check.log |
| Tipos dedicados de testes/helpers | exit0, zero erros | code-test-types.log |
| pnpm test --pool=forks --maxWorkers=4 --minWorkers=1 | 2.882 passaram;219 ignorados;zero falhas | code-suite.log |
| PostgreSQL opt-in da precondição | 17 passaram;zero falhas;cluster parado e removido | code-postgres.log |
| Auditoria estática pelo mesmo script via Node loader | exit0;44 avisos e6 lacunas conhecidas | code-tenant-audit.log |

Todos os comandos receberam ambiente limpo `env -i PATH=/usr/local/bin:/usr/bin:/bin NODE_ENV=test CI=1`; somente o PostgreSQL recebeu `PROFILE_ACL_LAB=1`. O comando dedicado de banco foi `pnpm exec vitest run server/lead-profile-precondition-postgres.test.ts --pool=forks --maxWorkers=1 --minWorkers=1`; tipos usaram `pnpm exec tsc --project .superpowers/sdd/lead-profile-precondition/test-tsconfig.json`; auditoria usou `node --import tsx scripts/tenant-coverage-audit.ts`. A limitação de IPC do invocador tsx foi documentada anteriormente; não há reivindicação de novo PASS do invocador pnpm audit:tenant.

São os mesmos32 testes novos da entrega anterior, não32 adicionais. Houve2.899 casos distintos aprovados;202 casos históricos não executados. As219 omissões da suíte normal incluem17 casos opt-in executados separadamente. A prova RED anterior continua preservada e vinculada por hashes, sem nova reprodução anunciada. Oito hashes de fonte/teste do commit conferem com a candidata efetivamente exercitada naquela prova.

## Estado das linhagens e fronteira de integração

Leitura remota atual, sem fetch/pull:

- main: `8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf`.
- workflow: `f60cf9a56679d4d7083b2c11ac4e2727d53d84c3`.
- security e head da PR9: `b95ea0bf4741646f418fcc99a22d22a42d24be51`.
- branch publicada G3a-3: `29c464931184de02556926fed4486ab93024185f`.
- Branch G2-1 e nova branch da precondição não têm ref remoto observado. A base local622e6afb está4 commits à frente de29c46493; seus encerramentos locais não equivalem a publicação.

A comparação GitHub de `233569d68c014712ce3d25326bda8823aab1987e` até main8fa mostra6 commits e5 arquivos documentais: README, template de PR, roadmap de capacidades e2 documentos canônicos. Isso mede o delta remoto, sem copiar documentos entre linhagens nem testar merge local. A comparação remota8fa..622 retornou404, coerente com o head local não publicado; esse erro não prova conflito nem mergeabilidade. O objeto main8fa continua ausente localmente e não foi recuperado automaticamente.

PR9 permanece OPEN, não draft, sem merged_at; sua metadata de base continua233569d6, divergente da main remota atual. Campo mergeable ou merge_commit_sha de simulação não demonstra aprovação nem merge ocorrido. Não houve alteração da PR.

A consolidação aqui contém a correção de perfil sobre a cadeia local já aprovada. **Não é uma integração validada com main nem um fechamento da PR9.** Task6, PR12/13, F5b, G3a-2/G3a-3 e G2-1 conservam seus encerramentos e limites; não foram reabertos. G2 permanece aberta e PR9 NO-GO.

## Revisões e capacidades

Revisão pré-commit independente: `/root/lead_integration_review`,35/35 hashes e tamanhos,3/3 helpers idênticos e33/33 artefatos anteriores preservados; zero achado acionável. Esse parecer não é transferido automaticamente para o novo SHA. Revisões interna e independente posteriores à criação do código e conferência do commit documental são registradas separadamente no dossiê da consolidação.

Matriz de impacto: as10 linhas de `lead-profile-precondition-evidence.md` continuam aplicáveis ao diff idêntico: P-01,P-02,P-03,P-06,C-01 diretos; P-05,C-02,C-06,C-07 eP-09 indiretos/limitados. Nenhum ID, status, agregado ou dimensão canônica foi alterado. A consolidação não adiciona comportamento, consumidor, esquema, endpoint ou dependência. O novo registro muda apenas a identidade e o estado documental da entrega.

A revisão interna de qualidade é separada da revisão independente. O controlador/autor não se apresenta como revisor independente. O gate formal, quando registrado, vale exclusivamente para o SHA/claim/transição local nomeados; não dispensa o aceite humano de publicação e implantação.

## Condições antes de um piloto de campo

Não há prova suficiente para estimar prazo/percentual de prontidão. Sequência de trabalho:

1. Reconciliar e revisar a candidata integrada com main/PR9, incluindo mudanças ainda locais; não transferir vereditos entre SHAs.
2. Fechar a exposição remanescente de G2 e os bloqueios explícitos de G1 rule-F2/F5 e G4a, nos seus escopos aprovados.
3. Resolver os escritores de identidade/privilégios restantes e o contrato físico de IDs/FK antes de provisionar operadores.
4. Verificar o ambiente efetivo: grants/policies, conexão/identidade, alterações de banco ensaiadas, recuperação e acesso administrativo preservado. O estado atual de contenção do Supabase não foi consultado nesta rodada.
5. Ensaiar a versão candidata em ambiente representativo pelo percurso login→lead→cliente/projeto→scope/review→estimate/export, com persistência, recusas entre tenants, auditoria e recuperação conferidas. O escopo funcional do piloto precisa determinar a necessidade de upload de desenhos e demais dependências operacionais.

G3b/G4b e legado/backfill mantêm disposição própria; não se tornam automaticamente bloqueios de toda unidade ou da PR9. Qualquer dependência concreta do piloto deve ser avaliada no seu cenário aprovado.

**Continuidade recomendada:** desenho delimitado de listagens/agregados G2 e seus consumidores sobre a nova base local. O inventário estático pode ser preparado nesta rodada; implementar o recorte e escolher mudanças funcionais de filtros, UUIDs/seed exigem especificação revisável própria. Não foi criado um identificador “G2-2”. Nenhuma automação, Phase3, publicação, deploy, migration, seed/backfill ou reativação de API integra esta entrega.
