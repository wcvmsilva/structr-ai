# G4b-1 — Recover e preflight somente leitura

## 1. Estado, sujeito e autoridades

- **Data da observação:** 2026-09-17, encerrada às 17:03 EDT.
- **Classificação Superpowers:** arquitetural.
- **Estado do documento:** desenho aprovado pelo humano nesta sessão; artefato documental criado sob autorização exclusiva de escrita deste arquivo.
- **Transição avaliada:** G4b-1 Recover/Design → Plan, implementação ou G4b-2.
- **Resultado formal:** **NO-GO**. O comportamento exigido é **STOP**; o preflight permanece incompleto e a transição está bloqueada.
- **Base local observada:** `8c2fdfb630933259998fa98616b2ae08e2ce32ad`, branch `codex/g2-override-logs-20260915`, worktree `/private/tmp/structr-g2-override-logs-20260915`, limpa antes desta edição.
- **Desenho-mãe:** `docs/security/g4b-catalog-ownership/2026-09-17-design.md` no SHA acima; SHA-256 observado `fb2c5ad7622e099524dd4c21dd52da1b7109b6dec912136c113c4e497e923228`.
- **Estado reconciliado do workflow:** `0db4499cc6be577d1c1bf408c624968a7c7f67e3`.
- **Autoridades publicadas observadas:** `main` `8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf`; Controlled Engineering Workflow `f60cf9a56679d4d7083b2c11ac4e2727d53d84c3`; linha de segurança remota `b95ea0bf4741646f418fcc99a22d22a42d24be51`; `AGENTS.md`; ADR-001 e registros de segurança ligados aos respectivos SHAs.
- **Ambiente vivo examinado:** Supabase `structr-ai`, project ref `xoqhxpqsfxpdiwyuvhdd`.
- **Avaliador da evidência:** Codex `/root`; revisão documental independente atribuída a `/root/g4b1_workflow_review` e `/root/g4b1_evidence_review`.

O humano aprovou o desenho apresentado em sessão com decisão STOP e autorizou somente a criação deste artefato. Essa autorização não alcança plano, RED, código, teste, schema, migration, dado, policy, grant, configuração viva, commit, push, PR, merge, deploy ou campo.

STOP é o comportamento exigido diante dos fatos abaixo. Os estados formais usados por este registro são `PASS`, `FAIL`, `BLOCKED`, `NOT EVALUATED` e `NO-GO`.

## 2. Escopo executado e proibições preservadas

G4b-1 executou apenas Recover/Design e preflight read-only da Fase 0 do desenho-mãe:

- reconciliou SHA, branch, worktrees e autoridades;
- inventariou schema, migrations, constraints, índices, triggers, FKs, policies, grants, owners, roles e extensões por catálogos e painel;
- consultou as 29 tabelas nomeadas pelo humano; 28 existiam, e somente nelas calculou as métricas aplicáveis e autorizadas de NULLs, órfãos, duplicatas candidatas e relações cross-tenant;
- calculou fingerprints SHA-256 individuais dos 28 conjuntos existentes, sem retornar linhas, IDs ou conteúdo;
- inventariou estaticamente readers, writers, scripts, SQL, mounts, consumidores, publishers de credencial, audit, exports, feedback e issues relevantes;
- observou backup/PITR e executou `EXPLAIN` sem `ANALYZE` para consultas nomeadas.

Não houve escrita ou alteração em dado, schema, policy, grant, configuração, Supabase, migration, seed, backfill ou automação. Até a criação autorizada deste arquivo, não houve escrita no repositório. Nenhum teste ou script operacional foi executado como parte do preflight vivo.

## 3. Método, fontes e limites da evidência

As fontes foram mantidas separadas:

1. Git local e objetos exatos para SHA, branch, estado e texto das autoridades;
2. GitHub e refs remotas somente para estado observado das linhagens e PR #9;
3. catálogos PostgreSQL para estrutura, migrations, constraints, roles, grants, policies e dependências;
4. painel Supabase autenticado para Data API, backup, PITR e estado do projeto;
5. SQL somente leitura autorizado para consultar as 29 tabelas nomeadas e calcular agregados aplicáveis nas 28 existentes;
6. leitura estática do repositório para superfícies executáveis e consumidores;
7. `EXPLAIN` sem execução mutável para planos selecionados.

