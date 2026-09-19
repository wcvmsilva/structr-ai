# Plano de implementação — C-20 e proveniência delimitada de P-09

> **Reconciliação 18/09/2026 — PROPOSTA / EVIDÊNCIA HISTÓRICA.** Documento local task5 incorporado como planejamento atribuído, não como novo aceite de arquitetura, implementação ou liberação. C-20/C-21/C-22 permanecem não implementados por esta publicação; decisões ainda propostas não são promovidas a aprovadas. O [estado atual](../engineering/current-state.md) prevalece sobre próximas ações e status antigos. Resultados e linhas de código preservam sua base temporal.


**Estado:** decomposição local preparada em 2026-09-10. Planejamento autorizado; tarefas de implementação ainda não executadas. Base: [desenho v3](proposal-issuance-technical-design-v3.md), [PRD](commercial-authorization-first-delivery.md) e [AGENTS.md](../../AGENTS.md).

**Retomada vigente:** a aprovação de 2026-09-11 e a sequência F5b / C-20 estão registradas em [plans/current-sprint.md](../../plans/current-sprint.md). As seções iniciais preservam as propostas e a execução histórica; a seção 8 registra o avanço atual da preparação, sem declarar implementação comercial.

O objetivo da primeira entrega é preparar conteúdo comercial congelado, registrar sua transmissão e permitir uma decisão verificável sobre essa transmissão. Exportação, aceite e autorização de execução continuam separados. Este plano não autoriza execução em produção, migração remota ou publicação.

## 1. Decisões que fecham a entrada da implementação

Concentrar estas decisões na tarefa M00; não reabrir a revisão global das 48 capacidades. Os itens abaixo não estão aprovados apenas por constarem neste documento.

| ID | Escolha a registrar | Recomendação concreta |
|---|---|---|
| D1 | Canal e evidência inicialmente habilitados | E-mail transmitido fora do sistema; registrar message-id ou referência operacional, destinatário, data e justificativa verificável. A referência permanece declarada, sem busca automática de e-mail |
| D2 | Política de confirmação | Outro operador autorizado examina a evidência externa e registra decisão e fundamento. Sem política aprovada, o caminho `verified` não pode ser habilitado |
| D3 | Conteúdo exibido ao cliente | JSON comercial; itens detalhados com preços de venda; montagens como identificação/agrupamento sem segunda soma. Termos explícitos na proposta, notas ao cliente separadas das internas. Aprovar os campos e conteúdo mínimo dos termos |
| D4 | Persistência e mudanças compartilhadas | PostgreSQL conforme runtime observado; três tabelas novas; modo tx estrito em auditoria; versionador existente passa a operar atomicamente. Aprovação arquitetural delimitada, sem editar o manual automaticamente |
| D5 | Armazenamento e piloto | Definir armazenamento autorizado e acesso por tenant; preservar artefatos e órfãos durante o piloto, sem limpeza automática. Nomear responsável por capacidade/retencão e definir revisão operacional antes da liberação |
| D6 | Identificação e testes | Atribuir número de sprint e definir PostgreSQL de teste isolado, com duas conexões independentes. Nenhum ambiente de produção serve como fixture |

A preferência de canal foi solicitada ao usuário durante esta preparação. Em 2026-09-11, após nova autorização para avançar, e-mail externo com registro manual foi adotado como hipótese de trabalho comunicada ao usuário. Não registrar essa hipótese como resposta explícita à pergunta nem como aprovação de todas as políticas de D1–D6. OD-06 e OD-10 continuam abertas no âmbito global.

## 2. Ajustes de contrato a incorporar antes de escrever funções

Esta seção complementa explicitamente o v3 e deve ser incorporada ao contrato aprovado em M00.

