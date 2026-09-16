# G2 — política de autoridade dos históricos de regras geográficas

Base de código: `a9c30f143f1fda7f64c2b7454f051011c217e84b`. Este documento registra a política **aprovada** e o que ela deliberadamente não decide. Ele não promove nenhum gate técnico nem de segurança.

## Decisão aprovada

O acesso ao histórico de aplicação de regras geográficas (`scope_override_log`) é autorizado pelos **pais atuais** do rascunho de escopo — o projeto que o contém — e pela permissão exigida por cada operação.

| Contexto da empresa A | Decisão |
|---|---|
| Projeto A e rascunho A | Permitir conforme a permissão da operação |
| Projeto A e rascunho sem empresa | Permitir pelo vínculo exato ao projeto autorizado; a coluna do rascunho permanece intacta |
| Projeto A e rascunho B | Negar a inconsistência |
| Projeto B | Negar, inclusive para administrador de A |
| Projeto sem empresa identificada | Negar localmente até classificação em unidade própria |
| Pai ausente, projeto excluído ou identidade/empresa não resolvida | Negar |

A política vale **nos dois modos de `TENANT_STRICT`**: o predicado local não consulta essa variável. Ela não atribui propriedade a dados legados, não reescreve colunas e não altera a política global do guard de projetos.

## Autoridade do histórico versus propriedade da regra

Histórico autorizado pelo pai permanece legível quando a regra original foi **removida, desativada ou passou a pertencer a outra empresa**, e quando o vínculo com a regra é nulo. A regra atual só autoriza **novas gravações**: uma entrada nova exige regra existente, da própria empresa, ativa e válida para o motor.

## Permissões por operação

| Operação | Fronteira | Permissão no projeto |
|---|---|---|
| `geoOverride.getLog` | `tenantProcedure` | read |
| `geoOverride.hasOverrides` | `tenantProcedure` | read |
| `geoOverride.resolveForDraft` | `tenantProcedure` | write, mesmo com `persistLog:false` |
| `geoOverride.clearLog` | `adminTenantProcedure` | delete |
| `remodel.generateWorkflow` | `tenantProcedure` | write |
| `workflowViz.loadVisualization` | `tenantProcedure` | read |
| `estimate.createFromScopeDraft` | `tenantProcedure` | write |
| `estimate.retryPartialDraft` | `tenantProcedure` | write |

Um principal autorizado a escrever não recebe exigência adicional de leitura: o leitor recebe a permissão do propósito que o chamou. A restrição administrativa da limpeza permanece na fronteira da API, e o helper ainda exige `delete` no projeto.

## Autoridade observada

A autoridade é sempre `{tenantId, userId}` do contexto autenticado da requisição. Empresa, usuário ou papel presentes no payload, no lote de gravação ou em qualquer snapshot **nunca** são consultados.

## Limites explícitos desta política

- Não fecha G4 (propriedade do catálogo), RLS, nem escritores externos que ignorem o protocolo da aplicação.
- Não corrige a identidade do registro de auditoria (`userId: null` com `operatorId` no payload do domínio) nem promete auditoria durável ou atômica com a mudança de negócio.
- Não decide atribuição de empresa a dados legados: rascunhos e projetos sem empresa continuam como estão, apenas com o acesso ao histórico negado quando o projeto não tem empresa identificada.
- Não altera motor, schema, taxonomia, preços, UI, nem a política global de guards/`TENANT_STRICT`.
