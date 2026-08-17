# Fase 2 — Contrato técnico: ciclo pré-visita até estimate

Este documento fixa o contrato executável da **Fase 2** do Structr AI, conforme o
Dossiê-Mestre GCHI, o Parecer de Skills e as skills P0 `gchi-lead-intake-governance`,
`gchi-jobtread-integration-contract` e `gchi-tenant-identity-access`. Ele descreve o
fluxo canônico `lead → intake → pré-visita → geo context → scope → review → estimate →
documento → export JobTread`, os estados permitidos, os gates de bloqueio e as regras de
margem por canal. Nenhuma tela, rota ou planilha pode recalcular ou reinterpretar as
regras abaixo.

## 1. Objetivo e critério de sucesso

O objetivo é operacional e verificável: um projeto real precisa atravessar todo o ciclo
sem reintroduzir dados manualmente. Em termos de código, isso significa que o
`project_id` criado na conversão do lead é o mesmo identificador usado pelo briefing de
pré-visita, pelo checklist de campo, pelo geo context, pelo scope draft, pela revisão de
escopo, pelo estimate versionado e pelo registro de exportação JobTread.

| Critério | Meta de aceite |
|---|---:|
| Lead convertido gerando cliente ou projeto duplicado | 0 casos |
| Projeto criado sem os quatro dados mínimos | 0 casos |
| Pré-visita emitindo preço definitivo | 0 casos |
| Estimate criado sem escopo aprovado | 0 casos |
| Estimate aprovado sobrescrito no lugar | 0 casos |
| Exportação JobTread sem estimate aprovado | 0 arquivos |
| Divergência entre total exportado e total aprovado | US$ 0,00 |

## 2. Cadeia canônica de entidades

Toda entidade da cadeia carrega `tenant_id`, e toda entidade posterior ao projeto carrega
`project_id`. A conversão do lead é a única fronteira em que `client` e `project` passam a
existir, e ela roda em transação única no servidor.

| Etapa | Entidade canônica | Chaves obrigatórias | Regra de integridade |
|---|---|---|---|
| Captura | `leads` | `tenant_id`, `source_channel`, contato, `next_step` | Origem é imutável; correção exige evento auditado (`LIG-005`). |
| Intake | `intake_forms` | `tenant_id`, `lead_id` ou `project_id`, `schema_version` | Respostas preservam classificação de evidência (`LIG-008`). |
| Conversão | `clients` + `projects` | `tenant_id`, `client_id`, `project_id`, `lead_id` | Reusar cliente confirmado; novo projeto exige endereço/escopo distinto (`LIG-003`, `LIG-004`). |
| Pré-visita | `previsit_briefs` + `previsit_checklists` | `tenant_id`, `project_id` | Nunca emite preço definitivo; decisão única de próxima etapa. |
| Geo context | `projects.zone`, `projects.zone_modifier_snapshot` | `project_id` | Alimentado pelo endereço do projeto; warnings propagam ao scope. |
| Escopo | `scope_drafts` + `scope_draft_items` | `tenant_id`, `project_id`, `intake_form_id` | Estados controlados por state machine determinística. |
| Revisão | `scope_review_deltas` + `scope_review_snapshots` | `scope_draft_id`, aprovador | Deltas e snapshot com responsável explícito. |
| Estimate | `estimate_drafts` | `tenant_id`, `project_id`, `scope_draft_id`, `version` | Só nasce de escopo aprovado; versão aprovada é imutável. |
| Exportação | `jobtread_exports` | `tenant_id`, `project_id`, `estimate_draft_id` | Registro imutável por tentativa, com manifest e reconciliação. |

## 3. Gate 1 — Lead → Intake → Project sem duplicação

A conversão exige os quatro dados mínimos do dossiê: **cliente, endereço, tipo de projeto
e tipo de cliente/canal**. A ausência de qualquer um deles bloqueia a criação do projeto
operacional e devolve um relatório de campos faltantes, em conformidade com `LIG-007`.

O motor de conversão (`shared/intake-conversion.ts`) é puro e responde três perguntas
antes de qualquer escrita: quais campos mínimos faltam, qual cliente existente deve ser
reutilizado e se o endereço solicitado já possui projeto ativo. A decisão resultante é uma
das quatro abaixo, e apenas a primeira autoriza escrita imediata.

| Decisão | Condição | Efeito |
|---|---|---|
| `convert` | Dados mínimos completos e nenhuma duplicidade material | Cria/reusa cliente, cria projeto, marca lead como convertido |
| `reuse_client` | Cliente existente confirmado por e-mail/telefone normalizado | Reusa `client_id` e cria novo projeto para o novo endereço |
| `needs_review` | Matching inconclusivo ou conflito de dados | Lead permanece em revisão; nada é criado |
| `blocked_minimum_data` | Falta cliente, endereço, tipo de projeto ou canal | Nada é criado; relatório lista campos faltantes |