1. **Rechecagem idempotente após espera por bloqueio.** No `prepare`, consultar recibo/proposta concluída também depois de adquirir os bloqueios de projeto/origem, antes das guardas do estado atual. Se outro `prepare` terminou e uma versão foi criada enquanto esta requisição esperava, o replay autorizado retorna o resultado já concluído. Não gerar erro de origem supersedida para uma operação cujo sucesso já foi registrado.
2. **Recibo de decisão definido.** Tabela proposta `proposalDecisionReceipts`: id, tenantId obrigatório, transmissionId obrigatório, operation, clientRequestId, requestHash, requestSchemaVersion, actorId, resultSnapshot mínimo, createdAt. Unicidade `(tenantId, operation, clientRequestId)`; FK composta para a transmissão e índice correspondente. Recibo é imutável; não é fonte do estado atual da transmissão. A resposta distingue `replayed`, resultado original e estado atual permitido.
3. **Decisão inicial e concorrência.** Transmissão nasce `unverified`, decisionVersion=0 e campos de decisão nulos. Toda decisão nova exige expectedDecisionVersion, incrementa uma vez e grava auditoria/recibo atomicamente. Definir transições aceitas para `unverified`, `verified` e `disputed`; a recomendação é permitir nova avaliação explícita com nota, sem alterar o fato registrado. Replay não incrementa a versão.
4. **Histórico legível e restrito.** Expor somente decisão, versão, autor, horário e nota autorizados; não retornar before/after genéricos contendo snapshots internos. `proposal:read` não concede leitura de custos. Para a primeira entrega, não criar endpoint de leitura do snapshot interno.
5. **Limites de input.** Proposta inicial para revisão: termos de 1 a 20.000 caracteres; customerNotes até 4.000; recipient até 320, validado conforme canal; evidenceRef até 2.000; decisionNote de 1 a 4.000; timestamps ISO com fuso e normalização UTC; chaves UUID; hash hex de 64 caracteres. Não usar trim ou normalização que mude silenciosamente os termos transmitidos: validar e hashear exatamente o texto aceito. Fixar esses limites em schemas compartilhados e testes de fronteira.
6. **Tamanho e erro de artefato.** Definir limite de bytes e timeout do adapter em D5; a UI informa a falha sem declarar proposta preparada. Download retorna os bytes persistidos autorizados, ou indisponibilidade; não regenera silenciosamente outra representação sob o mesmo hash.

## 3. Microtarefas e dependências

Cada tarefa de comportamento começa por teste que falha pelo motivo esperado, implementação mínima e refatoração. A ordem de entrega segue schema → relações → taxonomy → engine → DB → router → testes organizados → UI do manual; os testes relevantes são escritos antes do comportamento, não deixados para depois da UI. Não existe exigência de duração de 2–5 minutos.