As fingerprints foram calculadas conceitualmente por hash SHA-256 de cada representação de linha, ordenação dos hashes fixos e SHA-256 do conjunto concatenado. Seus roots completos foram mostrados somente na sessão autorizada e **não são persistidos neste arquivo**. Eles não eram HMAC, e roots de conjuntos pequenos podem permitir comparação por dicionário.

Não há prova preservada de que as 28 fingerprints tenham compartilhado um único snapshot MVCC. Elas são baselines individuais e transitórias, não uma fingerprint atômica do grafo. Hash, contagem, stamp de tenant e consistência estrutural não provam ownership, proveniência ou canonicalidade.

Toda negativa deste documento é limitada aos predicados e conjuntos examinados. Ela não cobre referências inbound não consultadas, conteúdo JSON opaco, tabelas ausentes ou caminhos executáveis que não tenham sido inventariados.

## 4. Ledger do preflight da Fase 0

| Gate da Fase 0 | Estado | Evidência observada | Limite/disposição |
|---|---|---|---|
| SHA, branch e worktree | PASS | Base exata `8c2fdfb...`; árvore limpa antes deste arquivo | Não prova integração com `main` nem PR #9 |
| Migration history | BLOCKED | 59 migrations vivas contra 5 entradas locais no journal | Quantidade é sinal; identidade e hash ainda não foram reconciliados |
| Fingerprint do schema | PASS | Catálogo vivo medido para colunas, constraints, índices, triggers e policies | PASS estreito para a baseline temporal; não prova compatibilidade com migrations locais |
| Objeto das 29 tabelas autorizadas | FAIL | 28 existem; `price_book_items` não existe | Objeto ausente ou contrato stale; não é tabela vazia |
| Censo de linhas, NULLs e tenant | PASS | Agregados calculados nas 28 tabelas existentes | PASS limitado às tabelas e predicados autorizados; stamps não provam owner |
| Órfãos e relações cross-tenant | PASS | Nenhum órfão ou conflito cross-tenant nos predicados medidos | PASS limitado; referências inbound e JSON opaco permanecem fora da prova |
| Duplicatas e conflitos físicos | BLOCKED | FKs redundantes; ações de delete divergentes; duplicatas lógicas e temporais candidatas | Chave/intervalo futuro ainda não aprovado; nenhum conflito de dados é afirmado |
| Referências inbound | BLOCKED | Sete tabelas externas às 29 foram identificadas pelo catálogo | Sem censo autorizado ou disposição completa; `crew_velocity` permanece não classificada |
| Inventário estático de scripts, SQL, mounts e consumidores | PASS | Readers/writers globais, caminhos de bypass, scripts, fallbacks e publishers foram identificados estaticamente no código | PASS de inventário estático; alcançabilidade viva não foi provada e contenção pertence a G4b-3/G4b-4 |
| Exports, feedback e issues | BLOCKED | Superfícies sem contrato final de owner/scope | Exigem disposição documental; eventual contenção pertence a unidade futura |
| `audit_logs` plural legado | PASS | Snapshot legado observado sem tenant scope | PASS apenas para inventário: preservar read-only, sem receber eventos novos nem servir reader global; não participa da classificação da tabela singular |
| Seeds/manifests por ID e hash | BLOCKED | Arquivos locais foram identificados; não existe manifesto G4b formal | Contagem ou semelhança não pode substituir ID+hash |
| Policies e grants | FAIL | Grants amplos e policies permissivas observados nas superfícies relevantes | Data API desligada reduz superfície HTTP, mas não prova isolamento |
| Papel efetivo da aplicação | BLOCKED | A sessão administrativa usa papel elevado com `BYPASSRLS` | Não prova principal web, memberships ou incapacidade de bypass |
| Owner e `BYPASSRLS` | BLOCKED | Tabelas alvo têm owner administrativo; caminhos `SET ROLE postgres`/cliente raw existem no código | Papel efetivo e alcançabilidade não provados; eventual remoção pertence a unidade posterior |
| Backup, PITR e restauração | BLOCKED | Backups físicos concluídos existem; PITR desligado; nenhum ensaio de restauração comprovado | Backup existente não prova recuperação restaurável |
| Shadow queries | BLOCKED | Nenhuma comparação shadow integral do grafo foi concluída | Obrigatória antes de qualquer transição |
| `EXPLAIN` sem mutação | BLOCKED | Planos selecionados de cost code, assembly e pricing foram observados | Conjunto de consultas proposto pelo desenho ainda não foi coberto integralmente |
| Dry-run de classificação | NOT EVALUATED | Somente uma disposição conservadora para STOP foi formulada | Não houve manifesto, transformação scratch/rollback-only, shadow integral ou snapshot MVCC único |

