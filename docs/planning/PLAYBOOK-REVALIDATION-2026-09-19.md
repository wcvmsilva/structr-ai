# PB-00 — Revalidação do candidato de consolidação

**Data:** 19/09/2026 UTC. **Resultado:** comparação dos achados desta fila com o código publicado concluída; PB-00 permanece em andamento até a integração e revalidação da base escolhida.

Este registro é evidência do [roteiro de execução](PLAYBOOK-EXECUTION-ROADMAP.md), não um novo plano de sprint ou registro de capacidades. A autorização para seguir com a próxima pendência foi aplicada à revalidação e publicação documental. A implementação em andamento nas outras frentes permanece sob seus próprios planos.

## Base e método

- Repositório: `wcvmsilva/structr-ai`.
- Diagnóstico inicial: `233569d68c014712ce3d25326bda8823aab1987e`.
- `main` remoto observado nesta rodada: `8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf`.
- Candidato inspecionado: [PR #14](https://github.com/wcvmsilva/structr-ai/pull/14), aberto como draft, SHA **`a7c17ed7b9deb48ea2aa097de1be4f9ac97b1ea9`**.
- Planejamento publicado: [PR #15](https://github.com/wcvmsilva/structr-ai/pull/15), aberto como draft. Seu histórico registra os commits desta entrega documental.
- Método: leitura de arquivos versionados no SHA do candidato, busca nos consumidores da interface, revisão independente dos fluxos e dos gates e consulta aos checks do GitHub. Alterações locais ainda não publicadas não foram tratadas como entrega. Nenhum teste de runtime ou ensaio de produção foi executado nesta revalidação.

## Disposição dos achados

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

## Verificação disponível e limites

- **Observado diretamente no GitHub:** o check “Type check and tests” concluiu com sucesso no SHA inspecionado, [execução 35415248373](https://github.com/wcvmsilva/structr-ai/actions/runs/35415248373/job/105822507470). O sucesso do check de comentários da Vercel não demonstra funcionamento da aplicação hospedada.
- **Registrado no candidato, sem repetição nesta rodada:** [readiness, linhas 46–66](https://github.com/wcvmsilva/structr-ai/blob/a7c17ed7b9deb48ea2aa097de1be4f9ac97b1ea9/docs/engineering/readiness-remediation-2026-09-19.md#L46) documenta TypeScript e build aprovados, 3.633 testes aprovados/343 pulados e 264 testes físicos opcionais aprovados. Os 264 pertencem ao conjunto normalmente pulado; não são testes adicionais novos.
- **Ensaio registrado:** Intake → Scope → Review → Estimate → Actuals com banco isolado, administrador e dados sintéticos. Lead, autenticação/RLS de produção, aprovação/pagamento de custos e armazenamento/recuperação externa de documentos ficaram fora desse ensaio. Houve limitações de apresentação de unidade e painel geográfico. A restauração demonstrada foi sintética e local.

## Ordem restante e critérios de saída

1. **Concluir a consolidação em andamento:** preservar trabalho não publicado, identificar o candidato final, conferir revisões e checks nesse SHA e registrar a decisão de integração aplicável. Corrigir hospedagem ou reconstruir esquema em outra tarefa só passa a ser evidência desta fila após publicação e verificação identificadas.
2. **Conciliar a documentação compartilhada:** os PRs #14 e #15 alteram o mesmo roteiro e `todo.md`. Preservar ambos os conjuntos de pendências, mantendo uma única versão vigente do roteiro. O banner de [`current-state.md`](https://github.com/wcvmsilva/structr-ai/blob/a7c17ed7b9deb48ea2aa097de1be4f9ac97b1ea9/docs/engineering/current-state.md#L3) já supera as afirmações antigas sobre publicação/inspeção e PDF/JSON; não usar esses trechos históricos para reabrir correções entregues. F5b tem implementação herdada, sem fechamento formal localizado; não tratá-lo como não implementado.
3. **Revalidar a base integrada e ativar PB-01:** registrar SHA, verificações e limites; vincular processos às fontes canônicas. O plano de sprint deve refletir a prioridade acordada, sem reativar automaticamente horas/folha ou decisões comerciais pendentes.
4. **Especificar PB-02/PB-03 a partir das lacunas:** checklist ligado à revisão; caminhos críticos de auditoria ainda legados; origem/versão das regras persistidas. Critérios de aprovação e dados obrigatórios precisam ser explícitos antes de implementar. Não reconstruir as três ligações de interface já corrigidas.
5. **Executar PB-04 no escopo adequado:** comprovar os três playbooks, seus bloqueios e evidências duráveis. Para uso real, continuam aplicáveis os [gates de migração, ownership, acesso, recuperação e operação implantada](https://github.com/wcvmsilva/structr-ai/blob/a7c17ed7b9deb48ea2aa097de1be4f9ac97b1ea9/docs/engineering/readiness-remediation-2026-09-19.md#L36), até evidência posterior que os resolva.

**Concluído nesta entrega:** revalidação do candidato e ajuste da fila para evitar retrabalho. **Ainda pendente:** integração dos PRs, encerramento de PB-00 na base resultante e execução das unidades seguintes. Publicação documental, integração de código e liberação de produção são estados distintos.
