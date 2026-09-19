# PB-00 — Revalidação do candidato de consolidação

**Data:** 19/09/2026 UTC. **Resultado atualizado:** consolidação dos PRs #14/#15 integrada em `main` no SHA `87f4239d7532eaae2d29be32a184ad36abbf78f1`; primeiro corte informativo de PB-02 implementado e validado localmente em `91a772194f47ee5407edcb0367b5b9831099b6e3`, publicado no [PR #16](https://github.com/wcvmsilva/structr-ai/pull/16). O estado de integração e os checks do head estão no PR. O histórico abaixo preserva os resultados de cada candidato. PB-02 inteiro, demais unidades e uso real continuam abertos.

Este registro é evidência do [roteiro de execução](PLAYBOOK-EXECUTION-ROADMAP.md), não um novo plano de sprint ou registro de capacidades. A autorização inicial foi aplicada à revalidação e publicação documental; depois o usuário autorizou concluir a consolidação e implementar as lacunas delimitadas. As demais frentes permanecem sob seus próprios planos.

## Base e método da auditoria inicial — histórico

- Repositório: `wcvmsilva/structr-ai`.
- Diagnóstico inicial: `233569d68c014712ce3d25326bda8823aab1987e`.
- `main` remoto observado na auditoria inicial: `8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf`.
- Candidato então inspecionado: [PR #14](https://github.com/wcvmsilva/structr-ai/pull/14), à época aberto como draft, SHA **`a7c17ed7b9deb48ea2aa097de1be4f9ac97b1ea9`**.
- Planejamento publicado: [PR #15](https://github.com/wcvmsilva/structr-ai/pull/15), à época aberto como draft. Seu histórico registra os commits da entrega documental.
- Método: leitura de arquivos versionados no SHA do candidato, busca nos consumidores da interface, revisão independente dos fluxos e dos gates e consulta aos checks do GitHub. Alterações locais ainda não publicadas não foram tratadas como entrega. Nenhum teste de runtime ou ensaio de produção foi executado nesta revalidação.

## Disposição dos achados em `a7c17ed7` — histórico

“Resolvido no candidato” descreve o código desse commit; não significa incorporado em `main` ou validado em produção.

| Achado inicial | Disposição no candidato | Evidência e próximo passo |
|---|---|---|
| Rota de revisão ausente | **Resolvido no candidato** | [`App.tsx:81`](https://github.com/wcvmsilva/structr-ai/blob/a7c17ed7b9deb48ea2aa097de1be4f9ac97b1ea9/client/src/App.tsx#L81) monta `/review`. Preservar na integração. |
| Criação de orçamento sem consumidor na interface | **Resolvido no candidato** | [`Review.tsx:278`](https://github.com/wcvmsilva/structr-ai/blob/a7c17ed7b9deb48ea2aa097de1be4f9ac97b1ea9/client/src/pages/Review.tsx#L278) chama `createFromScopeDraft`; o botão está na linha 423. Preservar e revalidar a jornada integrada. |
| Tela de custos ligada ao caminho legado | **Resolvido quanto à ligação original** | [`ProjectActuals.tsx:47`](https://github.com/wcvmsilva/structr-ai/blob/a7c17ed7b9deb48ea2aa097de1be4f9ac97b1ea9/client/src/pages/ProjectActuals.tsx#L47) usa `actuals.list` e `actuals.record`. Aprovação/pagamento não foram demonstrados no ensaio registrado. |
| Checklist de completude sem consumidor na interface | **Aberto** | [`scope-completeness-router.ts:149`](https://github.com/wcvmsilva/structr-ai/blob/a7c17ed7b9deb48ea2aa097de1be4f9ac97b1ea9/server/scope-completeness-router.ts#L149) oferece `getChecklist`; a busca em todos os arquivos versionados `.ts`/`.tsx` de `client/src` não encontrou `scopeCompleteness`, `getChecklist` ou `acknowledgePattern`. Delimitar integração e política da decisão em PB-02. |
| Auditoria tolerante a falhas | **Parcial** | [`audit.ts:57`](https://github.com/wcvmsilva/structr-ai/blob/a7c17ed7b9deb48ea2aa097de1be4f9ac97b1ea9/server/audit.ts#L57) propaga falhas quando recebe transação; geração de escopo, criação canônica de orçamento e registro de custos têm caminhos transacionais. O wrapper legado e eventos complementares continuam tolerantes a falhas. Inventariar somente as lacunas restantes em PB-03. |
| Origem estruturada da regra não persiste no item | **Aberto** | [`scope-router.ts:293`](https://github.com/wcvmsilva/structr-ai/blob/a7c17ed7b9deb48ea2aa097de1be4f9ac97b1ea9/server/scope-router.ts#L293) não transfere `ruleCode`; [`schema.ts:926`](https://github.com/wcvmsilva/structr-ai/blob/a7c17ed7b9deb48ea2aa097de1be4f9ac97b1ea9/drizzle/schema.ts#L926) não o armazena; [`remodel-router.ts:424`](https://github.com/wcvmsilva/structr-ai/blob/a7c17ed7b9deb48ea2aa097de1be4f9ac97b1ea9/server/remodel-router.ts#L424) reconstrói valor vazio. Especificar a persistência e versão em PB-03. |
| Manual descreve MySQL | **Resolvido no candidato** | [`AGENTS.md:9`](https://github.com/wcvmsilva/structr-ai/blob/a7c17ed7b9deb48ea2aa097de1be4f9ac97b1ea9/AGENTS.md#L9) já descreve PostgreSQL. Não refazer a correção. Links externos e instruções restantes continuam sujeitos à revisão documental de PB-01. |

O processo comercial, os modelos e bloqueios existentes são a base a reutilizar. Esta comparação não certificou toda a documentação comercial nem alterou classificações do registro canônico.

## Verificação disponível em `a7c17ed7` e limites — histórico

- **Observado diretamente no GitHub:** o check “Type check and tests” concluiu com sucesso na [execução 35415248373](https://github.com/wcvmsilva/structr-ai/actions/runs/35415248373/job/105822507470), associada ao head `a7c17ed7`; o checkout foi o merge sintético `fe0a7de`, conforme o comportamento padrão de CI da PR. O sucesso do check de comentários da Vercel não demonstra funcionamento da aplicação hospedada.
- **Registrado no candidato, sem repetição nesta rodada:** [readiness, linhas 46–66](https://github.com/wcvmsilva/structr-ai/blob/a7c17ed7b9deb48ea2aa097de1be4f9ac97b1ea9/docs/engineering/readiness-remediation-2026-09-19.md#L46) documenta TypeScript e build aprovados, 3.633 testes aprovados/343 pulados e 264 testes físicos opcionais aprovados. Os 264 pertencem ao conjunto normalmente pulado; não são testes adicionais novos.
- **Ensaio registrado:** Intake → Scope → Review → Estimate → Actuals com banco isolado, administrador e dados sintéticos. Lead, autenticação/RLS de produção, aprovação/pagamento de custos e armazenamento/recuperação externa de documentos ficaram fora desse ensaio. Houve limitações de apresentação de unidade e painel geográfico. A restauração demonstrada foi sintética e local.

## Ordem registrada antes da integração — histórico

1. **Concluir a consolidação em andamento:** preservar trabalho não publicado, identificar o candidato final, conferir revisões e checks nesse SHA e registrar a decisão de integração aplicável. Corrigir hospedagem ou reconstruir esquema em outra tarefa só passa a ser evidência desta fila após publicação e verificação identificadas.
2. **Conciliar a documentação compartilhada:** os PRs #14 e #15 alteram o mesmo roteiro e `todo.md`. Preservar ambos os conjuntos de pendências, mantendo uma única versão vigente do roteiro. O banner de [`current-state.md`](https://github.com/wcvmsilva/structr-ai/blob/a7c17ed7b9deb48ea2aa097de1be4f9ac97b1ea9/docs/engineering/current-state.md#L3) já supera as afirmações antigas sobre publicação/inspeção e PDF/JSON; não usar esses trechos históricos para reabrir correções entregues. F5b tem implementação herdada, sem fechamento formal localizado; não tratá-lo como não implementado.
3. **Revalidar a base integrada e ativar PB-01:** registrar SHA, verificações e limites; vincular processos às fontes canônicas. O plano de sprint deve refletir a prioridade acordada, sem reativar automaticamente horas/folha ou decisões comerciais pendentes.
4. **Especificar PB-02/PB-03 a partir das lacunas:** checklist ligado à revisão; caminhos críticos de auditoria ainda legados; origem/versão das regras persistidas. Critérios de aprovação e dados obrigatórios precisam ser explícitos antes de implementar. Não reconstruir as três ligações de interface já corrigidas.
5. **Executar PB-04 no escopo adequado:** comprovar os três playbooks, seus bloqueios e evidências duráveis. Para uso real, continuam aplicáveis os [gates de migração, ownership, acesso, recuperação e operação implantada](https://github.com/wcvmsilva/structr-ai/blob/a7c17ed7b9deb48ea2aa097de1be4f9ac97b1ea9/docs/engineering/readiness-remediation-2026-09-19.md#L36), até evidência posterior que os resolva.

## Candidato posterior de banco e hospedagem

Este bloco preserva a situação de `57f63042`, anterior à integração e às verificações finais registradas na atualização ao fim do documento.

A comparação acima permanece vinculada a `a7c17ed7`. O PR #14 foi publicado posteriormente em **`57f63042924d71d60304ebaa04a47a0fe6b2e170`**. Seu [registro de verificação](https://github.com/wcvmsilva/structr-ai/blob/57f63042924d71d60304ebaa04a47a0fe6b2e170/docs/engineering/readiness-remediation-2026-09-19.md) documenta 3.768 testes locais aprovados e 367 pulados, mais 288 testes físicos opcionais aprovados que se sobrepõem aos pulados; 79 casos pulados não foram exercitados. São resultados registrados daquele candidato, não nova execução desta revisão.

A atualização corrige a apresentação das unidades, remove dependências administrativas nos caminhos delimitados de Lead/pipeline e adiciona auditoria transacional às atividades. A reconstrução estrutural parcial confere 2.337 objetos incluídos e identifica 288 diferenças perante a cadeia local. O pacote de catálogo prepara decisões, sem classificar ownership ou resolver conflitos comerciais. Essas entregas não comprovam recuperação integral nem autorizam migração de produção.

O novo [contrato de hospedagem](https://github.com/wcvmsilva/structr-ai/blob/57f63042924d71d60304ebaa04a47a0fe6b2e170/docs/engineering/hosted-entrypoint-2026-09-19.md) inclui API desabilitada por padrão. A configuração efetiva do provedor ainda deve ser verificada: o frontend Auth independe dessa trava. As falhas remotas de testes/empacotamento desse candidato estão sob correção na tarefa responsável. Registrar CI e preview no SHA final, incluindo consequência de auto-deploy ao integrar em `main`; testes locais e API 503 isoladamente não comprovam contenção completa.

O usuário autorizou concluir essa consolidação e depois implementar as lacunas. A conciliação preserva as pendências gerais do PR #14 e a fila do PR #15. Checklist, auditoria legada, origem/versão das regras e aprovação/pagamento de custos não foram encerrados por essas correções. Os gates de uso real permanecem separados da integração de um candidato comprovadamente contido.

**Situação naquela etapa:** revalidação do candidato e ajuste da fila concluídos; integração dos PRs e execução das unidades seguintes ainda pendentes. A atualização abaixo registra o que mudou depois. Publicação documental, integração de código e liberação de produção continuam sendo estados distintos.

<a id="atualizacao-apos-consolidacao-e-primeiro-corte-pb-02"></a>

## Atualização após consolidação e primeiro corte PB-02

### Consolidação integrada

O PR #14 foi integrado em `main` no SHA **`87f4239d7532eaae2d29be32a184ad36abbf78f1`**, incorporando o histórico conciliado do PR #15. A [execução de CI 35466474288](https://github.com/wcvmsilva/structr-ai/actions/runs/35466474288) concluiu com sucesso. O preview `7M9LKPSBPH93TyGfqs3EMEuwkwQK` foi verificado contido e com a tela de login renderizada. A produção permaneceu em `8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf`.

A revalidação dos contratos necessários ao primeiro corte PB-02 foi feita nessa base integrada. As ligações de revisão, criação de orçamento e `actuals`, assim como a correção do manual para PostgreSQL, são trabalho integrado a preservar. O consumidor de `getChecklist` ainda não existia nessa base; sua entrega posterior está delimitada abaixo. O sucesso do CI e o preview contido não encerram os gates de dados reais, migração, ownership, acesso, recuperação ou operação.

### Primeiro corte PB-02 — implementado e publicado para integração

- Branch: `codex/pb02-scope-checklist-20260919`; código testado: **`91a772194f47ee5407edcb0367b5b9831099b6e3`**.
- Entrega: painel histórico de omissões na revisão, com projeto autorizado e tipo persistido, leitura tenant-scoped pelo endpoint existente, estados de indisponibilidade distintos de histórico vazio e preservação das regras atuais de aprovação/orçamento. O painel é informativo; não oferece ciência nem impõe checklist obrigatório.
- Verificação registrada: **54 testes novos** (36 backend e 18 UI); suíte completa com **3.848 aprovados, 367 pulados e zero falhas**; typecheck e build aprovados. Os testes pulados permanecem discriminados como não executados nessa suíte, sem serem promovidos a evidência de aprovação.
- Navegador: componente e cliente tRPC reais com transporte sintético, cobrindo nova tentativa, cache acompanhado de erro e resposta tardia de projeto. Essa evidência comprova as interações delimitadas; não executa PostgreSQL/RLS, não exercita a API hospedada nem equivale aos três playbooks operacionais completos.
- Backend: consultas verificadas com predicados Drizzle e driver sintético de filtros/ordem/limite; não é evidência de políticas físicas de banco ou RLS.
- Evidência vinculada à versão: [relatório do corte](../engineering/pb02-scope-checklist-2026-09-19.md) e [manifesto de verificação](../engineering/pb02-scope-checklist-verification-2026-09-19.json). O código PB-02 foi publicado no [PR #16](https://github.com/wcvmsilva/structr-ai/pull/16); os resultados desta seção são locais e não substituem os checks remotos associados ao head.

### Disposição atual e próximos limites

| Item | Estado após esta atualização |
|---|---|
| Integração dos PRs #14/#15 | Concluída em `main` no SHA `87f4239d`. |
| Ausência de consumidor informativo do checklist | Resolvida na fonte testada `91a77219`, publicada no [PR #16](https://github.com/wcvmsilva/structr-ai/pull/16), com validação delimitada. |
| PB-02 completo | Aberto; aprovação/pagamento de custos, checklist obrigatório, respostas por orçamento e exceções não foram entregues por este corte. |
| PB-01/PB-03/PB-04 e conclusão da rodada | Permanecem pendentes nos respectivos escopos; auditoria legada e origem/versão das regras não foram encerradas pelo painel. |
| C-20/P-09 e demais gates de uso real | Preservados, com C-20 pausado; esta entrega não registra fechamento comercial ou liberação de dados reais. F5b não deve ser reclassificado como não implementado. |
| Horas/apontamentos | Continuam pausados; nenhum fluxo operacional foi implementado por este corte. |
| Decisões comerciais R3/R4 | Permanecem fora deste corte, dependentes de desenho separado. |
| Produção | Mantida em `8fa14da3`; sem publicação de PB-02 em produção ou liberação de operação real por esta entrega. |
