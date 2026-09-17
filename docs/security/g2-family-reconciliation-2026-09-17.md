# G2 — reconciliação da família após os recortes locais

Observação: 2026-09-17. Repositório: `https://github.com/wcvmsilva/structr-ai`. Estado local observado: branch `codex/g2-override-logs-20260915`, HEAD de encerramento anterior a este registro `7dad361432558b2c56bdc672650a7a971996d8b2`, árvore limpa e sem upstream.

## Resultado

Os recortes de CRUD, listagem/agregado, históricos e contrato UUID da visualização possuem implementações e provas locais próprias. CRUD, históricos e contrato UUID possuem registros explícitos de encerramento humano; listagem/agregado possui consolidação local em `a9c30f14`, sem promover este registro a encerramento humano não demonstrado. Isso permite afirmar que as fronteiras B2 diretamente cobertas por esses recortes foram tratadas nos SHAs nomeados abaixo. Ainda **não** permite declarar “G2 inteira encerrada”, segurança global, prontidão de campo ou merge da PR #9.

O inventário direto atual de `server/geo-override-router.ts` contém **13 endpoints**, distribuídos em **7 `tenantProcedure`** e **6 `adminTenantProcedure`**. A referência histórica a 15 superfícies não corresponde ao número de endpoints desse router no HEAD observado; contagens de consumidores e helpers continuam sendo dimensões distintas e não são reclassificadas como rotas.

## Inventário direto e disposição

| Grupo | Endpoints | Fronteira observada | Disposição |
|---|---|---|---|
| CRUD | `getRule`, `createRule`, `updateRule`, `deactivateRule`, `reactivateRule` | Tenant explícito; criação usa autoridade do contexto; leituras e mutações exigem ownership estrito | Recorte G2-1 encerrado localmente em `622e6afb9591c8b118c8661e5695f9870e26a53b` |
| Regras e agregado | `listRules`, `statsByZone` | Tenant obrigatório; regras de outro tenant ou sem tenant são excluídas; filtros e contagem foram cobertos | Código `98b9b33071632e72a1faf176676495c7e3204cbd`; consolidação `a9c30f143f1fda7f64c2b7454f051011c217e84b` |
| Resolução | `resolveForDraft`, `previewForDraft` | Tenant obrigatório e guard de entidade; resolução persistente usa leitores e escritores autorizados | Cobertura parcial da família; limites dos pais do preview permanecem abaixo |
| Histórico | `getLog`, `hasOverrides`, `clearLog` | Autoridade explícita; política local dos pais; verificação transacional nas mutações | Código `d005913bfce67cbe897b6de99bd7fc4a55107c4e`; encerramento `d70bf5a59ae8d3ce89dc0c84b6b9fe9315dd59e7` |
| Seed | `seedCoastalRules` | Admin e tenant obrigatórios; descoberta e inserts recebem tenant explícito | Caller-axis B2 tratado; atomicidade e contratos operacionais permanecem abertos |

## Consumidores reconciliados

- Os sete consumidores produtivos observados de `listOverrideRules` fornecem contexto de tenant.
- Os consumidores de histórico em remodelação, visualização e pipeline fornecem autoridade explícita; os dois caminhos de estimativa fazem preflight antes dos efeitos protegidos.
- O contrato UUID da visualização foi corrigido em `cb1a2048b560c40d558c68b1f3806d1ade2a3ce7`, documentado em `363616b80e7a36c47365de9c76eaa60cfee9edb4` e encerrado localmente em `7dad361432558b2c56bdc672650a7a971996d8b2`.
- Ownership de uma regra G2 não prova ownership das assemblies ou cost codes por ela referenciados. Essa dependência deve ser medida no desenho G4a; o presente registro não amplia automaticamente seu escopo para todos os escritores e contratos de referências do catálogo.

## Resíduos e classificação