## 5. Resultado agregado e disposição conservadora

Das 29 tabelas autorizadas, 28 existem e 15 das existentes estavam vazias no momento observado. O censo-base confirmou os conjuntos já delimitados no desenho-mãe: assemblies, assembly items, cost codes, histórico de preço, cost types e units. Nenhum registro individual foi retornado ou registrado.

Achados confirmados:

- as assemblies examinadas não possuem código preenchido;
- nenhum `tenant_id` NULL foi observado nas colunas aplicáveis e predicados medidos do núcleo; nenhum órfão ou conflito cross-tenant foi observado nessa mesma cobertura;
- os assembly items examinados têm os dois campos diretos legados de origem de preço nulos; isso não prova ausência de preço, pois há histórico separado;
- a chave ativa medida no histórico de preço não apresentou excesso;
- divergências legadas em `cost_types` afetam taxabilidade e acompanhamento de tempo;
- a tabela plural legada `audit_logs` possui linhas sem tenant scope;
- existem grupos de FKs redundantes, incluindo grupos com ações de delete divergentes;
- `price_book_items` está ausente do catálogo vivo;
- `btree_gist`, necessário ao contrato temporal proposto, está ausente.

Observações que não constituem falha autônoma:

- excessos candidatos em uma chave lógica medida de `assembly_items` não são duplicatas confirmadas, pois a chave omitiu campos e o desenho não aprovou uma UNIQUE simples para a aresta;
- pares temporais candidatos incluem históricos inativos com intervalo aberto; zero excesso foi observado na chave ativa, portanto não são conflitos ativos atuais;
- `expiration_date IS NULL` representa intervalo aberto no desenho e não é defeito isolado;
- os campos legados de origem de preço nulos não provam que o preço inexista;
- audit legado sem tenant não viola por si só o futuro contrato da tabela singular;
- FKs redundantes não provam órfão, corrupção ou perda de integridade;
- tabela vazia não prova que router, script, grant ou writer esteja desmontado.

Disposição conservadora para este STOP, sem simulação de pós-estado:

- conjunto `platform_canonical`: **vazio**;
- assemblies, assembly items, cost codes, históricos, cost types e units existentes: **`unclassified`**;
- bundles e seus itens: estruturalmente ligados ao tenant na cobertura medida, mas dependentes de assemblies ainda `unclassified`;
- perfil, projetos, tenant e settings observados: estruturalmente consistentes nos predicados medidos, sem claim de proveniência;
- `audit_logs` plural legado: permanece snapshot read-only, sem eventos novos e sem reader global; não recebe a classificação futura da tabela singular;
- nenhum registro foi promovido a canonical ou tenant-owned;
- nenhuma operação de classificação, manifesto ou dado foi executada.

## 6. Condições de parada acionadas

Os fatos abaixo acionam diretamente o §12.2 do desenho-mãe:

| Condição do desenho | Fato observado |
|---|---|
| Referência inbound não classificada | Sete fontes externas identificadas; censo e disposição incompletos |
| Role/grants/policies sem prova suficiente | Grants amplos, policies permissivas e principal web não provado |
| Backup sem prova suficiente | PITR desligado e restauração não ensaiada |
| Arquivo, tabela ou decisão sem disposição | `price_book_items`, manifests e superfícies inbound sem resolução |

Além disso, a ausência de `btree_gist` aciona o STOP expresso do §6.4, e as divergências de lifecycle em `cost_types` exigem decisão antes de qualquer transformação.

Uma única condição seria suficiente. O conjunto observado impede qualquer transição defensável para Plan, implementação, G4b-2 ou operação de dados.

## 7. Resultado formal e claim estreito

> **Resultado formal: NO-GO para a transição G4b-1 Recover/Design → Plan, implementação ou G4b-2. O comportamento exigido é STOP.** A medição read-only confirmou bloqueios físicos, operacionais e de autoridade suficientes para impedir a próxima transição. As fingerprints foram calculadas apenas como baselines individuais e transitórias na sessão autorizada; não formam um snapshot atômico e não são persistidas. As contagens e negativas valem somente para os conjuntos efetivamente examinados. Nenhuma linha foi classificada, nenhum status de capacidade foi promovido e nenhuma autorização de plano, implementação ou operação de dados decorre deste resultado.

