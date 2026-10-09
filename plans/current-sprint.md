# Plano vigente — acessos e jornada em homologação, 2026-10-08

> **Atualização — 9 de outubro:** A1/A2 leram o draft sintético e B1 foi bloqueada na homologação. Após a retirada auditada, os mesmos tokens ainda válidos foram recusados; sua conta O e o histórico permaneceram intactos. Perfis e organizações sintéticos estão inativos. Tipos/build e 7.610 testes gerais passaram, além de 17 físicos. Cadastro, jornada financeira e uso real permanecem fechados. [Evidências e próximo gate](../docs/engineering/homolog-project-access-proof-2026-10-09.md).

> **Entrega anterior — 8 de outubro:** PR #36 integrada à `main`, CI da PR e pós-merge aprovados, migration 0017 aplicada somente à homologação e preview da mesma árvore READY. A próxima etapa é provar leituras positivas e isolamento hospedado com dados controlados; formação, writers, comparação financeira e recuperação permanecem gates separados, sem liberação de projetos reais. [Publicação e limites](../docs/engineering/adr002-minimum-reads-2026-10-08.md#checkpoint-final-de-publicação-e-homologação--8-de-outubro); [donos e sequência](../docs/engineering/homolog-access-coordination-2026-10-08.md).

> **Checkpoint anterior à publicação — 8 de outubro:** PR #35 integrada e CI aprovado; operador confirmou Settings. Próxima fatia em execução: `getById`/`getInternalApproval` por URL conhecida, com UI parcial Munder concluída pelo Codex e backend integrado localmente; 361 testes focais de UI/sessão aprovados, verificação geral/publicação pendentes. Manus/Kimi/Perplexity fornecem insumos independentes. [Donos e gates](../docs/engineering/homolog-access-coordination-2026-10-08.md); [aceite da senha](../docs/engineering/auth-recovery-2026-10-08.md#troca-de-senha-em-settings--complemento-de-8-de-outubro). Recuperação por e-mail e jornada de negócio seguem pendentes.

> **Checkpoint anterior de recuperação de acesso — 8 de outubro:** retry de sessão e recuperação/troca de senha implementados e validados localmente. Próximo passo: publicação em homologação e execução pessoal do link de e-mail, definição da senha e novo login. [Registro e limites](../docs/engineering/auth-recovery-2026-10-08.md). A fatia de leitura mínima vem depois deste reparo; isolamento entre organizações e jornada completa continuam necessários para uso real.

