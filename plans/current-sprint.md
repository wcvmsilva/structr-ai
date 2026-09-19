# Plano vigente — reconciliação de progresso, 2026-09-18

**Estado atual em 19/09:** candidato de integração publicado no PR #14, observado em `57f63042924d71d60304ebaa04a47a0fe6b2e170`, com correções remotas de CI/hospedagem em andamento. O usuário autorizou concluir a consolidação e depois implementar as lacunas dos [playbooks](../docs/planning/PLAYBOOK-EXECUTION-ROADMAP.md). Os registros do PR #15 estão conciliados nesta versão; PB-00 ainda depende do candidato final e da integração verificada. Horas/apontamentos estão pausados. O [estado de engenharia](../docs/engineering/current-state.md) e o [relatório de reconciliação](../docs/engineering/progress-reconciliation-2026-09-18.md) registram o progresso atual e a publicação quando observada. Não existe liberação de produção/campo por este documento.

**C-20 continua PROPOSTA / preparação, com M00 parcial.** Os sete documentos de planejamento são incorporados como registros atribuídos, sem importar os quatro executáveis locais da preparação: `server/test-support/disposable-postgres.ts`, `server/postgres-fixture.integration.ts`, `server/proposal-source-approval.test.ts` e `vitest.postgres.config.ts`. As contagens de 11/09 pertencem à árvore task5 e não são validação desta integração. C-21 e C-22 continuam entregas distintas, não implementadas por esta reconciliação.

**Correções de sequência:** Tasks 1–6 já estão encerradas; F5b já possui implementação ancestral no candidato atual, mas fechamento formal/retrospectiva não foi verificado. Não repetir F5b a partir da instrução histórica abaixo. O desvio de aprovação genérica identificado pela preparação foi corrigido no candidato de manutenção; a caracterização antiga que aceitava esse desvio precisa ser substituída antes de qualquer futura importação. O laboratório interno de um operador não resolve automaticamente o verificador ou a política comercial C-20.

## Registro histórico atribuído — preparação de 11/09/2026

As próximas seções preservam o planejamento e as decisões observadas em 11/09; “vigente”, “próximo”, “não iniciado” e comandos nessa parte descrevem aquele momento. As correções acima e o estado de engenharia prevalecem para o trabalho atual. Caminho pessoal de checkout substituído por descrição portátil para publicação.

### Retomada registrada — F5b e preparação de C-20/P-09

Atualizado em 2026-09-11. Este arquivo é o ponto de entrada da execução local; não substitui o registro canônico nem os gates da linhagem de segurança.

## Decisão de sequência

O usuário aprovou a recomendação desta tarefa com **“aprovado, segue”** em 2026-09-11:

1. Preservar **F5b como primeiro piloto de implementação** do Controlled Engineering Workflow.
2. Preparar **C-20 — emissão rastreável de proposta**, com proveniência de P-09 limitada a esse percurso, como próxima entrega de produto.
3. Consolidar as decisões de entrada e concluir a preparação técnica M01/M02 já iniciada. Infraestrutura de teste não conta como implementação comercial nem como conclusão de F5b.

A implementação do piloto F5b requer seu escopo recuperado e desenho delimitado; não exige repetir Tasks 1–6, já encerradas. A retrospectiva do piloto antecede qualquer decisão de estabilização do Engineering Workflow v1.0 e abertura de Engineering Intelligence Discovery. C-21 (aceite) e C-22 (autorização de execução) continuam depois da entrega C-20.

## Bases verificadas

| Base | Estado observado |
|---|---|
| Trabalho desta retomada | `local task5 worktree`, branch `docs/canonical-structr-truth-v1`, HEAD `91d083c2aa1e5b92c88b3a77a808f196c8d92012`; alterações de preparação locais |
| `main` no GitHub | `8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf`, consulta via conector em 2026-09-11, registrada às 11:33:12 UTC |
| `main` na pasta principal local | `233569d68c014712ce3d25326bda8823aab1987e`; não é a referência atual de planejamento |
| Programa de workflow | Tasks 1–6 encerradas no registro `f60cf9a56679d4d7083b2c11ac4e2727d53d84c3` |
| Segurança / PR #9 | Aberto, não incorporado, head `b95ea0bf4741646f418fcc99a22d22a42d24be51`, consultado na mesma retomada; merge continua NO-GO |

As duas linhagens permanecem separadas. Não transportar a branch de segurança para `main` para recuperar documentação. Os resultados de revisão de uma linhagem não validam a outra.

## Trabalho delimitado desta preparação