O único claim defensável é que o preflight identificou o estado e os bloqueios acima nas fontes, SHA, ambiente e momento declarados. Este registro não prova ownership, proveniência, canonicalidade, isolamento global, segurança global, restauração, prontidão operacional ou conclusão do programa G4b.

## 8. Alternativas e recomendação

| Alternativa | Disposição |
|---|---|
| **A — manter STOP e completar a reconciliação e as decisões permitidas em Recover/Design** | **Recomendada.** Preserva a fronteira read-only; a implementação de controles fica nas unidades futuras separadamente aprovadas |
| B — dividir o complemento em núcleo e referências inbound | Possível, mas cria gates adicionais; cada recorte precisaria de escopo, evidência e aprovação próprios |
| C — encerrar G4b-1 apenas com o catálogo atual | Rejeitada: deixaria migrations, inbound, papel efetivo, grants, recuperação e manifestos sem prova |

Para uma futura reavaliação, continuam necessários:

1. reconciliar migrations vivas e locais por identidade e hash;
2. obter autorização própria e concluir o censo/disposição de todas as referências inbound e JSON opaco;
3. reconciliar `price_book_items` como objeto ausente ou contrato stale;
4. comparar seeds e legado com manifesto por ID e hash, sem inferência por contagem;
5. provar o principal web efetivo, memberships, grants transitivos, policies e ausência de bypass;
6. comprovar restauração ensaiada e estratégia de rollback;
7. resolver disponibilidade de `btree_gist` e contratos de duplicidade/intervalos antes de migration;
8. decidir as divergências legadas de `cost_types` sem inventar valores;
9. completar o inventário e a disposição documental de readers, writers, scripts, auth fallback, exports, feedback, issues e audit; qualquer contenção fica para G4b-3/G4b-4 separadamente aprovadas;
10. concluir shadow queries e `EXPLAIN` do conjunto aprovado e repetir o preflight no exact SHA/ambiente.

Esta lista descreve evidência faltante; não autoriza sua obtenção ou implementação.

## 9. Matriz de impacto em capacidades

O §18 do desenho-mãe permanece a matriz governante. A tabela abaixo registra o delta de evidência do G4b-1 por capacidade e não altera classificação, validação operacional, segurança, confiança, verification state, lifecycle ou roadmap.

