# Próxima rodada — Playbooks operacionais do Structr

**Registro:** 2026-09-18

**Status em 2026-09-19 UTC:** PB-00 em andamento; revalidação dos achados desta fila no código do PR #14 concluída. Integração à base principal e ativação da rodada continuam pendentes.

**Origem:** solicitação de Wellington após a revisão da metodologia de processo escrito, recursos reutilizáveis e verificação.

**Objetivo:** fazer os processos documentados chegarem às telas usadas pela equipe, com resultados e aprovações verificáveis.

Este registro organiza trabalho futuro. Não ativa uma sprint, substitui o plano em andamento ou declara o sistema pronto para produção. A rodada será detalhada em tarefas limitadas depois de revalidar a base consolidada. A publicação documental no GitHub foi autorizada; a incorporação à base principal ainda está pendente.

## 1. Condição de entrada — consolidar antes de implementar

- [x] Publicar o planejamento em branch/PR: [PR #15](https://github.com/wcvmsilva/structr-ai/pull/15).
- [x] Comparar os achados históricos com o código versionado do PR #14 no SHA `a7c17ed7b9deb48ea2aa097de1be4f9ac97b1ea9`; registrar [correções, lacunas e limites da evidência](PLAYBOOK-REVALIDATION-2026-09-19.md).
- [ ] Atualizar a visão do GitHub e inventariar branches, PRs, worktrees e alterações locais, preservando trabalho não publicado.
- [ ] Identificar quais mudanças estão aprovadas para integração; reconciliar somente essas mudanças, sem reunir automaticamente todas as branches.
- [ ] Registrar repositório, branch, SHA resultante e destino do trabalho que permanecer separado. Confirmar que a branch de execução deriva da base escolhida e atualizada.
- [ ] Reconciliar o plano ativo e as pendências de segurança, acesso e estabilidade. Preservar a prioridade do trabalho em andamento e revalidar os registros F5b, C-20/P-09 e demais unidades, sem presumir que continuem abertos ou que tenham sido encerrados.
- [ ] Revalidar cada achado da seção 3 nessa base. Encerrar com evidência os itens já resolvidos e implementar apenas as lacunas restantes.
- [ ] Executar as verificações exigidas pelas regras vigentes e registrar resultados, falhas e testes pulados. Falha preexistente deve ter tratamento explícito; não pode ser apresentada como aprovação.

**Saída desta etapa:** base identificada, trabalho preservado, prioridades reconciliadas e lista atual de lacunas. Estar sincronizado com o GitHub, por si só, não comprova funcionamento do produto.

## 2. Reutilizar as fontes existentes

Foram encontrados estes documentos em referências locais de outras branches:

- `docs/planning/AGENT-CAPABILITY-ROADMAP.md`, em `origin/main` local no SHA `5c29fd07535695566adc6bcb556b529ac94987ca`.
- `docs/product/canonical-structr-truth-v1.md` e `docs/product/feature-evidence-maintenance.md`, na branch `docs/canonical-structr-truth-v1`.
- Documentação de estado, arquitetura e segurança na linhagem `workflow/controlled-engineering-workflow` e suas continuações.
- Correção do manual para PostgreSQL na referência local `origin/fix/docs-postgres-standardization`; verificar se foi incorporada antes de refazer a alteração.

Essas observações não são uma consulta atual ao GitHub nem uma aprovação de merge. Após a consolidação, localizar as versões vigentes, respeitar seus estados de aprovação e vincular os playbooks a elas. Atualizar e adotar a documentação já existente; não criar uma segunda fonte de verdade.

`plans/current-sprint.md` tem conteúdo de trabalho em outra worktree. Este registro não o substitui. Quando a rodada for ativada, o plano vigente poderá apontar para este documento.

### Verificação remota para publicação deste planejamento

Na consulta ao GitHub para preparar esta publicação, a branch `main` estava em `8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf`, já incluindo os documentos canônicos e de manutenção de evidências citados acima. Esta é a base escolhida para o PR documental; não muda o SHA histórico da análise na seção 3.

O [PR #14 — Reconcile agent work and repair estimate-to-actuals readiness](https://github.com/wcvmsilva/structr-ai/pull/14) estava aberto como draft, com head `a7c17ed7b9deb48ea2aa097de1be4f9ac97b1ea9`. A revalidação de 19/09 conferiu o código desse commit: a rota de revisão, a criação de orçamento pela interface e a ligação da tela de custos ao módulo `actuals` já foram corrigidas no candidato. O manual também já descreve PostgreSQL. Não reimplementar esses achados antigos. O [registro de revalidação](PLAYBOOK-REVALIDATION-2026-09-19.md) delimita o que continua aberto e distingue código, testes registrados, CI e operação.

Os PRs #14 e #15 alteram este roteiro e `todo.md`. Na integração, reconciliar os dois registros: preservar as pendências gerais do PR #14 e incorporar a revalidação do PR #15, sem escolher uma versão inteira e perder o trabalho da outra. Esta comparação não incorpora o PR #14 em `main`. Revalidar os itens afetados se o candidato mudar.

## 3. Sequência recomendada

| Ordem | Unidade | Entrega e critério de aceite |
|---|---|---|
| PB-00 | Consolidação e revalidação | Cumprir a seção 1; classificar cada achado como ainda aberto, resolvido com evidência ou fora desta rodada. |
| PB-01 | Processo oficial e documentação | Reconciliar instruções desatualizadas com as fontes vigentes. Cada processo deve ter responsável, versão, entradas mínimas, passos, ferramentas, saída, exceções, aprovação, exemplo e checklist. Links devem ser utilizáveis na base consolidada. |
| PB-02 | Jornada pelas telas | Preservar e revalidar as ligações já corrigidas no candidato. Detalhar a conexão do checklist à decisão de revisão e as etapas ainda não demonstradas de aprovação de custos. Usar os endpoints existentes conforme a especificação; não criar um fluxo paralelo. |
| PB-03 | Evidência durável | Delimitar os caminhos legados de auditoria ainda tolerantes a falhas e a persistência da origem/versão das regras. Preservar a auditoria transacional já corrigida; testar falhas de gravação nos caminhos alterados. Detalhar entradas, versões, validações, responsável, decisão e artefato final conforme a arquitetura aprovada. |
| PB-04 | Validação operacional | Executar os três casos da seção 4 pelo navegador, com banco isolado e dados representativos. Demonstrar sucesso e recusa de entradas inválidas; registrar evidência vinculada ao SHA testado. |

PB-01 pode ser preparada enquanto PB-02 é detalhada, depois de PB-00. Alterações nos mesmos arquivos e decisões de arquitetura dependentes devem permanecer coordenadas. Datas, responsáveis individuais e duração serão definidos ao ativar a rodada, conforme a capacidade disponível.

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

- Esta entrega cobre a publicação documental da fila e sua revalidação em branch/PR. A implementação das unidades seguintes depende da base consolidada e de sua especificação; este documento não atesta alteração de runtime, banco, permissões ou publicação do produto.
- Não adicionar agentes, dependências ou uma nova arquitetura para cumprir esta rodada.
- Não tratar exportação CSV como integração automática com JobTread ou QuickBooks. Integrações externas exigem escopo próprio e validação específica.
- Não substituir o trabalho de segurança e estabilização em andamento por este planejamento.