| Unidade | Entregável | Situação desta retomada |
|---|---|---|
| Sequência | Prioridade F5b → próxima entrega de produto C-20 registrada | Aprovada pelo usuário e registrada acima |
| Recuperação F5b | Identificar a definição exata, as fontes e a próxima medição/desenho | [Medição e desenho entregues](f5b-pilot-design.md); proposta para revisão, implementação não iniciada |
| M00 | Consolidar D1–D6 e contratos de entrada | Prioridade resolvida; escolhas de produto em consulta; detalhes de liberação ainda pendentes |
| M01 | Inventário finito de origem/escritores e contrato de aprovação | [Contrato entregue](../docs/product/proposal-source-contract.md), com seis caracterizações; decisões arquiteturais ainda propostas |
| M02 | Fixture PostgreSQL descartável, testes reais e instrução reproduzível | Implementada com nove testes de infraestrutura e [execução documentada](../docs/product/postgres-preparation-tests.md); resultados na seção 8 do plano |
| Evidência | TypeScript, suíte existente, testes dedicados e revisão independente | [Registro de execução](../docs/product/proposal-issuance-implementation-plan.md#8-retomada-aprovada--2026-09-11) |

## Decisões M00

O “aprovado, segue” autoriza esta retomada e sua sequência. Não é registrado como resposta a escolhas que ainda não foram apresentadas. O pacote abaixo concentra os detalhes para evitar sucessivas revisões globais.

| ID | Contrato de trabalho concreto | Estado / limite |
|---|---|---|
| D1 — canal | E-mail enviado externamente; registrar destinatário, instante, referência do comprovante e justificativa; referência é declarada e não é buscada automaticamente | Hipótese de trabalho mantida do plano anterior; envio automático fora do recorte |
| D2 — verificação | Permissão distinta de registrar; recomendação de segundo operador, com justificativa e histórico de decisões | Preferência solicitada nesta tarefa; nenhuma decisão `verified` está sendo habilitada nesta preparação |
| D3 — conteúdo | Recomendação de piloto interno com JSON comercial, preços de venda e termos explícitos; custos/notas internas excluídos; PDF para cliente é alternativa de escopo | Formato solicitado nesta tarefa; conteúdo mínimo dos termos será fornecido pela operação antes do piloto comercial |
| D4 — persistência | Preparação usa PostgreSQL isolado conforme runtime existente; desenho propõe três tabelas comerciais, auditoria estrita em transação e correção do versionador existente | PostgreSQL da fixture é infraestrutura de teste; não muda o manual nem aprova implicitamente novo schema ou driver |
| D5 — armazenamento | Nesta etapa somente diretório temporário privado com descarte garantido; futuro artefato comercial terá acesso por tenant e retenção explícita | Armazenamento comercial, responsável, retenção, limite de bytes e timeout permanecem requisitos de entrada do adapter M11; não usar produção para resolvê-los |
| D6 — identificação/testes | Preparação identificada como `PREP-C20-2026-09-11`; PostgreSQL local descartável com duas conexões de trabalho e uma observadora | Não é número de sprint comercial; atribuir `[N]` ao abrir sua implementação; testes da fixture não substituem os 60 testes comerciais |

As decisões de operação e arquitetura que faltam serão fechadas sobre este pacote concreto antes das tarefas que dependem delas. Preparação local pode avançar sem presumir autorização de liberação.

## Fontes e continuidade

- [Escopo comercial](../docs/product/commercial-authorization-first-delivery.md)
- [Desenho técnico v3](../docs/product/proposal-issuance-technical-design-v3.md)
- [Plano M00–M21 e registro de execução](../docs/product/proposal-issuance-implementation-plan.md)
- [Contrato da origem e inventário de escritores](../docs/product/proposal-source-contract.md)
- [Medição e desenho F5b](f5b-pilot-design.md)
- [Registro canônico](../docs/product/canonical-structr-truth-v1.md)
- [Manutenção incremental de evidências](../docs/product/feature-evidence-maintenance.md)
- [Workflow encerrado, SHA histórico](https://github.com/wcvmsilva/structr-ai/blob/f60cf9a56679d4d7083b2c11ac4e2727d53d84c3/docs/engineering/current-state.md)
- [PR #9, estado e escopo de segurança](https://github.com/wcvmsilva/structr-ai/pull/9)

## Critério de saída

Concluir a preparação requer inventário e contrato revisáveis, fixture executável com descarte demonstrado, resultados novos de `pnpm check`/`pnpm test`, testes dedicados e registro dos limites. O fechamento deve distinguir preparação concluída, escolhas pendentes e implementação não iniciada. Não promover capacidades do registro canônico com base em testes de infraestrutura.
