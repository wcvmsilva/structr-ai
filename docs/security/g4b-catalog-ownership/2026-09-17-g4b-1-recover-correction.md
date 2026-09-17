# G4b-1 — registro corretivo append-only do Recover

## 1. Estado, sujeito e autoridade

- **Data da observação:** 2026-09-17, encerrada às 18:16 EDT.
- **Sujeito imutável:** commit documental `9ba85ed430ff57b87b520deb6a1d75e12183030c`, pai `8c2fdfb630933259998fa98616b2ae08e2ce32ad`.
- **Artefato preservado:** `docs/security/g4b-catalog-ownership/2026-09-17-g4b-1-recover-design.md`.
- **Ambiente observado:** Supabase `structr-ai`, project ref `xoqhxpqsfxpdiwyuvhdd`.
- **Autoridades:** `AGENTS.md`; desenho-mãe G4b em `8c2fdfb630933259998fa98616b2ae08e2ce32ad`; Controlled Engineering Workflow `f60cf9a56679d4d7083b2c11ac4e2727d53d84c3`; current state reconciliado `0db4499cc6be577d1c1bf408c624968a7c7f67e3`; Canonical Truth em `main` `8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf`.
- **Autorização humana:** criar somente este novo registro corretivo, sem commit, preservando `9ba85ed4…` imutável e sem código, banco, Supabase, migrations, plano, G4b-2, push, PR, merge, deploy ou campo.

**Resultado formal preservado:** **NO-GO** para a transição G4b-1 Recover/Design → Plan, implementação ou G4b-2. O comportamento exigido continua **STOP**.

Este registro é append-only. Ele não altera o texto ou a validade temporal do artefato aceito em `9ba85ed4…`. Acrescenta evidência obtida depois daquele commit e substitui somente a disposição de migration history, que passa de `BLOCKED` para **`FAIL`**.

## 2. Escopo e método do complemento

O humano autorizou o complemento somente leitura depois de ser informado de que a próxima etapa abrangeria as sete referências inbound externas e a reconciliação de migrations. Foram executadas apenas:

- leitura de catálogos PostgreSQL para colunas, FKs, RLS, policies, owners, índices e grants;
- consultas SQL somente agregadas às sete tabelas nomeadas neste registro;
- comparação por contagem e hash exato entre o journal Drizzle local e os ledgers vivos, sem retornar corpos SQL;
- leitura estática do schema, migrations, scripts, routers e consumers locais;
- revisão independente das interpretações de evidência e workflow.

Nenhuma linha, ID, tenant ID, nome, descrição, valor financeiro, conteúdo JSON, statement SQL ou dado pessoal foi retornado neste documento. Nenhuma escrita foi executada no banco durante o complemento. No repositório, a única escrita autorizada desta rodada é este registro corretivo, que permanece sem commit; nenhum arquivo rastreado nem o commit `9ba85ed4…` foi alterado. Fingerprints de dados calculadas durante a sessão não são persistidas aqui.

As contagens das sete tabelas foram reconfirmadas por uma única instrução SQL, portanto compartilham o snapshot MVCC dessa instrução. As fingerprints calculadas anteriormente permanecem baselines individuais e não são promovidas a fingerprint atômica do grafo.

## 3. Correção formal: migration history

### 3.1 Linhagem local declarada

O repositório contém cinco migrations PostgreSQL no journal Drizzle:

- `0000_strong_jean_grey`;
- `0001_phase1_identity_tenant`;
- `0002_phase2_previsit_estimate`;
- `0003_phase3_field_actuals`;
- `0004_phase4_learning_multitenant`.

Cada arquivo possui identidade local por `created_at` e SHA-256 dos bytes SQL. A linhagem histórica MySQL, `sync-new-columns.sql`, `db:push` e scripts operacionais são mecanismos separados e não podem ser equiparados a essas cinco entradas por ordem, data aproximada, contagem ou efeito semelhante.

### 3.2 Ledgers vivos observados

| Evidência agregada | Resultado |
|---|---:|
| Linhas em `drizzle.__drizzle_migrations` | 0 |
| Pairs locais esperados | 5 |
| Correspondências exatas `created_at + SQL hash` no ledger Drizzle vivo | 0 |
| Pairs locais ausentes no ledger Drizzle vivo | 5 |
| Versões distintas em `supabase_migrations.schema_migrations` | 59 |
| Statements registrados pelo Supabase | 59 |
| Migrations Supabase sem nome | 57 |
| Hashes distintos entre os 59 statements | 52 |
| Versões duplicadas | 0 |
| Entradas com rollback registrado | 0 |
| Entradas sem idempotency key | 59 |
| SQLs locais com correspondência exata entre os statements Supabase | 0 de 5 |

