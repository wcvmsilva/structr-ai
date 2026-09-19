# PB-02 — Omissões recorrentes na revisão de escopo

**Data:** 19/09/2026 UTC. **Escopo:** primeiro recorte de PB-02, após a consolidação dos PRs #14 e #15 em `87f4239d7532eaae2d29be32a184ad36abbf78f1`. Fonte testada: `91a772194f47ee5407edcb0367b5b9831099b6e3`.

## Resultado

A revisão de escopo agora mostra padrões históricos de omissões para o tipo persistido do projeto autorizado pelo rascunho. O painel informa código de custo, sugestão, frequência, número de projetos e custo médio histórico quando disponíveis. É um apoio à revisão; não certifica completude, não reconhece padrões automaticamente e não altera aprovação, margem, preço ou geração de orçamento.

O consumidor reutiliza `project.getById` e `scopeCompleteness.getChecklist`. A leitura do checklist mantém o tenant da sessão, padrões recorrentes não excluídos, ordem por custo não planejado e limite de 100. As chaves históricas recebem apenas trim/lowercase; não há migração ou unificação de aliases.

Ausência de banco agora produz erro, em vez de histórico vazio. A tela distingue carregamento, projeto sem tipo, leitura indisponível e consulta bem-sucedida sem padrões. Dados em cache são ocultados enquanto há erro, troca de contexto ou carregamento; a nova tentativa usa a consulta que falhou. Metadados nulos permanecem indisponíveis, enquanto zero continua um valor válido.

## Verificação

O [manifesto](pb02-scope-checklist-verification-2026-09-19.json) vincula arquivos, hashes e execuções à fonte testada. Nenhuma credencial de banco ou serviço foi herdada nas verificações locais.

| Verificação | Resultado |
|---|---|
| TypeScript não incremental (`pnpm exec tsc --noEmit --incremental false`) | 0 erros |
| Suíte integral (`pnpm test`) | 3.848 aprovados, 367 pulados, 0 falhas; 116 arquivos aprovados e 11 pulados |
| Novos testes comportamentais | 54: 19 DB, 17 router, 18 UI |
| Backend focal, incluindo motores existentes de Phase 4 | 60 aprovados |
| UI focal, incluindo handoff existente Review → Estimate | 25 aprovados |
| Compilação hospedada (`pnpm build:vercel`) | Aprovada; aviso existente de tamanho do bundle permanece |
| TDD | Backend: 13 falhas esperadas/23 passes antes da correção. UI: 17 falhas esperadas/1 passe antes do componente. GREEN registrado antes da suíte integral. |

Os testes de DB exercitam a consulta gerada pelo Drizzle e seus parâmetros sobre linhas sintéticas; não substituem PostgreSQL físico nem comprovam RLS. Os 367 testes pulados continuam explicitamente fora desta execução. Os 288 testes físicos registrados na consolidação são evidência histórica e não foram repetidos neste recorte.

No Chrome, um ensaio local utilizou o componente real, React Query, tRPC e transporte sintético, sem acesso a banco ou serviços externos. Foram observados: apresentação dos valores, troca de projeto, resposta antiga chegando após a troca, erro com dados em cache, recusa de acesso ao projeto, falha de rede, recuperação pelos dois botões de nova tentativa, tipo ausente e consulta vazia. Somente as duas consultas previstas foram emitidas. O servidor e a aba de ensaio foram encerrados. Esse ensaio verifica o componente e seu ciclo de consultas; não é uma jornada autenticada completa no ambiente hospedado. As observações são manuais; não há gravação automatizada exportada do navegador.

## Inventário de entrega

- Criados: `client/src/components/review/ScopeChecklistPanel.tsx`, `server/scope-checklist-db.test.ts`, `server/scope-checklist-router.test.ts`, `server/scope-checklist-ui.test.ts`.
- Modificados: `client/src/pages/Review.tsx`, `server/scope-completeness-db.ts`, `server/scope-completeness-router.ts`, `server/review-estimate-handoff-ui.test.ts`.
- Documentação: contrato Phase 4, roteiro/revalidação dos playbooks, fila de trabalho, este relatório e manifesto. O histórico de consolidação registra a evidência final do PR #14.
- Novas tabelas: 0. Novas funções de motor: 0. Novos helpers de DB: 0. Novos endpoints: 0.
- Segurança: o endpoint alterado continua em `protectedProcedure`, valida entrada com Zod e usa o tenant da sessão. O identificador de projeto vem do rascunho autorizado.
- Auditoria: nenhuma mutação criada ou modificada; o painel só lê. Regras de auditoria existentes permanecem aplicáveis.
- Regressões observadas: nenhuma na suíte executada. Testes pulados não são apresentados como aprovados.

Este recorte não encerra uma sprint ou PB-02 inteiro; os 54 testes não são apresentados como cumprimento do mínimo de 60 por sprint. Não há novo domínio, motor, esquema ou regra comercial nesta entrega.

## Publicação, limites e reversão

As verificações remotas do SHA publicado devem constar do PR desta entrega. A configuração `git.deploymentEnabled.main=false` permanece; ela retém deploys por integração Git, não impede publicações manuais/API/CLI. A integração de código não ativa produção nem resolve os gates de catálogo/ownership (C-20 pausado), caminhos legados de identidade/auditoria, recuperação integral de dados/Auth/Storage/PostGIS, permissões hospedadas e jornadas representativas.

Aprovação/pagamento de custos, documentação completa dos processos, origem/versão das regras e os três playbooks ponta a ponta continuam na fila. O desenho comercial R3/R4 permanece em frente separada e não foi implementado por este painel.

Se o painel apresentar histórico de contexto incorreto ou prejudicar a revisão, reverter os commits `91a77219` e `e7f0f373`, em ordem inversa. Não há migração ou alteração de dados a desfazer. Preservar a contenção de hospedagem e as correções da consolidação.
