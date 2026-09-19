# Próxima rodada — Playbooks operacionais do Structr

**Registro:** 2026-09-18
**Status:** reservado na fila; execução condicionada à consolidação com o GitHub.
**Origem:** solicitação de Wellington após a revisão da metodologia de processo escrito, recursos reutilizáveis e verificação.
**Objetivo:** fazer os processos documentados chegarem às telas usadas pela equipe, com resultados e aprovações verificáveis.

Este registro organiza trabalho futuro. Não ativa uma sprint, substitui o plano em andamento ou declara o sistema pronto para produção. A rodada será detalhada em tarefas limitadas depois de revalidar a base consolidada. Este roteiro compõe a candidata de reconciliação descrita no [registro atual](../engineering/progress-reconciliation-2026-09-18.md); a incorporação na main e o início da rodada permanecem pendentes.

## 1. Condição de entrada — consolidar antes de implementar

- [x] Atualizar a visão do GitHub e inventariar branches, PRs, worktrees e alterações locais, preservando trabalho não publicado (registro de reconciliação de 18/09).
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

## 3. Sequência recomendada

| Ordem | Unidade | Entrega e critério de aceite |
|---|---|---|
| PB-00 | Consolidação e revalidação | Cumprir a seção 1; classificar cada achado como ainda aberto, resolvido com evidência ou fora desta rodada. |
| PB-01 | Processo oficial e documentação | Reconciliar instruções desatualizadas com as fontes vigentes. Cada processo deve ter responsável, versão, entradas mínimas, passos, ferramentas, saída, exceções, aprovação, exemplo e checklist. Links devem ser utilizáveis na base consolidada. |
| PB-02 | Jornada pelas telas | Fechar escopo → revisão → orçamento e conectar a operação de custos ao caminho oficial definido na arquitetura vigente. Verificar a rota de revisão, a criação de orçamento a partir do escopo e a ligação do checklist à decisão. Usar e corrigir os endpoints existentes conforme a especificação; não criar um fluxo paralelo. |
| PB-03 | Evidência durável | Verificar quais operações críticas podem concluir sem evidência persistida. Detalhar a correção conforme a arquitetura aprovada e testar falhas de gravação. Preservar entradas, versões de regras, resultado das validações, responsável, decisão e artefato final quando aplicável. |
| PB-04 | Validação operacional | Executar os três casos da seção 4 pelo navegador, com banco isolado e dados representativos. Demonstrar sucesso e recusa de entradas inválidas; registrar evidência vinculada ao SHA testado. |

PB-01 pode ser preparada enquanto PB-02 é detalhada, depois de PB-00. Alterações nos mesmos arquivos e decisões de arquitetura dependentes devem permanecer coordenadas. Datas, responsáveis individuais e duração serão definidos ao ativar a rodada, conforme a capacidade disponível.

### Achados da revisão que precisam ser revalidados

Base observada: `main` local, SHA `233569d68c014712ce3d25326bda8823aab1987e`. Não houve inspeção do ambiente publicado.

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

- Este roteiro futuro não inicia mudanças de runtime, banco ou permissões. A publicação da candidata de reconciliação pertence à solicitação separada do usuário de 18/09 e não ativa PB-01–PB-04.
- Não adicionar agentes, dependências ou uma nova arquitetura para cumprir esta rodada.
- Não tratar exportação CSV como integração automática com JobTread ou QuickBooks. Integrações externas exigem escopo próprio e validação específica.
- Não substituir o trabalho de segurança e estabilização em andamento por este planejamento.