### 3.3 Disposição

**Migration history = FAIL.** O ledger Drizzle vivo não contém a linhagem local declarada, e o ledger Supabase não fornece correspondência exata substituta para nenhum dos cinco SQLs locais. Isso prova não equivalência de histórico e aciona a condição de parada do desenho-mãe.

Não prova que os cinco SQLs jamais tenham sido executados, que seus efeitos físicos estejam ausentes, que as 59 migrations sejam inválidas ou que o schema vivo esteja incorreto. `db:push`, SQL editor, DDL ad hoc ou outro mecanismo podem ter produzido efeitos semelhantes sem identidade reconciliável. Por isso, nenhuma migration pode ser reaplicada, preenchida retrospectivamente ou tratada como segura a partir deste resultado.

## 4. Censo das sete referências inbound

| Tabela | Linhas | Disposição de dados nesta observação |
|---|---:|---|
| `assembly_performance_metrics` | 0 | Sem remediação de linha; superfície física permanece |
| `calibration_suggestions` | 0 | Sem remediação de linha; contrato de owner/source permanece aberto |
| `estimate_variance_events` | 0 | Sem snapshot vivo a classificar; writer/semântica permanecem abertos |
| `geographic_overrides` | 0 | Sem linha viva; schema, grants e writer permanecem no inventário |
| `scope_checklist_patterns` | 0 | Sem pattern vivo; JSON/tenant/cost-code continuam contrato futuro |
| `scope_draft_items` | 0 | Sem item vivo; cadeia draft→project→tenant continua obrigatória |
| `crew_velocity` | 16 | Legacy `unclassified`; quarentena documental, sem owner inferido |

Nas 16 linhas de `crew_velocity` foram observados, somente como contagens:

- zero `cost_code_id` NULL;
- zero cost code órfão;
- zero `unit_id` NULL;
- zero unit órfã;
- zero cost code pai com tenant stamp NULL;
- zero excesso de payload integral idêntico, como controle exploratório e não como UNIQUE normativa.

Esses resultados provam apenas integridade referencial atual dos dois vínculos. `crew_velocity` não possui coluna de tenant ou projeto nem vínculo ou cadeia de autoridade para source; o campo textual `source` não prova proveniência. O stamp presente nos cost codes pais não atribui owner às 16 linhas e não prova homogeneidade, canonicalidade, autorização do consumer ou isolamento. Todas permanecem `legacy/unclassified`, destinadas à quarentena até decisão humana e manifesto próprios.

## 5. Drift físico e segurança da superfície inbound

### 5.1 Schema vivo versus repositório

O banco vivo possui duas FKs validadas em `crew_velocity`, para cost code e unit. `drizzle/schema.ts` declara as duas colunas como NOT NULL, mas não declara essas FKs. A integridade viva observada é favorável, porém a diferença é **drift de schema** e impede que o schema local seja tratado como autoridade exata para uma migration futura.

As seis tabelas vazias não são superfícies inertes: readers, writers, grants, policies e scripts podem preenchê-las depois. Vazio reduz a remediação de linhas naquele snapshot; não prova segurança, desmontagem ou ausência de consumidor dinâmico.

### 5.2 RLS, policies, owner e grants

| Controle agregado | Resultado |
|---|---:|
| Tabelas com RLS desligada | 6 de 7 |
| Tabela com RLS ligada | `crew_velocity` |
| Policies em `crew_velocity` | 8 |
| Policies incondicionais em `crew_velocity` | 6 |
| Tabelas com `FORCE RLS` | 0 |
| Tabelas com owner `postgres` | 7 |
| Privilégios de tabela de `anon` por tabela | 7 |
| Privilégios de tabela de `authenticated` por tabela | 7 |
| Grants web de escrita combinados por tabela | 12 |

**Gate de contenção/least privilege = FAIL.** RLS desligada em seis tabelas, policies majoritariamente incondicionais na sétima e grants web amplos impedem claim tenant-safe. Owner administrativo e `FORCE RLS` desligado também são incompatíveis com a arquitetura final pretendida.

Isso não prova que `anon` ou `authenticated` sejam owners ou ignorem RLS, nem prova que a Data API esteja ligada, que a superfície seja alcançável externamente, que tenha ocorrido exploração ou incidente. A Data API observada desligada continua apenas contenção HTTP atual; não corrige grants, policies ou caminhos diretos.

## 6. Contratos estáticos que permanecem abertos