| Resíduo | Classificação atual | Consequência |
|---|---|---|
| `seedCoastalRules` chama uma criação transacional por iteração, mas não envolve o lote inteiro em uma única transação | **Bloqueio da PR #9 por `rule-F5`**, sem reabrir automaticamente o B2 dos endpoints já cobertos | Uma falha intermediária pode deixar lote parcial; exige unidade e RED próprios antes de qualquer claim global |
| `previewForDraft` preserva o guard de projeto anterior e não recebeu a política local de pais dos históricos | **Dívida de autorização dos pais relevante à revisão B2 final** | Deve haver medição comportamental específica para draft de outro tenant, projeto sem tenant e projeto excluído antes de classificá-la como bloqueio corrigível ou limite aceito |
| Lookups de assemblies e componentes usados por resolver, preview e consumidores não excluem linhas tenant-stamped | **Bloqueio B2/PR #9 da unidade G4a** | Regra própria pode referenciar catálogo de outro tenant; ownership da regra não fecha a dependência |
| Seed contém referências provisórias como `"101"` e `"201"` em campos UUID e idempotência ampla | **Follow-up de campo/seed operacional** | Não usar como provisionamento validado; nenhuma migração ou backfill é inferida |
| A tela Review converte erro das consultas de overrides em aparência de histórico vazio | **Follow-up de campo/UI** | A API pode negar corretamente enquanto a interface informa falso vazio |
| Auditoria posterior ao commit pode retornar nulo ou falhar depois do negócio confirmado | **Dívida separada de auditoria/condição operacional** | Não alegar durabilidade ou atomicidade global da auditoria |
| Snapshot dos históricos não cobre catálogo, ciclos intermediários que restauram o mesmo valor ou escritores externos | **Limite de contrato** | Não alegar serialização ou isolamento global |
| G1 `rule-F2`/`rule-F5`, escritores de identidade/privilégios e integração final | **Bloqueios independentes da PR #9** | Permanecem fora de G2 e precisam de disposição própria |

## Estado externo observado em leitura

Em 2026-09-17, o GitHub informou: PR #9 OPEN, não draft, não merged, head `b95ea0bf4741646f418fcc99a22d22a42d24be51`, base metadata `233569d68c014712ce3d25326bda8823aab1987e`; a main remota resolve para `8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf`. A branch local desta reconciliação não foi encontrada no remoto. A diferença da base permanece matéria da integração final.

O Supabase informou o projeto `structr-ai` como `ACTIVE_HEALTHY`. O painel mostrou **Data API desativada** e a mensagem de que nenhum schema pode ser consultado por essa API. A listagem administrativa mostrou **60 tabelas com RLS desativado**, incluindo superfícies operacionais. Esses fatos têm limites distintos:

- Data API desligada contém a via `/rest/v1` no estado observado.
- Isso não prova bloqueio de conexões PostgreSQL diretas, grants, papéis ou outros caminhos.
- RLS desativado impede alegar proteção por RLS e prontidão global do ambiente.
- Nenhuma política, RLS, grant, schema, linha ou configuração foi alterada nesta rodada.

O estado externo é uma precondição operacional/global e não converte automaticamente cada helper G2 em bypass demonstrado. Também não concede GO para reativar a Data API: ativar RLS sem políticas pode interromper o sistema, e reativar a API com as tabelas atuais reabre risco de exposição.

## Próxima unidade e paradas

A próxima unidade sequencial do roteiro Class-G é **G4a — Assemblies interim platform-catalog carve-out**, começando em Recovery/Design. Antes do RED, o desenho deve resolver explicitamente:

1. se `scope.preview` e `estimate.validate`, hoje consumidores pré-tenant dos mesmos helpers, entram no claim ou ficam como risco residual que impede um claim B2 global;
2. como impedir que uma assembly sem tenant exponha um `cost_code` tenant-stamped por meio de `assembly_items`, sem inventar ownership para NULL;
3. como manter G4a restrito à exclusão negativa de linhas tenant-stamped, deixando marker canônico, schema, migração, seed, CRUD tenant e `canonical ∪ tenant` para G4b.

Até essas decisões e o desenho correspondente serem aprovados, não há autorização para RED ou implementação G4a. O saneamento de tipos do teste Sprint 17 e o endpoint legado `learningLayer.getSuggestion` continuam dívidas separadas e não substituem o próximo bloqueio do roteiro de segurança.

## Não-claims

Esta reconciliação não executa testes, não reabre unidades encerradas, não promove capacidade, não fecha G2 inteira, G4a, G4b, G1, segurança global ou PR #9, e não autoriza campo. Não houve push, edição da PR, merge, deploy, Supabase write, operação de banco, migração, seed, backfill, instalação, automação ou Phase 3.