A conversão também normaliza o canal comercial para o vocabulário fechado exigido pela
skill (`organic_search`, `paid_search`, `website_direct`, `referral`, `repeat_client`,
`trade_partner`, `social`, `phone`, `walk_in`, `event`, `import_approved`, `other`) e
propaga um snapshot dessa origem para cliente e projeto. Cada lead ativo mantém
exatamente uma `next_step` (`LIG-006`); payloads com múltiplas recomendações são
normalizados para a de maior prioridade e o descarte fica registrado.

## 4. Gate 2 — Pré-visita e briefing

A pré-visita reduz suposição e prepara decisão; ela **não** produz preço definitivo. Cada
campo relevante do briefing carrega uma classificação de evidência, e o motor recusa
qualquer tentativa de tratar inferência como fato.

| Classificação | Significado | Uso permitido |
|---|---|---|
| `FACT` | Verificado pela GCHI em campo, documento oficial ou base canônica | Pode alimentar decisão técnica e preço |
| `CLIENT PROVIDED` | Informado pelo cliente, ainda não verificado | Contexto e roteamento; exige verificação para preço |
| `INFERENCE` | Derivado por regra, padrão regional ou similaridade | Visível como inferência; nunca vira fato automaticamente |
| `UNKNOWN` | Lacuna declarada | Gera item de checklist e pendência explícita |

O encerramento da visita produz **uma única recomendação principal**, escolhida entre
`conceptual_estimate`, `survey_zoning_verification`, `design`, `structural_evaluation`,
`paid_preconstruction` e `design_build_proposal`. O briefing armazena as demais opções
apenas como alternativas descartadas, com o motivo do descarte, o que preserva a
disciplina de não estimar condições não verificadas.

O checklist de campo é derivado do briefing: cada `UNKNOWN` relevante e cada risco costeiro
identificado geram um item obrigatório, vinculado ao mesmo `project_id`. Itens obrigatórios
pendentes bloqueiam a promoção do briefing para `completed`.

## 5. Gate 3 — Geo context integrado

O intake e a conversão alimentam automaticamente o geo context: o endereço do projeto
passa por geocodificação, detecção de zona e snapshot de modificadores, persistidos em
`projects`. O resultado é reduzido a um conjunto determinístico de avisos de risco costeiro
e exposição, que o Scope Builder recebe junto com o intake.

| Sinal geo | Origem | Propagação obrigatória |
|---|---|---|
| Zona e snapshot de modificadores | `geo-integration.ts` | `projects.zone`, `projects.zone_modifier_snapshot` |
| Falha ou baixa confiança de geocode | `geocode_confidence` | Aviso `geo.geocode_low_confidence` no scope |
| Zona costeira / barrier island | Classificação da zona | Aviso `geo.coastal_exposure` e piso de margem elevado |
| Fora do raio de serviço | `withinServiceRadius` | Aviso `geo.outside_service_radius` |

## 6. Gate 4 — Scope Builder → Scope Review

A state machine de escopo permanece determinística e agora expõe `in_review` como alias
público de `under_review`, preservando compatibilidade com o dado persistido.

```
draft ──▶ in_review (under_review) ──▶ approved ──▶ converted
                                  └──▶ rejected (terminal)
```

A revisão registra três evidências obrigatórias: os **deltas** aplicados com motivo do
operador, o **snapshot** dos itens efetivos no momento da decisão e o **responsável pela
aprovação** com timestamp. Sem essas três evidências, o escopo não é considerado aprovado
para fins de estimate.

## 7. Gate 5 — Estimate e Profit Shield por canal

O estimate só pode ser criado a partir de escopo `approved` ou `converted`. O Profit Shield
passa a operar com pisos por canal comercial, conforme o dossiê, mantendo os pisos
geográficos como reforço.

| Canal comercial | Piso de margem | Natureza | Comportamento em violação |
|---|---:|---|---|
| Premium / Homeowner | 28% | Gross profit | Bloqueio de aprovação; exige alternativa de escopo, valor ou pagamento |
| Trade / Builder | 18% | Gross profit | Bloqueio de aprovação |
| Capital / Investor | 15% | Fee mínimo | Bloqueio de aprovação |

Os pisos geográficos continuam válidos e são combinados por máximo: zona costeira eleva o
piso a 42% e barrier island a 50%. A avaliação retorna sempre o piso efetivo, o piso do
canal, o piso geográfico e a lista de violações, de modo que a interface nunca precise
recalcular margem.