| ID | Depende de | Trabalho delimitado | Evidência de conclusão |
|---|---|---|---|
| M00 | — | Registrar D1–D6; consolidar contratos da seção 2 e matriz de acesso por endpoint | Decisões e contrato revisados, com responsáveis; sem assumir aprovação de publicação |
| M01 | M00 | Confirmar SHA de partida e inventariar escritores de campos do sourceToken e consumidores de audit/versionamento | Mapa de origem → escritor → bloqueio/validação, com referências; baseline local preservada |
| M02 | M01 | Preparar fixture PostgreSQL descartável e sincronização determinística entre duas conexões | Teste demonstra transação real e bloqueio; não usa sleeps como prova de concorrência; dados isolados |
| M03 | M02 | Adicionar schema das três tabelas, índices e FKs compostas | Testes recusam tenant nulo, vínculo cruzado e chaves duplicadas; tabelas legadas intactas |
| M04 | M03 | Adicionar relações e migração, proteção das colunas imutáveis e política sem cascata destrutiva | Migração validada no banco de teste; update proibido é recusado; metadados permitidos continuam válidos |
| M05 | M04 | Definir taxonomy, DTOs e schemas de input/resposta | Campos extras, enums indevidos e limites violados são recusados; nenhuma enum inline de domínio |
| M06 | M05 | Implementar canonicalJsonV1 e os hashes de conteúdo, origem e requisição | Mesmos dados normalizados geram mesmos bytes; versões e intenções distintas são diferenciadas |
| M07 | M06 | Implementar builders dos snapshots público e interno | Custos aninhados, notas internas e campos não aprovados não aparecem no snapshot público |
| M08 | M05 | Implementar deriveProposalStatus e regras puras de decisão | Cobrir zero transmissões, combinações e disputa da única transmissão verificada |
| M09 | M05 | Adicionar modo estrito `logAudit(params, tx)` | Erro da auditoria aborta negócio; chamada antiga sem tx preserva seu comportamento |
| M10 | M02, M09 | Tornar atômicos o versionador existente e o alocador compartilhado com createChangeOrder, usando a mesma ordem de bloqueios | Versão × versão, versão × change order e change order × change order não duplicam número por projeto; falhas não deixam sucessor parcial; regressões existentes passam |
| M11 | M06, M07 | Implementar adapter do artefato JSON e releitura autenticada dos bytes | Upload, HTTP inválido, hash divergente e timeout falham corretamente; sem URL arbitrária fornecida pelo cliente |
| M12 | M03, M05 | Implementar resolvers e políticas de acesso a proposta/transmissão/replay | Matriz de permissões validada inclusive em recursos de outro tenant e projeto |
| M13 | M07, M09, M10, M11, M12 | Implementar prepare em duas fases, rechecagens e ON CONFLICT | Artefato e snapshot correspondem à origem final; replay estável antes/depois de supersessão; duas ordens de concorrência cobertas |
| M14 | M09, M12, M13 | Implementar registro de transmissão, requestHash e reenvio | Retry retorna o registro anterior; payload divergente falha; reenvio é outro evento do mesmo recurso |
| M15 | M08, M09, M12, M14 | Implementar decisão com expectedDecisionVersion e recibo | Decisão/audit/recibo vivem ou morrem juntos; replays posteriores não reescrevem decisões novas |
| M16 | M11–M15 | Implementar consultas, histórico filtrado e download | Snapshot interno não vaza; estado deriva de dados atuais; artefato indisponível não é substituído |
| M17 | M05, M13–M16 | Montar os sete endpoints no router principal | Testes de chamadas reais ao router cobrem autenticação, Zod, permissões, respostas e erros |
| M18 | M17 | Integrar EstimateDetail, ProposalDetail, rota lazy e navegação | Fluxo completo visível: preparar → baixar → registrar → decidir → consultar; aprovação interna explicitamente distinta |
| M19 | M18 | Executar cenários integrados de R1–R10 e regressão dos consumidores compartilhados | Evidências observadas; zero efeito de aceite/liberação de execução; orçamento e exportadores existentes preservados |
| M20 | M19 | Atualizar matriz de impacto e evidências das capacidades afetadas | Referências e dimensões separadas no SHA revisado; nenhuma promoção global ou fechamento implícito de OD |
| M21 | M20 | Revisão independente do pacote e preparação do registro de entrega | Revisão por autor diferente, achados resolvidos ou delimitados; publicação continua etapa própria |

Não executar M03 em ambiente remoto. Não modificar scripts de deploy, proteções ou segredos. Alterações em consumidores compartilhados descobertas em M01 entram na matriz antes de ampliar a implementação.

## 4. Testes e comandos da futura execução

O projeto usa `pnpm check` → `tsc --noEmit` e `pnpm test` → `vitest run`. `vitest.config.ts` inclui testes em `server/`. Os testes atuais de fluxo em `server/phase2-flow.test.ts` usam persistência simulada; eles não comprovam bloqueios reais ou semântica de índices no PostgreSQL.

Criar os quatro arquivos segundo o número atribuído em D6: `server/sprint[N]-proposal-engine.test.ts`, `server/sprint[N]-proposal-db.test.ts`, `server/sprint[N]-proposal-router.test.ts` e `server/sprint[N]-proposal-integration.test.ts`. Substituir `[N]` pelo número acordado antes de criar arquivos. Mínimos: 20 engine + 20 DB + 15 router + 5 integração = 60 testes comportamentais; testes adicionais nos módulos compartilhados não substituem lacunas de cobertura.

