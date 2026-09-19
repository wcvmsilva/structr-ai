# G2 — consolidação local de listagens e agregados

Registro de 15/09/2026, iniciado às 21:06 UTC. Repositório: https://github.com/wcvmsilva/structr-ai.

## Autorização e identidade

O usuário respondeu **“Autorizado!”** à proposta explícita de consolidar esta entrega em commits locais e revisar a versão resultante. A ação autorizada compreende código, documentação, verificações e revisão local. Não inclui publicação, alteração da PR9, merge, deploy, banco real ou nova unidade de implementação.

- Base anterior: `4534bec201fa22629a4a104b24c039f42faff265`.
- Commit de código criado às 21:06:32 UTC: `98b9b33071632e72a1faf176676495c7e3204cbd`.
- Branch: `codex/g2-rule-reads-20260915`, sem upstream.
- Checkout: `/private/tmp/structr-g2-rule-reads-20260915`.
- Manifesto aprovado antes dos commits: `.superpowers/sdd/g2-rule-reads/delivery-manifest.json`, SHA256 `bd4e01e8a23c1971365054938be5e4a0649720510681b092a6d3a96068b5c245`.
- Revalidação pré-commit pelo controlador e pelo revisor independente:35/35 entradas idênticas, sem divergências de tamanho ou hash. O patch coincide com os nove arquivos de código/testes. O commit preserva seus bytes.

Os dois documentos `g2-rule-reads-plan.md` e `g2-rule-reads-evidence.md` são preservados integralmente como registros pré-commit. Este registro acrescenta a autorização e os fatos da consolidação. O SHA do commit documental que contém este próprio arquivo será registrado externamente depois de existir; não é possível preencher seu próprio SHA neste conteúdo sem alterá-lo.

## Escopo consolidado

Produção: `server/geo-override-db.ts`, `server/geo-override-router.ts`, `server/remodel-router.ts`, `server/workflow-visualization-router.ts`, `server/seed.ts`. Testes: os dois novos de rule reads e as duas adaptações históricas de descoberta de seed. Não há alteração de esquema, migration, dependência, engine ou interface do produto.

A lista e o agregado exigem tenant confiável e aplicam ownership estrito. Sete callers da lista e um do agregado fornecem esse contexto. Filtros públicos zone/trade são efetivos, COUNT retorna number e falhas de DB geram erro sanitizado. Logs, UUIDs da visualização, seed completo e apresentação de erro em Review permanecem fora deste claim.

As15 linhas da matriz do plano continuam válidas para o diff idêntico. Nenhuma capacidade, dimensão, classificação, total ou status canônico é promovido pela consolidação. Não se transfere automaticamente o parecer pré-commit para outro SHA.

## Estado remoto e linhagens

Leitura remota desta rodada, sem fetch/pull:

| Ref | SHA |
|---|---|
| main | `8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf` |
| workflow/controlled-engineering-workflow | `f60cf9a56679d4d7083b2c11ac4e2727d53d84c3` |
| security/tenant-isolation-remediation-20260821 | `b95ea0bf4741646f418fcc99a22d22a42d24be51` |

A branch desta entrega não tem ref remoto observado. PR9 permanece OPEN, não draft, sem mergedAt, head b95ea0bf e baseRefOid `233569d68c014712ce3d25326bda8823aab1987e`. Essa base na metadata difere da main atual. O objeto main8fa permanece ausente localmente; não houve recuperação automática nem avaliação de mergeabilidade. Este commit consolida a cadeia local, não representa integração validada com main.

Task6, publicação documental pelas PRs12/13, F5b, G3a-2/G3a-3, G2-1 CRUD e precondição de perfil lead preservam os encerramentos anteriores. Não foram reabertos.

## Evidência e revisão pós-commit

O pacote pré-commit registrou82 testes novos e3.014 testes distintos aprovados, com169 não executados; esses números são **históricos** até serem reconfirmados na versão resultante. A prova RED e suas ressalvas de tipagem/matriz permanecem preservadas, sem nova reprodução anunciada.

Após o commit documental, o controlador executa o conjunto aprovado no SHA final: tipos da aplicação, tipos dos testes, suíte completa, focal70, laboratório PG46, regressão CRUD-PG50 e auditor tenant. PostgreSQL exclusivamente descartável local, socket privado, dados sintéticos; nenhum Supabase. O auditor pode usar o mesmo invocador `node --import tsx scripts/tenant-coverage-audit.ts` já delimitado no plano, sem alterar o scanner. Saída0 não é prova de segurança global.

Resultados efetivamente observados, exits, SHAs e revisão do commit documental ficam no dossiê `.superpowers/sdd/g2-rule-reads-consolidation/`, incluindo `final-report.md`, `execution-results.json`, `final-state.json`, `delivery-manifest.json` e recibo de revisão final. Esses registros são posteriores a este arquivo, separados para preservar a identidade do commit revisado. Ausência de um resultado não deve ser interpretada como aprovação.

A revisão interna segue a skill Superpowers requesting-code-review, com revisor distinto dos autores e contexto delimitado. A revisão independente Codex é somente leitura e sucede a disposição da revisão interna. Os pareceres anteriores são insumos históricos, não novos vereditos automáticos.

**Correção de nomenclatura, sem reescrever história:** o relatório pré-commit e recibos usaram “Gate7 formal” como referência imprecisa à revisão de SHA. No Security Gate publicado em f60cf9a5, camada7 é revisão interna Superpowers, camada8 é revisão independente Codex e camada9 é decisão humana. Nenhum PASS formal havia sido concedido nesses registros; a correção não altera resultados de código/testes.

## Limites e transição

G2 permanece aberta, em especial o contrato dos helpers de logs e sua persistência. A tela Review ainda pode apresentar falso vazio diante de erro da API. A visualização mantém entrada numérica incompatível com UUIDs reais e lê histórico antes da lista. O seed ainda tem placeholders e não desfaz etapas anteriores ao falhar. Não há prova de FK/RLS externos, durabilidade global da auditoria ou percurso comercial completo.

G1 rule-F2/F5, G4a e escritores de identidade/privilégios/contratos físicos mantêm suas pendências próprias. G3b/G4b e legado/backfill não se tornam bloqueios automáticos de todo recorte. PR9 continua NO-GO, B2 global não é defensível e o sistema não recebe liberação para campo por esta entrega. O estado de contenção no Supabase não foi consultado nesta rodada.

O veredito pós-commit, se favorável, vale somente para a consolidação local deste recorte no SHA nomeado. A autorização humana de execução já foi recebida; publicação, implantação, merge e implementação de outro recorte exigem sua própria decisão. Nenhuma dessas ações deve ser inferida dos resultados dos testes ou das revisões.