| ID | Arquivos/consumidores governantes | Evidência/delta G4b-1 | Disposição |
|---|---|---|---|
| C-01 | lead router/db | Principal e joins inventariados estaticamente | Papel efetivo bloqueado; nenhum claim funcional novo |
| C-02 | pipeline router/db, deal/lead joins | Dependência do principal restrito identificada | Papel/joins vivos não provados |
| C-09 | scope-source router/db, normalizer, DrawingReview | Writer e referências de assembly inventariados | Arestas ainda sem contrato G4b ativo |
| C-10 | scope/generation routers, engine, geo override | Consumidores globais de catálogo/preço identificados | Classificação e missing-price ainda bloqueados |
| C-11 | scope-review router/db, `convertToBundle` | Referências e snapshots inventariados | Nenhuma transformação ou prova comportamental |
| C-12 | completeness DB/engine, estimates/actuals | Dependência de snapshots registrada | Não avaliada comportamentalmente |
| C-13 | `scopeDraftItems`, scope DB/router/source | Referência inbound identificada pelo catálogo/código | Censo/disposição inbound incompletos |
| C-14 | estimate router, pipeline, engine, Calculator, export | Caminho crítico consome BOM e preço | Sem claim de estimate ou export funcional |
| C-15 | pricing/state/settings routers/db, adjustment DB | Histórico medido e `EXPLAIN` selecionado; contrato temporal ausente | Intervalos, tenant/unit e timezone bloqueados |
| C-16 | assembly router/db, catalog state, `server/db.ts` | Núcleo de catálogo medido; canonical vazio | Legado permanece `unclassified` |
| C-17 | bundle router/db, bundle items, Bundles/BundleCart | Bundles medidos e dependência de assemblies registrada | Ownership dos pais ainda bloqueia claim |
| C-18 | adjustment router/db/engine | Superfície e target de cost code inventariados | Contrato temporal/tenant não avaliado |
| C-19 | remodel router/db/engine, workflow | Consumer de assembly identificado | Reader visível ainda não construído/provado |
| C-23 | field-launch router/db, actuals, feedback | Tabelas e writers inventariados | Owner/lifecycle de feedback sem disposição final |
| C-24 | field-operations router/db, field tasks | Referências de catálogo inventariadas | Sem prova de writer same-tenant |
| C-30 | actuals router/db, field launch, actual tables | Duas superfícies de actuals inventariadas | Sem prova moderna/legada de referência |
| C-35 | analytics DB/engine, calibration, monitoring | Agregados/readers globais identificados | Isolamento de analytics não avaliado |
| C-36 | calibration router/db/engine/events | Tabelas e consumidores de preço identificados | Estado tenant/unit não classificado |
| C-37 | learning router/db, variance, metrics, suggestions | Superfícies legadas identificadas | Ownership/conflation ainda sem decisão final |
| C-38 | workflow visualization, assembly DB, Workflow | Enriquecimento por catálogo inventariado | Reader e regressão G4b não avaliados |
| P-01 | auth hooks, `main.tsx`, Supabase provider | Fallbacks/publishers identificados estaticamente | Alcançabilidade e IdentityBoundary efetiva bloqueadas |
| P-02 | tRPC core e routers afetados | Procedures e grants inventariados | Papel efetivo/RBAC ainda não provados |
| P-03 | schema, helpers, routers, cliente | Predicados medidos não mostraram conflito na cobertura | Inbound, contexto assinado e cache não provados |
| P-04 | settings, provisioning, timezone | Settings incluído no censo estrutural | CAS/timezone/readiness não avaliados |
| P-05 | ledgers futuros, `server/audit.ts`, audit plural | Audit plural inventariado como snapshot legado | Audit singular/scopes/atomicidade não implementados |
| P-06 | Drizzle, migrations, DB helpers, scripts | Schema, grants, roles e FKs medidos | Migration history, principal e bypass bloqueados |
| P-07 | geo override router/db/engine/schema | Arestas externas identificadas | Regras não foram escaneadas nesta autorização |
| P-08 | estimate retry, recovery DB, pipeline | Caminhos de retry inventariados | Referências G4b no recovery não avaliadas |
| P-09 | batches/events/decisions e manifesto futuros | Baselines individuais calculadas; nenhum root persistido | Sem snapshot atômico, manifesto ou provenance |
| P-10 | estimate/bundle export, serializer, artifacts | Exports e publishers inventariados | Owner/source/artifact/hash ainda bloqueados |
| Exclusões | C-05, C-08, C-22, C-29, C-31, C-32, C-33, C-34 | Nenhum contrato alterado pelo preflight | Permanecem fora do claim |

G3b, G4c, RLS global, B2 global, PR #9, merge, deploy e field release permanecem fora do claim e sem GO. G2 permanece fora deste claim; seu estado anterior não é alterado por G4b-1.

## 10. Riscos, não-claims e fronteira de publicação

- Data API desligada é contenção atual, não prova de RLS, grants ou caminhos diretos seguros.
- Uma sessão administrativa `postgres`/`BYPASSRLS` não prova o principal da aplicação.
- Backups existentes não provam restauração funcional.
- Zero finding em um predicado medido não prova ausência global do defeito.
- Nenhum hash, count ou stamp autoriza atribuição de owner.
- O catálogo canônico continua vazio.
- G4a continua superseded/NO-GO para implementação.
- G4b-2 e `writing-plans` não estão autorizados.
- PR #9, segurança global, produção e campo permanecem NO-GO.

Este arquivo é o único arquivo autorizado nesta rodada. Ele não deve ser acompanhado por alteração no desenho-mãe, `current-state.md`, correction log, plano, evidência de implementação ou código.

Um eventual commit documental exige gate separado: digest do arquivo, revisão independente, autorização humana específica para commit, revisão do exact SHA e novo GO humano. A reconciliação da linhagem do workflow, se posteriormente autorizada, deve ocorrer em commit separado.

## 11. Próximo gate humano

O presente artefato registra e materializa a decisão humana de aceitar o desenho G4b-1 com resultado formal NO-GO e comportamento STOP. Depois da verificação do conteúdo e digest deste arquivo, a única próxima ação possível é decidir se ele pode receber um commit local exclusivamente documental.

Essa decisão não autoriza resolver blockers, ampliar consultas, iniciar plano, usar `writing-plans`, executar RED/GREEN, alterar Supabase, abrir G4b-2, publicar branch, mudar PR #9, fazer merge, deploy ou liberar campo.