Comandos reais disponíveis, para usar durante implementação, não executados neste planejamento:

```sh
pnpm exec vitest run proposal
pnpm exec vitest run server/phase2-flow.test.ts server/sprint26-pipeline-integration.test.ts
pnpm check
pnpm test
git diff --check
```

O filtro `proposal` seleciona os novos arquivos após sua criação; verificar que os testes esperados foram coletados. A seleção de regressão é inicial: M01 acrescenta os testes dos consumidores efetivamente afetados. O setup isolado de M02 deve ter comando e descarte documentados antes de rodar os testes reais de banco. Não redirecionar uma variável de conexão de produção para satisfazer a suite.

| Grupo | Cobertura mínima relevante |
|---|---|
| Engine | Projeção recursiva, identidade de conteúdo, datas fixas, números inválidos, requestHash, estado derivado e limites de decisão |
| DB | Índices/FKs, autorização antes de replay, concorrência em duas conexões, sourceToken, rollback de audit/recibo, imutabilidade e versionamento |
| Router | Sete endpoints, permissões positivas/negativas, acesso cruzado, inputs extras, conflitos e respostas sem campos internos |
| Integração | Preparação até decisão; disputa após verificação; replay após decisão posterior; falha do storage; independência de aceite e execução |

A integração de UI deve ser demonstrada no ambiente de teste; teste Node de presença de componente não equivale a fluxo de navegador. Falhas e skips precisam constar no relatório final com motivo; não contar teste ignorado como validação concluída.

## 5. Matriz de impacto da implementação

| Capacidade | Alteração / limite | Microtarefas |
|---|---|---|
| C-20 | Novo percurso de emissão rastreável | M03–M08, M11–M19 |
| P-09 | Proveniência restrita a este percurso; lacunas internas de pricing permanecem explícitas | M06, M07, M11, M13–M16 |
| C-14 | Consumo da aprovação e mudança no versionador existente | M01, M10, M13, M18, M19 |
| P-10 | Artefato específico de proposta; exportadores existentes mantêm seus contratos | M11, M16, M19 |
| P-02, P-03 | Acesso, tenant obrigatório e vínculos coerentes | M03, M12, M17, M19 |
| P-05, P-06 | Auditoria estrita, três tabelas e transações | M03, M04, M09, M13–M16 |
| C-06, C-07 | Identidades existentes como referência; sem nova formação automática | M01, M03, M12, M19 |
| C-21, C-22, C-33 | Limites: emissão não produz aceite, Execution Baseline ou autorização de obra | M08, M17–M20 |

## 6. Saída desta etapa

Entregue: decomposição, dependências, contratos complementares, cobertura e comandos disponíveis. Não entregue: implementação, testes executados, migração, revisão independente ou liberação operacional. O plano é executável por etapas depois de registrar D1–D6; não deve ser apresentado ao executor como se essas escolhas já estivessem decididas.

Ao concluir a implementação, usar o relatório de AGENTS.md: TypeScript, novos testes/total/falhas, arquivos, tabelas, funções, helpers, endpoints, proteção, auditoria e regressões. Registrar SHA e revisão reais. Nenhum resultado de check deste planejamento é substituto para essa evidência futura.

## 7. Execução preparatória — 2026-09-11

Esta seção atualiza a saída da seção 6: houve agora um experimento de infraestrutura real, ainda sem implementação comercial. Base local conferida: `91d083c2aa1e5b92c88b3a77a808f196c8d92012`; árvore `3763b0a2909cbf3c295d96b939078cb8b67d2b43`. Não foi feita nova conferência remota nesta etapa.

### Inventário inicial de escritores (M01 parcial)

Busca de chamadas literais de insert/update/delete sobre `estimateDrafts`, excluindo testes:

| Arquivo | Escritores encontrados | Consequência para a implementação |
|---|---|---|
| `server/estimate-db.ts` | createEstimateDraftFromCalculator; updateEstimateDraftStatus; updateEstimateDraftNotes; applyEstimateDraftDiscount; approveEstimateDraft; rejectEstimateDraft | O token precisa cobrir conteúdo e evidências de aprovação, não apenas número da versão ou updatedAt |
| `server/db.ts` | createEstimateDraft | Incluir a formação da origem no mapa de proveniência |
| `server/estimate-version-db.ts` | createEstimateVersion; createChangeOrder | Ambos usam nextVersionForProject; proteger apenas createEstimateVersion deixa o alocador vulnerável à concorrência com change orders |

Há 43 módulos de produção com import estático de `audit`; essa contagem inclui leitores e não significa 43 mutações. A compatibilidade da variante transacional estrita exige separar esses consumidores antes de alterá-la. O inventário ainda não encerra escritores indiretos, SQL bruto, aliases ou campos de projeto/cliente usados pelo snapshot.

**Aprovação da origem requer verificação adicional:** `server/estimate-router.ts:160` aceita `approved` em updateStatus, e o endpoint em `:457` chama o helper genérico. `server/estimate-db.ts:324` valida a transição e grava somente status; a função dedicada em `:488` executa Profit Shield e grava approvedBy, approvedAt, lockedAt e a avaliação. Portanto, status igual a approved isoladamente não prova passagem pela aprovação dedicada. M01/M13 devem especificar e testar a evidência exigida da origem e a resposta para registros incompletos. Isso é uma constatação de código, sem consulta a dados existentes ou afirmação de exploração operacional; não houve mudança nesses endpoints.

### Experimento PostgreSQL (M02 parcial)

Resultado em `2026-09-11T11:04:19.726Z`: **5 verificações aprovadas**, PostgreSQL `17.11 (Homebrew)`, cliente postgres-js da instalação local. Cluster criado exclusivamente em diretório temporário privado, com socket Unix e `listen_addresses=''`; nenhuma conexão ou variável DATABASE_URL da aplicação foi usada. O processo foi encerrado e o diretório removido ao final.

1. TCP desabilitado, confirmado consultando a configuração do servidor.
2. Duas conexões de trabalho disputaram a mesma linha; uma terceira observou o bloqueador por `pg_blocking_pids`. Após os commits, o valor foi 11: atualização para 10 seguida de incremento. O tempo decorrido não foi usado como prova do bloqueio.
3. Duas inserções concorrentes com ON CONFLICT DO NOTHING e leitura subsequente retornaram o mesmo resultado, com apenas uma linha persistida.
4. Violação de CHECK na tabela de auditoria experimental produziu erro 23514 e rollback da alteração de negócio e da auditoria.
5. Tenant nulo foi rejeitado por NOT NULL, erro 23502.

A execução inicial encontrou restrição de memória compartilhada no sandbox; a repetição autorizada fora dele passou. O experimento usou três tabelas mínimas próprias, não o schema comercial nem logAudit da aplicação. Foi executado por script temporário, ainda não convertido em fixture reproduzível do projeto. Não conta entre os 60 testes da sprint. `pnpm check` e `pnpm test` não foram executados nesta etapa.

Próximo trabalho técnico: persistir a fixture descartável com descarte garantido e fechar o contrato de aprovação da origem; depois aplicar o mesmo protocolo de concorrência aos dois consumidores do alocador. M01 e M02 permanecem parciais até que esses entregáveis existam. Nenhuma migração ou liberação operacional foi realizada.

## 8. Retomada aprovada — 2026-09-11

O usuário aprovou o checkpoint proposto nesta tarefa com “aprovado, segue”. A prioridade registrada é F5b como primeiro piloto de implementação e C-20/P-09 como próxima entrega de produto; M01/M02 avançam como preparação. Esta decisão resolve a lacuna de sequência identificada na análise anterior. As escolhas operacionais que ainda faltam estão concentradas no [plano vigente](../../plans/current-sprint.md), sem novas revisões globais do registro.

### Entregáveis desta retomada