O estimate preserva snapshot de canal, acabamento, região, zona e dimensões de preço. A
versão aprovada é imutável: aplicar desconto, alterar linhas ou reprecificar exige **nova
versão** (`version = n + 1`, com `superseded_by` na anterior) ou **change order** formal. A
tentativa de mutação direta de um estimate aprovado é rejeitada com erro explícito.

## 8. Gate 6 — Exportação JobTread

A exportação segue o CSV v1.0 de nove colunas, na ordem exata, UTF-8 com BOM e newline
final. Antes de qualquer download, o pipeline percorre os estados `requested → validating →
reconciling → approved_for_download`, com bloqueios explícitos.

| Estado de bloqueio | Causa |
|---|---|
| `blocked_authorization` | Estimate sem `project_id`, fora do tenant ou sem permissão |
| `blocked_validation` | Linha com campo obrigatório, unidade, tipo ou cost code inválido |
| `blocked_reconciliation` | `Σ(Quantity × Unit Price)` diferente do total aprovado |
| `needs_exception_review` | Divergência originada de desconto, lump sum ou regra de pagamento |

A reconciliação é calculada em centavos inteiros, nunca em ponto flutuante binário, e
comparada ao `final_total_price` do estimate aprovado. O `cost_code` continua obrigatório
para governança, porém não entra como décima coluna: ele é gravado no manifest por linha,
junto de grupo, item, tipo e flag de fallback de assembly.

## 9. Matriz de bloqueios executáveis

| Bloqueio | Origem da regra | Erro esperado |
|---|---|---|
| Converter lead sem dados mínimos | `LIG-007` | `blocked_minimum_data` com campos faltantes |
| Criar segundo cliente para o mesmo contato | `LIG-003` | `needs_review` com candidatos avaliados |
| Criar projeto duplicado no mesmo endereço | `LIG-004` | `needs_review` com `project_id` existente |
| Briefing com preço definitivo | Dossiê §3.2 | Rejeição do payload de briefing |
| Briefing com múltiplas recomendações | Dossiê §3.2 | Normalização para decisão única auditada |
| Estimate sem escopo aprovado | Fase 2, item 5 | `SCOPE_NOT_APPROVED` |
| Aprovar estimate abaixo do piso do canal | Dossiê §3.1 | `PROFIT_SHIELD_CHANNEL_FLOOR` |
| Sobrescrever estimate aprovado | `JIC` + dossiê | `ESTIMATE_VERSION_LOCKED` |
| Exportar sem estimate aprovado | `JIC-002` | `blocked_authorization` |
| Exportar com total divergente | `JIC-003` | `blocked_reconciliation` |

## 10. Superfície de código da Fase 2

| Camada | Arquivo | Responsabilidade |
|---|---|---|
| Motor puro | `shared/intake-conversion.ts` | Dados mínimos, canal fechado, dedupe e decisão de conversão |
| Motor puro | `shared/previsit-engine.ts` | Evidência, decisão única, checklist e proibição de preço |
| Motor puro | `shared/constants/profit-shield.ts` | Pisos por canal e piso efetivo combinado |
| Motor puro | `shared/jobtread-reconciliation.ts` | Reconciliação em centavos e manifest de cost code |
| Persistência | `server/lead-conversion.ts` | Transação canônica de conversão com auditoria |
| Persistência | `server/previsit-db.ts` | Briefings, checklists e transições |
| Persistência | `server/jobtread-export-db.ts` | Registro imutável de exportação |
| API | `server/previsit-router.ts` | Briefing, checklist, decisão e prontidão para escopo |
| API | `server/estimate-router.ts` | Gate de escopo aprovado, Profit Shield, versionamento, export |
| Schema | `drizzle/0002_phase2_previsit_estimate.sql` | Tabelas e colunas novas, idempotentes |

## Referências

[1]: file:///home/ubuntu/upload/dossie-mestre.md "Dossiê-Mestre GCHI — ciclo operacional, pisos de margem e Fase 2"
[2]: file:///home/ubuntu/upload/parecer-skills-gchi.md "Parecer de Skills GCHI — prioridades P0"
[3]: file:///home/ubuntu/skills-p0/gchi-lead-intake-governance/SKILL.md "GCHI Lead & Intake Governance v1.0.0"
[4]: file:///home/ubuntu/skills-p0/gchi-jobtread-integration-contract/SKILL.md "GCHI JobTread Integration Contract v1.0.0"
[5]: file:///home/ubuntu/skills-p0/gchi-tenant-identity-access/SKILL.md "GCHI Tenant, Identity & Access v1.0.0"
