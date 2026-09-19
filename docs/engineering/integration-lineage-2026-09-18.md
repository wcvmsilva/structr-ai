# R1 — reconciliação local de linhagens em 2026-09-18

Este documento identifica um candidato local de manutenção R1–R3. Não declara integração, liberação de campo, fechamento de PR #9 ou implementação comercial C-20. A autoridade atual é o contrato de execução (evidência local preservada: `<local-workspace>/munder-workspace/missions/development-20260918/EXECUTION-CONTRACT.md`), que autoriza esta fila finita e seleciona B0. As solicitações históricas de escolher uma base não são novos gates humanos.

## Identidade e reprodução

- Diretório: `<local-workspace>/munder-workspace/worktrees/structr-r1-r3-20260918`.
- Branch: `codex/munder-r1-r3-20260918`.
- Base Git: `fbf7e4cabf8e60ee1d46a13d9d316afee353b451`.
- B0: base acima mais o C1 combinado, SHA-256 `4dbd00aa64e0d9ebd1789f806d92a8ca919f707b557a6f28dcb7567cdb013a66`, em combined.patch (evidência local preservada: `<local-workspace>/munder-workspace/worktrees/structr-followups-20260918/tmp/munder-followups/candidate-c1/combined.patch`).
- Manifesto C1 (evidência local preservada: `<local-workspace>/munder-workspace/worktrees/structr-followups-20260918/tmp/munder-followups/candidate-c1/manifest.json`): SHA-256 `309180238cd8e7482c6ffd8c3ad39479ccf1c5c1461819484707e0408951a362`.

O destino preparado por Michael estava limpo; foi reutilizado, sem outra worktree. `git apply --check` e aplicação única passaram. Os 17 hashes (14 arquivos mais três herdados) conferem em c1-verification.json (evidência local preservada: `../../tmp/munder-r1-r3/r1/c1-verification.json`). Não foi reaplicado o patch de manutenção: ele já integra C1. B0 não é um commit inventado. Os inventários anteriores do destino e de task5 estão nos logs `initial-status` e `task5-status` em evidências R1 (evidência local preservada: `../../tmp/munder-r1-r3/r1/`).

## Inclusão e exclusão por caminho

As três cópias abaixo são bytes inalterados do commit task5 `91d083c2aa1e5b92c88b3a77a808f196c8d92012`, obtidos por `git show`. Não houve colisão. Hashes e origem estão em task5-sources.json (evidência local preservada: `../../tmp/munder-r1-r3/r1/task5-sources.json`).

| Caminho | Disposição |
|---|---|
| `docs/product/canonical-structr-truth-v1.md` | Incluído inalterado como registro canônico histórico; suas classificações não são promovidas por R1 |
| `docs/product/feature-evidence-maintenance.md` | Incluído inalterado como procedimento de evidências |
| `docs/planning/AGENT-CAPABILITY-ROADMAP.md` | Incluído inalterado como roadmap atribuído à sua origem |
| `README.md` de task5 | Excluído deliberadamente; apresentação sem dependência de runtime nesta manutenção |
| `.github/pull_request_template.md` de task5 | Excluído deliberadamente; governança não necessária a R2/R3 |
| `plans/current-sprint.md` de task5 | Somente referência externa; status de 11/09 não substitui estado atual |
| `plans/f5b-pilot-design.md` de task5 | Somente referência externa; desenho anterior à implementação F5b |
| `docs/product/commercial-authorization-first-delivery.md` de task5 | Somente referência externa de escopo proposto |
| `docs/product/postgres-preparation-tests.md` de task5 | Somente referência externa da infraestrutura M02 |
| `docs/product/proposal-issuance-implementation-plan.md` de task5 | Somente referência externa M00–M21; preserva evidência preparatória própria |
| `docs/product/proposal-issuance-technical-design-v3.md` de task5 | Somente referência externa de desenho ainda proposto |
| `docs/product/proposal-source-contract.md` de task5 | Somente referência externa de origem, escritores e decisões arquiteturais propostas |
| `server/postgres-fixture.integration.ts` de task5 | Preservado externamente; não importado nem executado |
| `server/proposal-source-approval.test.ts` de task5 | Preservado externamente; não importado nem executado |
| `server/test-support/disposable-postgres.ts` de task5 | Preservado externamente; não importado nem executado |
| `vitest.postgres.config.ts` de task5 | Preservado externamente; não importado nem executado |

A raiz de todas as referências task5 é `<local-workspace>/.structr-worktrees/task5`. Seu inventário contém um plano modificado e dez arquivos não rastreados. Os sete documentos de planejamento e quatro artefatos executáveis têm hashes registrados, sem mudança nessas fontes. Não se transfere o resultado preparatório de 2.285/79 ou dos nove testes PostgreSQL daquela linhagem para B0.

## Runtime, autoridade e estado de F5b