- Registro de prioridade e decisões M00 no plano vigente.
- [Contrato de origem e inventário M01](proposal-source-contract.md), incluindo o significado da aprovação, escritores de orçamento/projeto/cliente, leitores de auditoria e seis testes de caracterização.
- Fixture PostgreSQL reproduzível M02 e [instruções de execução e descarte](postgres-preparation-tests.md).
- [Recuperação e desenho delimitado de F5b](../../plans/f5b-pilot-design.md), para que o piloto comece do escopo correto: `assignZoneToProject` e `persistGeocodeResult`, na linhagem de segurança.

As contagens e a revisão independente estão registradas abaixo após execução. Esta seção não transfere os cinco resultados do experimento temporário para a nova fixture nem para o código comercial.

### Complementos de M01 para revisão do contrato

O inventário encontrou dependências adicionais que devem ser decididas junto de M00. Estas são propostas explícitas para incorporar à futura execução, não mudanças já implementadas ou decisões arquiteturais presumidas:

| Microtarefas afetadas | Complemento delimitado | Critério necessário |
|---|---|---|
| M00, M05, M09, M13 | Prova de aprovação vinculada ao conteúdo e atualização do endpoint/helper de status já existente; marcador versionado é a opção proposta | Aprovação genérica não contorna Profit Shield; conteúdo alterado não usa evidência antiga; nenhuma reaprovação em massa |
| M10 | Preservar cliente e desconto na cópia de versão, além de proteger ambos consumidores do alocador | Versão preserva origem comercial coerente; total líquido não perde a explicação de desconto |
| M12, M13 | Proteger cliente além de projeto/origem na leitura final; ordem proposta projeto → origem → cliente | Alteração concorrente de cadastro não confirma snapshot/token divergentes |
| M09, M12, M16, M19 | Impedir que eventos comerciais novos apareçam no feed genérico de auditoria sem autorização de recurso/tenant; snapshots internos fora de audit genérico | Teste inclui consumidores indiretos, não apenas a resposta de proposal.getById |

As seis caracterizações exercitam os helpers atuais com persistência e auditoria isoladas. Elas expõem diferenças e lacunas existentes; não aprovam essas lacunas como comportamento futuro. Ao corrigir os caminhos existentes, substituir as expectativas de lacuna por rejeição/delegação conforme o contrato aprovado. Não contam como testes dos endpoints comerciais ainda inexistentes.

### Verificação executada nesta árvore de trabalho

Registro consolidado em **2026-09-11T11:41:17Z** pelo agente coordenador desta tarefa. Base local `91d083c2aa1e5b92c88b3a77a808f196c8d92012` mais os arquivos de preparação sem commit; não se atribui um novo SHA Git antes que exista. O coordenador executou novamente os comandos abaixo após receber os testes dos autores. PostgreSQL local observado: 17.11. Nenhuma migração do produto foi aplicada.

| Verificação | Resultado observado |
|---|---|
| `env -u DATABASE_URL pnpm check` | Exit 0, nenhum erro TypeScript |
| `env -u DATABASE_URL pnpm test` | 52 arquivos passaram, 1 ignorado; **2.285 testes passaram, 79 ignorados, 0 falhas**; início 11:38:18 UTC, duração 21,80 s |
| `env -u DATABASE_URL pnpm exec vitest run --config vitest.postgres.config.ts` | **9 passaram, 0 ignorados, 0 falhas**; início 11:40:20 UTC, duração 11,26 s; execução local fora do sandbox, após aprovação automática, para permitir memória compartilhada |
| Descarte | Nenhum diretório `str-pg-*` no diretório temporário ao final; testes verificaram parada dos processos em conclusão normal e erro do callback |
| Whitespace e referências | `git diff --check` exit 0; checagem adicional dos nove arquivos novos/alterados de preparação passou, **116 destinos locais de links existentes**, sem whitespace final ou newline ausente |

**Testes novos nesta preparação: 15** — seis caracterizações incluídas na suíte principal e nove de infraestrutura na configuração dedicada. A suíte principal anterior executada na mesma retomada tinha 2.279 aprovados e os mesmos 79 ignorados. Os 79 skips permanecem limitações conhecidas: não contam como validação. Os diagnósticos de `OAUTH_SERVER_URL` ausente e `ensureProfileExists` ausente em um mock também ocorreram no baseline e foram preservados; não houve correção desses módulos nesta etapa. Não se declara uma sprint comercial de 60 testes concluída.

