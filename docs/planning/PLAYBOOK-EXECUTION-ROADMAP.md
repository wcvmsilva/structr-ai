# Próxima rodada — Playbooks operacionais do Structr

**Registro:** 2026-09-18

**Status em 2026-09-19 UTC:** consolidação dos PRs #14/#15 integrada em `main` no SHA `87f4239d7532eaae2d29be32a184ad36abbf78f1`. Primeiro corte informativo de PB-02 implementado e validado localmente em `91a772194f47ee5407edcb0367b5b9831099b6e3`, publicado no [PR #16](https://github.com/wcvmsilva/structr-ai/pull/16). O estado de integração e os checks remotos estão no PR. PB-02 inteiro, demais unidades e liberação de uso real permanecem abertos.

**Origem:** solicitação de Wellington após a revisão da metodologia de processo escrito, recursos reutilizáveis e verificação.

**Objetivo:** fazer os processos documentados chegarem às telas usadas pela equipe, com resultados e aprovações verificáveis.

Este registro organiza a sequência autorizada de consolidação e lacunas delimitadas. Não substitui o plano em andamento nem declara o sistema pronto para produção. A base consolidada foi revalidada para o primeiro corte de PB-02; as próximas entregas continuam exigindo escopo e evidência próprios. A integração de código não encerra os gates de uso real, C-20/P-09, horas/apontamentos pausados ou as decisões comerciais R3/R4, que dependem de desenho separado.

## 1. Condição de entrada — consolidação entregue antes do primeiro corte