- `calibration_suggestions`, `assembly_performance_metrics` e `estimate_variance_events` estão vazias, mas o learning layer ainda apresenta conflação estática entre IDs de cost code, assembly, estimate e estimate item. Zero linhas não corrige o writer.
- `scope_draft_items` exige autoridade derivada de draft→project→tenant e revalidação de catálogo; draft aprovado deve preservar snapshot, sem lookup global posterior.
- `geographic_overrides` exige tenant compatível com zone e referências de catálogo classificadas; NULL nunca significa canonical.
- `scope_checklist_patterns` exige tenant compatível com cost code e com todos os projetos referidos em `evidence`; nenhum JSON bruto foi lido porque a tabela estava vazia.
- `price_book_items` continua ausente do schema e do catálogo vivo. Scripts ainda a referenciam, enquanto o runtime mistura objeto nested, UUID escalar e alias de pricing. A ausência exige reconciliação de contrato, não criação automática da tabela.

Esses contratos são entradas para Recover/Design posterior. Este registro não autoriza corrigir ou conter qualquer um deles.

## 7. Gate formal corrigido

| Gate | Estado | Fundamento |
|---|---|---|
| Coleta read-only do complemento | PASS | Somente catálogo, agregados e leitura estática; zero write |
| Censo das sete referências inbound | PASS | Contagens coerentes em uma instrução; sete tabelas cobertas |
| Integridade referencial de `crew_velocity` | PASS | Zero NULL/órfão nas duas referências medidas |
| Autoridade/ownership de `crew_velocity` | FAIL | 16 linhas sem tenant/project/source authority |
| Paridade schema vivo ↔ repositório | FAIL | Duas FKs vivas ausentes do schema local |
| Contenção RLS/grants da superfície inbound | FAIL | Seis RLS off; policies incondicionais e grants web amplos |
| Migration history | FAIL | Ledger Drizzle vazio e zero correspondência exata no ledger Supabase |
| Transição G4b-1 → Plan/implementação/G4b-2 | **NO-GO** | Múltiplas condições de parada confirmadas |

STOP permanece o comportamento exigido. O censo fecha uma lacuna de evidência, mas não transforma os dados em classificados, não fecha G4b-1 e não autoriza a próxima fase.

## 8. Delta da matriz de capacidades

O §18 do desenho-mãe e a matriz do artefato em `9ba85ed4…` continuam governantes. Este complemento acrescenta somente o delta abaixo, sem promover nenhum status.

| Capacidade | Delta observado | Disposição |
|---|---|---|
| C-13 Scope model and structure | `scope_draft_items` vazio; cadeia de autoridade permanece estrutural | Sem claim comportamental |
| C-15 Pricing engine and price book | `crew_velocity` aponta para catálogo sem owner próprio; `price_book_items` ausente | Contratos continuam bloqueados |
| C-16 Catalog and assembly library | Cost codes pais têm stamp, mas isso não classifica velocity | Canonical vazio; legado unclassified |
| C-36 Calibration | Tabelas de calibration/metrics vazias; contracts de owner/source abertos | Nenhuma prontidão funcional |
| C-37 Learning layer | Conflação estática de IDs permanece, apesar de tabelas vazias | Exige unidade própria antes de ativação |
| P-03 Tenancy and tenant scoping | Uma tabela com linhas não possui autoridade tenant; seis superfícies têm RLS off | Isolamento não demonstrado |
| P-06 Data access layer | Drift de FKs, ledgers divergentes, grants/RLS inseguros | Migration/schema gate FAIL |
| P-09 Evidence and provenance substrate | Ledgers não reconciliados e velocity sem source authority | Provenance não demonstrada |

G2 mantém seu estado anterior. G3b, G4c, RLS global, B2 global, PR #9, merge, deploy, produção e campo continuam fora deste claim e sem GO.

## 9. Não-claims e próxima transição

Este registro não afirma que:

- as migrations locais nunca foram executadas ou que o schema vivo esteja semanticamente errado;
- as 59 migrations Supabase sejam inválidas;
- as linhas de `crew_velocity` pertençam ao tenant stamp dos cost codes;
- zero órfão prove isolamento ou semântica correta;
- tabelas vazias estejam seguras ou desmontadas;
- grants amplos sejam exploráveis pelo exterior com a Data API desligada;
- algum capability, G4b-1, PR #9 ou campo esteja pronto.

Este é o único arquivo autorizado nesta rodada. Ele permanece sem commit. O próximo gate é revisão independente do conteúdo e digest, seguida de decisão humana separada sobre um commit local exclusivamente documental. Nenhuma revisão ou aceite deste registro autoriza Plan, `writing-plans`, código, migration, banco, Supabase, G4b-2, push, PR, merge, deploy ou campo.