O primeiro check concorrente com a criação dos testes de infraestrutura encontrou os tipos ainda incompletos durante o RED. Os tipos foram corrigidos, e o check final acima passou. Os autores registraram RED de nove casos antes da implementação da fixture e GREEN posteriormente. Na revisão independente, o revisor `audit_main` identificou herança indevida de `PGTARGETSESSIONATTRS`; o autor reproduziu RED com valor hostil, fixou `read-write` e obteve GREEN. Também reproduziu a captura de `PGPASSWORD` e substituiu o valor vazio por senha fictícia explícita da fixture. A revisão final de leitura confirmou ambas as correções e **nenhum P1/P2 remanescente nos quatro arquivos de código/teste examinados**. Esse resultado é uma revisão técnica da preparação, não um gate de segurança de F5b nem avaliação global do produto.

Identidade dos arquivos executáveis verificados (SHA-256 do conteúdo, distinta do SHA Git):

| Arquivo | SHA-256 |
|---|---|
| `server/test-support/disposable-postgres.ts` | `a67477af329fb616b6a8e36521f1ec4538513a667428c5003c4982536894da53` |
| `server/postgres-fixture.integration.ts` | `dd0a5a76aa1d18e2a06511d5c7d15044f975add121d08cbd5ea8d151066f8dd8` |
| `server/proposal-source-approval.test.ts` | `3ddabe2fbb397017c803a2c1abbe05534c5865025920b85dbd554b053d676556` |
| `vitest.postgres.config.ts` | `7020cc213b2cc0a159d9e4a9d0f2edcd7745ec97295d2a218a77353bdfba6e0e` |

### Saída e próximo marco

**Entregue:** prioridade aprovada registrada; recuperação/medição/desenho proposto de F5b; inventário e contrato proposto M01 com caracterizações; fixture e evidência M02 reproduzíveis. **M00 permanece parcial**: formato comercial e política de verificador foram consultados ao usuário, sem resposta registrada nesta execução; termos, armazenamento/retencão e detalhes arquiteturais novos continuam decisões delimitadas antes de suas tarefas dependentes. O silêncio não foi tratado como aprovação.

O próximo marco é revisar o [desenho F5b](../../plans/f5b-pilot-design.md) e estabelecer seu candidato de implementação na linhagem de segurança. O pacote já identifica os dois helpers, todos os consumidores encontrados, a fronteira de atomicidade e os critérios de prova. Não repetir a descoberta genérica ou a Task 6. A futura implementação comercial segue após sua entrada aprovada; seus artefatos JSON, tabelas, endpoints e interface ainda não foram implementados.

Arquivos produzidos nesta retomada: `plans/f5b-pilot-design.md`, `docs/product/proposal-source-contract.md`, `docs/product/postgres-preparation-tests.md`, os quatro arquivos de código/teste acima. Atualizados: `plans/current-sprint.md` e este plano de implementação, que já existia como arquivo local não rastreado. O PRD e o desenho v3 anteriores foram preservados. Novas tabelas de negócio, engines, helpers de negócio e endpoints: **zero**. Nenhum commit, push, merge ou deploy realizado; não há novo resultado de publicação.

## Correção delimitada de 18/09/2026

O candidato atual recusa `approved` pelo endpoint/helper genérico de status, preservando a aprovação dedicada. A observação histórica de aprovação genérica sem avaliação deixou de representar esse candidato; o teste local `server/proposal-source-approval.test.ts` que esperava esse sucesso não foi incorporado. Isso resolve somente o desvio específico, não prova de aprovação vinculada ao conteúdo, invalidação/versionamento, emissão comercial ou armazenamento. Os quatro executáveis de preparação task5 continuam externos a esta integração e suas contagens são históricas. Ver [contrato corrigido](../engineering/estimate-approval-entrypoint.md).