- [x] Publicar o planejamento em branch/PR: [PR #15](https://github.com/wcvmsilva/structr-ai/pull/15).
- [x] Comparar os achados históricos com o código versionado do PR #14 no SHA `a7c17ed7b9deb48ea2aa097de1be4f9ac97b1ea9`; registrar [correções, lacunas e limites da evidência](PLAYBOOK-REVALIDATION-2026-09-19.md).
- [x] Inventariar branches, PRs, worktrees e alterações locais no [registro de reconciliação de 18/09](../engineering/progress-reconciliation-2026-09-18.md), preservando trabalho não publicado.
- [x] Integrar a candidata reconciliada dos PRs #14/#15 em `wcvmsilva/structr-ai`, `main`, SHA `87f4239d7532eaae2d29be32a184ad36abbf78f1`; essa integração não reúne automaticamente outras branches ou worktrees.
- [x] Derivar `codex/pb02-scope-checklist-20260919` dessa base e revalidar os contratos usados pelo primeiro corte. Preservar as correções anteriores e implementar somente o consumidor informativo delimitado.
- [x] Registrar CI e preview da consolidação, verificações locais do corte e seus limites no [registro atualizado](PLAYBOOK-REVALIDATION-2026-09-19.md#atualizacao-apos-consolidacao-e-primeiro-corte-pb-02) e no [relatório PB-02](../engineering/pb02-scope-checklist-2026-09-19.md).

**Pendências preservadas:** os fechamentos formais de segurança, acesso, estabilidade e uso real continuam nas fontes vigentes. F5b não volta a ser tratado como não implementado; C-20 permanece pausado e C-20/P-09 não é encerrado por esta entrega. Horas/apontamentos permanecem pausados. Os demais achados da seção 3 serão revalidados no escopo de cada próxima unidade, sem presumir que toda a fila esteja resolvida.

**Saída registrada:** base integrada identificada, histórico preservado e contratos do primeiro corte revalidados. Estar sincronizado com o GitHub, por si só, não comprova funcionamento completo do produto ou liberação de produção.

## 2. Reutilizar as fontes existentes

Foram encontrados estes documentos em referências locais de outras branches:

- `docs/planning/AGENT-CAPABILITY-ROADMAP.md`, em `origin/main` local no SHA `5c29fd07535695566adc6bcb556b529ac94987ca`.
- `docs/product/canonical-structr-truth-v1.md` e `docs/product/feature-evidence-maintenance.md`, na branch `docs/canonical-structr-truth-v1`.
- Documentação de estado, arquitetura e segurança na linhagem `workflow/controlled-engineering-workflow` e suas continuações.
- Correção do manual para PostgreSQL na referência local `origin/fix/docs-postgres-standardization`; verificar se foi incorporada antes de refazer a alteração.

Essas observações são históricas e não substituem a base integrada registrada acima. Nas próximas unidades, localizar as versões vigentes, respeitar seus estados de aprovação e vincular os playbooks a elas. Atualizar e adotar a documentação já existente; não criar uma segunda fonte de verdade.

`plans/current-sprint.md` tem conteúdo de trabalho em outra worktree. Este registro não o substitui. Quando a rodada for ativada, o plano vigente poderá apontar para este documento.

### Histórico da verificação remota para publicação deste planejamento

Na consulta ao GitHub para preparar esta publicação, a branch `main` estava em `8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf`, já incluindo os documentos canônicos e de manutenção de evidências citados acima. Esta é a base escolhida para o PR documental; não muda o SHA histórico da análise na seção 3.

O [PR #14 — Reconcile agent work and repair estimate-to-actuals readiness](https://github.com/wcvmsilva/structr-ai/pull/14) estava aberto como draft, com head `a7c17ed7b9deb48ea2aa097de1be4f9ac97b1ea9`. A revalidação de 19/09 conferiu o código desse commit: a rota de revisão, a criação de orçamento pela interface e a ligação da tela de custos ao módulo `actuals` já foram corrigidas no candidato. O manual também já descreve PostgreSQL. Não reimplementar esses achados antigos. O [registro de revalidação](PLAYBOOK-REVALIDATION-2026-09-19.md) delimita o que continua aberto e distingue código, testes registrados, CI e operação.

Naquela etapa, a versão conciliou os registros dos PRs #14 e #15, preservando as pendências gerais e incorporando a revalidação dos playbooks. A conciliação documental, por si só, não equivalia a merge em `main`; a integração posterior está registrada abaixo.

O candidato posterior `57f63042924d71d60304ebaa04a47a0fe6b2e170` adicionou correções e evidências de banco, unidades e hospedagem. O [registro posterior](PLAYBOOK-REVALIDATION-2026-09-19.md#candidato-posterior-de-banco-e-hospedagem) preserva os resultados e limites daquela versão, antes dos ajustes finais de CI e empacotamento.

### Atualização após integração

- **Consolidação:** PR #14 integrado em `main` no SHA `87f4239d7532eaae2d29be32a184ad36abbf78f1`, incorporando o PR #15. A [execução de CI 35466474288](https://github.com/wcvmsilva/structr-ai/actions/runs/35466474288) passou. O preview `7M9LKPSBPH93TyGfqs3EMEuwkwQK` foi verificado contido, com a tela de login renderizada. A produção permanece em `8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf`; a integração não liberou dados reais.
- **Primeiro corte PB-02:** painel histórico informativo implementado na branch `codex/pb02-scope-checklist-20260919`, código em `91a772194f47ee5407edcb0367b5b9831099b6e3`. São 54 testes novos (36 backend e 18 UI); suíte completa com 3.848 aprovados, 367 pulados e zero falhas, além de typecheck e build aprovados. A validação no navegador usou o componente e cliente tRPC reais com transporte sintético para Retry, cache/erro e resposta tardia de projeto. Não comprova PostgreSQL/RLS, API hospedada ou operação real.
- **Publicação:** o corte PB-02 está no [PR #16](https://github.com/wcvmsilva/structr-ai/pull/16); consultar nele os checks do head e o estado de integração. O [relatório do corte](../engineering/pb02-scope-checklist-2026-09-19.md) e seu [manifesto de verificação](../engineering/pb02-scope-checklist-verification-2026-09-19.json) vinculam resultados e limites à versão testada.

## 3. Sequência recomendada

| Ordem | Unidade | Entrega e critério de aceite |
|---|---|---|
| PB-00 | Consolidação e revalidação | Consolidação entregue em `87f4239d` e contratos do primeiro corte revalidados. Preservar as pendências gerais e classificar as lacunas restantes em cada próxima unidade; não reabrir correções integradas. |
| PB-01 | Processo oficial e documentação | Reconciliar instruções desatualizadas com as fontes vigentes. Cada processo deve ter responsável, versão, entradas mínimas, passos, ferramentas, saída, exceções, aprovação, exemplo e checklist. Links devem ser utilizáveis na base consolidada. |
| PB-02 | Jornada pelas telas | Primeiro corte informativo do checklist implementado e validado localmente em `91a77219`, publicado no [PR #16](https://github.com/wcvmsilva/structr-ai/pull/16). Preservar as ligações integradas; aprovação de custos, checklist obrigatório, respostas por orçamento e exceções continuam fora deste corte e exigem escopo próprio. PB-02 inteiro permanece aberto. |
| PB-03 | Evidência durável | Delimitar os caminhos legados de auditoria ainda tolerantes a falhas e a persistência da origem/versão das regras. Preservar a auditoria transacional já corrigida; testar falhas de gravação nos caminhos alterados. Detalhar entradas, versões, validações, responsável, decisão e artefato final conforme a arquitetura aprovada. |
| PB-04 | Validação operacional | Executar os três casos da seção 4 pelo navegador, com banco isolado e dados representativos. Demonstrar sucesso e recusa de entradas inválidas; registrar evidência vinculada ao SHA testado. |

PB-01 pode ser preparada enquanto os próximos cortes de PB-02 são detalhados. Alterações nos mesmos arquivos e decisões de arquitetura dependentes devem permanecer coordenadas. Datas, responsáveis individuais e duração das próximas unidades serão definidos conforme a capacidade disponível.

### Achados históricos da revisão inicial

Base observada: `main` local, SHA `233569d68c014712ce3d25326bda8823aab1987e`. Não houve inspeção do ambiente publicado. A tabela preserva o diagnóstico daquela base; a disposição atual no candidato está no [registro de 19/09](PLAYBOOK-REVALIDATION-2026-09-19.md). Estes itens não são uma lista atual de defeitos a implementar.

| Achado nessa base | Referência para revalidação |
|---|---|
| Processo comercial documentado, modelos reutilizados e bloqueios reais de aprovação/exportação já existem. | `docs/phase2-contract.md`, `server/remodel-router.ts`, `server/estimate-db.ts`, `server/jobtread-export-db.ts`. |
| `ReviewPage` é importada e o menu aponta para `/review`, mas essa rota não está registrada; não foi encontrado consumidor de `estimate.createFromScopeDraft` na interface. | `client/src/App.tsx`, `client/src/components/DashboardLayout.tsx`, `client/src/pages/Review.tsx`, `server/estimate-router.ts`. |
| A tela de custos usa `fieldLaunch`; o módulo novo `actuals` também está registrado no servidor. | `client/src/pages/ProjectActuals.tsx`, `server/field-launch-router.ts`, `server/actuals-router.ts`, `server/routers.ts`. |
| O checklist de completude existe no servidor, mas não foi encontrado ligado à interface e à aprovação. | `server/scope-completeness-router.ts`, `client/src`, `server/scope-to-estimate-pipeline.ts`. |
| O manual ainda descreve MySQL, enquanto o código usa PostgreSQL; contratos têm referências a caminhos externos à máquina atual. | `AGENTS.md`, `server/db.ts`, `docs/phase2-contract.md`. |
| Existem caminhos de auditoria que toleram falha na gravação. A origem estruturada das regras também deve ser verificada na persistência dos itens de escopo. | `server/audit.ts`, `server/audit-trail.ts`, `server/scope-router.ts`, `server/remodel-router.ts`. |

Evidência histórica desta revisão: `pnpm check` passou. A suíte local, sem conexão ao banco, teve 2.277 testes aprovados, 79 pulados e 2 timeouts; a repetição isolada dos dois arquivos afetados passou com 193 testes. Isso não equivale a uma execução integral sem falhas nem validação operacional. Obter evidência nova após consolidar.

## 4. Três playbooks para a primeira rodada

1. **Escopo até orçamento:** registrar entradas, gerar escopo, revisar, resolver pendências, aprovar e gerar o orçamento com a referência correta. Demonstrar bloqueio sem a aprovação exigida e para violação de margem.
2. **Custo real até aprovação:** registrar custo por projeto e classificação, preservar recibo/favorecido quando exigidos, revisar exceções e aprovar conforme as permissões. Comprovar que tela, orçamento de referência e registro oficial de custos estão conectados.
3. **Orçamento aprovado até exportação:** validar autorização e versão, conferir formato e conciliar total, registrar a tentativa e liberar o arquivo somente quando os critérios forem atendidos. Demonstrar recusa de versão superada e de total divergente.

Os três devem reutilizar motores, modelos e contratos existentes. As políticas operacionais específicas da GCHI discutidas nesta conversa são insumos para a especificação; não presumir que todas já estejam implementadas ou configuradas.

## 5. Conclusão da rodada

- [ ] Cada tarefa possui escopo e arquivos definidos, critérios de aceite, verificações e procedimento de reversão aplicável.
- [ ] Alterações de comportamento seguem TDD e as regras de testes vigentes no repositório consolidado.
- [ ] TypeScript, testes e demais verificações exigidas passaram na versão entregue; falhas e testes pulados estão discriminados.
- [ ] Os três casos foram percorridos pelas telas com banco isolado, incluindo exceções e recusas; testes de mera existência não servem como prova de funcionamento.
- [ ] Evidências críticas sobreviveram à execução e estão vinculadas ao processo, ao projeto e à decisão correspondentes, conforme o domínio.
- [ ] O registro de capacidades distingue documentado, implementado, testado e validado na operação, respeitando o vocabulário canônico vigente.
- [ ] Documentação, plano de execução e PR refletem o resultado final, com revisão e aceite exigidos pelo fluxo vigente.

## 6. Limites desta inclusão na fila

- A continuação autorizada segue a ordem consolidação → implementação das lacunas delimitadas. Cada entrega deve identificar sua base, escopo e verificações; a documentação, por si só, não atesta alteração de runtime, banco, permissões ou liberação de operação real.
- Não adicionar agentes, dependências ou uma nova arquitetura para cumprir esta rodada.
- Não tratar exportação CSV como integração automática com JobTread ou QuickBooks. Integrações externas exigem escopo próprio e validação específica.
- Não substituir o trabalho de segurança e estabilização em andamento por este planejamento.