O runtime real é PostgreSQL: `server/db.ts` importa `drizzle-orm/postgres-js` e `postgres`; o schema usa `pgTable`. O texto MySQL/mysql2 de `AGENTS.md` está defasado. O manual permanece intacto; suas regras de TDD comportamental, autorização, auditoria e transações continuam aplicáveis. O contrato define três unidades de manutenção, sem novo domínio/sprint nem quota artificial de 60 testes.

Michael coordena escopo, estado e decisões; Dwight (`worker-structr-r1-r3-20260918`) é o único editor e runner; Gemini (`gemini-mu7bhyzn`) é revisor independente por ferramentas de arquivo, sem shell ou edição de fonte. Cada candidato é submetido com manifesto, patch, logs e hashes. A confirmação inicial do revisor é disponibilidade, não aceite do candidato. Avanço R1 → R2 → R3 depende da decisão interna de Michael após revisão real, sem reabrir escolhas rotineiras com o usuário.

`git merge-base --is-ancestor bcb50d3e9355256c1beef28190f24c4612f903ce HEAD` retornou 0: F5b já está implementado nesta linhagem. O [registro histórico F5b](../security/f5b-project-geo-evidence.md) documenta revisão estática interna e testes anteriores, mas ainda fala de candidato pré-commit e deixa revisão formal por SHA, fechamento e retrospectiva pendentes. A busca local nos documentos de segurança/planejamento/engenharia e relatórios de missão não localizou disposição final posterior: **fechamento formal não verificado**. Não houve consulta remota. R1 não reimplementa F5b nem usa essa pendência histórica para bloquear R2/R3 independentes. G1 rule-F5 (itens de bundle) não é F5b geográfico.

## Decisões de negócio preservadas

Fonte principal: plano task5 e decisões M00 (evidência local preservada: `<local-workspace>/.structr-worktrees/task5/plans/current-sprint.md`). A prioridade histórica F5b → C-20 é preservada como planejamento de produto; R1–R3 é manutenção explicitamente autorizada, sem abrir C-20.

| Decisão | Situação atribuída e requisito futuro |
|---|---|
| D1 — canal/evidência | E-mail externo e referência declarada são hipótese; comprovantes aceitos e regra de confirmação exigem decisão operacional |
| D2 — verificador | Segundo operador e permissão distinta são recomendação; política/responsáveis não escolhidos por esta fila |
| D3 — conteúdo | JSON interno versus PDF para cliente, termos mínimos, moeda e reconciliação comercial permanecem decisões de produto |
| D4 — persistência | PostgreSQL observado não aprova três tabelas, audit estrito compartilhado, prova de aprovação ou nova política de acesso |
| D5 — armazenamento | Acesso, responsável, retenção, limites de bytes/timeout e tratamento de órfãos exigem contrato futuro; temporários de teste não resolvem armazenamento comercial |
| D6 — identificação/testes | PREP-C20-2026-09-11 é preparação; número e testes da futura sprint comercial não são atribuídos aqui |

PRD (evidência local preservada: `<local-workspace>/.structr-worktrees/task5/docs/product/commercial-authorization-first-delivery.md`), desenho v3 (evidência local preservada: `<local-workspace>/.structr-worktrees/task5/docs/product/proposal-issuance-technical-design-v3.md`), plano M00–M21 (evidência local preservada: `<local-workspace>/.structr-worktrees/task5/docs/product/proposal-issuance-implementation-plan.md`) e contrato de origem (evidência local preservada: `<local-workspace>/.structr-worktrees/task5/docs/product/proposal-source-contract.md`) detalham essas propostas. Prova de aprovação ligada ao conteúdo, `columns-v1`, preservação de cliente/desconto, lock do cliente e proteção do feed de auditoria são propostas atribuídas, não decisões novas desta manutenção.

G4a permanece superseded; G4b-1 permanece NO-GO/STOP. NULL, nomes e carimbos de tenant não provam propriedade. M00 está parcial; silêncio não aprova política. Nenhuma mudança de banco vivo, migração, seed, publicação, merge ou rollout é autorizada por este documento.

## Verificação R1

Dependências existentes foram vinculadas por symlink local ignorado; os lockfiles têm hash idêntico. Sem instalação ou alteração das dependências compartilhadas. Comandos usam ambiente saneado sem credenciais de banco e tipos sem incremental. Os resultados reais e limitações estão no manifesto e logs R1; a suíte completa só será exigida após as mudanças finais de código. Nenhum teste novo de comportamento pertence a R1.


## Publicação reconciliada

Este registro preserva a evidência e os limites da unidade original. Caminhos de logs e missões marcados como locais não integram o repositório público; os originais e seus hashes permanecem no arquivo privado. O estado de integração posterior é registrado em [reconciliação de 18/09](progress-reconciliation-2026-09-18.md).