> **Checkpoint anterior — 8 de outubro de 2026, 18:20 UTC:** login real e perfil `user` comprovados na homologação após a correção de permissão do schema. Isolamento entre organizações e jornada completa continuam pendentes; writers de negócio e uso com projetos reais permanecem fechados. [Evidências e próximos gates](../docs/engineering/homolog-session-schema-usage-2026-10-08.md#aplicação-hospedada-e-primeiro-login--1820-utc).

> **Checkpoint anterior — 8 de outubro de 2026, 17:57 UTC:** perfil `user` e emissor provisionados na homologação, com quatro auditorias e readbacks conferidos. Vercel autenticada; o próximo passo é o primeiro login no Structr e sua prova positiva, mantendo writers de negócio e uso com projetos reais fechados. [Evidências e limites](../docs/engineering/homolog-access-coordination-2026-10-08.md#checkpoint-provisionamento-administrativo-aplicado--8-de-outubro-1757-utc).

> **Checkpoint anterior — 8 de outubro de 2026, 16:13 UTC:** PR #30 integrada à `main` em `10ea3261`, com CI pós-merge aprovado e prévia isolada iniciando no modo autenticado. A conta Auth do operador existe; faltam vínculo protegido, configuração do emissor e prova positiva de sessão real, seguidos dos acessos por organização e da jornada de formação/aprovação/versionamento/exportação. [Coordenação e critérios de liberação](../docs/engineering/homolog-access-coordination-2026-10-08.md) definem os responsáveis e limites. Uso com projetos reais continua pendente.

> **Prioridade vigente — 7 de outubro de 2026:** ADR-002 aprovada e sessão/consulta de revisão implementadas, com 88 testes físicos novos aprovados. O [registro do recorte](../docs/engineering/adr002-review-access-2026-10-07.md) contém o fechamento de regressão/publicação e separa provas locais de homologação. Integração das operações de gravação e jornada com projetos reais permanecem pendentes. O fechamento A1 abaixo é histórico e conserva seus limites.

> **Integração do código concluída — 6 de outubro de 2026, 16:22:34 UTC:** [PR #26](https://github.com/wcvmsilva/structr-ai/pull/26) integrado à `main` em `749dbcd6d34093c630b320d5e79a74c5eaa82019`, com árvore idêntica à candidata revisada `a703ddb78b39db66f9e6f0f23eed7e3ca64a7960`. O [CI do PR](https://github.com/wcvmsilva/structr-ai/actions/runs/37494587635) passou nessa candidata. O hook local obrigatório passou o check sem erros e **6.484 testes, 951 ignorados, zero falhas**, sem bypass. O [CI pós-merge](https://github.com/wcvmsilva/structr-ai/actions/runs/37495212987) também passou em `749dbcd6d34093c630b320d5e79a74c5eaa82019`. Este registro não declara liberação de produção.

## Retomada ativa — 6 de outubro de 2026

O usuário autorizou o fechamento do fluxo completo, a atualização dos registros principais e a integração da entrega validada ao GitHub. O Codex assume a jornada sintética, a verificação integrada e a publicação; Michael mantém a revisão e a integração local da correção visual de Jim. As bases, os responsáveis, as pendências e as observações remotas estão no [estado atual de engenharia](../docs/engineering/current-state.md).

O recorte A1 usa **Intake → Calculator → revisão em USD → aprovação interna → exportação**, seguido de revogação e nova versão, incluindo criação ou seleção de cliente/projeto e geocode pelo produto. Michael aceitou e integrou localmente `59ab7418` e liberou a janela serializada em 6 de outubro às 15:28 UTC. O merge local `e2048c11` foi seguido pelas correções já incorporadas à fonte runtime `f6a80a18666b8586bde3fe8d208a7f3090221165`; a revisão independente de 20 blobs não encontrou P1/P2 remanescente no recorte. **Jornada sintética delimitada CONCLUÍDA em `f6a80a18`; integração do código CONCLUÍDA no PR #26.** O check fresco nesse SHA passou com zero erros, após corrigir o RED de tipagem e aprovar 63 regressões focais. A suíte geral nesse SHA passou 6.448 testes, com 951 ignorados (7.409 no total), em 180 arquivos aprovados e 32 ignorados, em 268,18 segundos, exit 0. Os 31 casos DB e 2 UI de Monitoring passaram, encerrando o GREEN dos cinco casos novos após RED. O build passou, exit 0; permanecem os avisos de analytics opcional ausente e chunks acima de 600 kB. As reduções físicas passaram 11/11 no rerun após corrigir as três falhas iniciais de fixture/wait graph; as dez suítes físicas de exportação passaram 331 casos. A limpeza de todos esses bancos foi confirmada. Separadamente, G3a2 físico instrumentado passou 9 casos sem habilitar calibração de produção. Não somar esses resultados ao total da suíte geral nem ocultar seus 951 skips. O ciclo de decisão físico passou 24/24 casos em `f6a80a18`, exit 0, com limpeza confirmada, registrado separadamente dos demais laboratórios. A jornada no navegador ocorreu das 15:50 às 16:01 UTC: Intake, geocode explícito em Projects, Calculator, revisão em USD (quantidade 2, custo 40, preço 100, margem 60%, política 42%), aprovação interna, JSON/PDF/printable entregues pelo servidor, CSV recusado por `CSV_TAXABLE_UNKNOWN`, revogação, JSON recusado por `INTERNAL_APPROVAL_REVOKED` e nova versão sem decisão. Os 13 checks posteriores passaram; o projeto ficou em `intake` sem operação e com uma auditoria para cada aprovação, revogação e versão. A espera do download JSON expirou; o salvamento local de JSON/PDF não foi verificado; o iframe printable foi observado. Hash anterior de UI e banco coincidiram, sem alegação de comparação integral antes/depois. Catálogo auxiliar, autenticação de desenvolvimento e geocode simulado local delimitam a prova. O supervisor saiu com exit 1 por `EPERM`; verificação independente confirmou a ausência de processos, grupos, portas e diretório PG. As duas correções P2 de interface estão GREEN: o rótulo do contexto de preços teve cinco falhas e 93 passes no RED; mensagens seguras de bloqueio tiveram 19 falhas e 12 passes. O GREEN combinado passou 160 testes em sete arquivos, exit 0, com revisão independente mútua e do coordenador. O checkpoint de fonte validada é `6b01c2a8efb3db2ea92dbdd9d4138bdadf162629`. O ajuste P3 final das mensagens teve RED de três falhas e 28 passes, seguido de 31 passes e build final com exit 0. O check de tipos sem erros antecedeu apenas as duas últimas mudanças de texto; o hook completo obrigatório passou depois em `a703ddb7`, sem bypass. A suíte geral anterior permanece atribuída a `f6a80a18`; o aviso datado registra publicação, CI do PR e integração à main. Ver o [relatório de fechamento](../docs/engineering/a1-delivery-closeout-2026-10-06.md).

A entrega deve registrar resultados no candidato final e observar sua publicação e integração separadamente. A trava de deploy por Git de `main` permanece configurada; prontidão para dados reais depende de evidência do ambiente, migrações, permissões e recuperação. Esta retomada não altera classificações do registro canônico nem declara conclusão comercial ou liberação de produção. Os registros de setembro abaixo preservam suas decisões e limites históricos; suas bases e instruções de próxima ação são superadas pelo estado ativo quando houver atualização explícita.

## Registro histórico atribuído — reconciliação de 18/19 de setembro de 2026

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
