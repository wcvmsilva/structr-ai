# Calculator — provas locais de permissões, transações e cálculo

**Data:** 10 de outubro de 2026. **Base:** `5a5557c7a85f439f4b38f763ec12aaf92eba5a82`.
**Estado:** provas focais e revisão independente concluídas; verificação geral e publicação atribuídas ao commit no PR.

O responsável autorizou as provas locais de permissões/transações e testes do cálculo em paralelo, preservando credenciais e acessos hospedados. Esta fatia executa a prova física prévia de T1 e o adaptador puro de T2 do [plano aprovado](../superpowers/plans/2026-10-10-adr003-calculator.md). Não implementa o executor HTTP/JWT, a aquisição SQL de fontes, o writer financeiro ou a jornada hospedada.

## Escopo e revisão

| Frente | Responsável | Entrega e limite |
| --- | --- | --- |
| Prova física T1 | `calculator_local_db_proof` | PostgreSQL 17 descartável, conexão LOGIN real, guards das migrations existentes, privilégio/RLS, COMMIT e rollback. Utilitários/SQL exclusivos de teste; não são uma migration de produção ou prova de grants hospedados. |
| Adaptador T2 | `calculator_pure_adapter` | Schemas estritos, snapshot e cálculo puros, fontes/proveniência, hashes e relógio explícito; motores existentes preservados. Não adquire fontes do banco nem decide aprovação. |
| Revisão independente | `calculator_proof_review` | Revisão dos artefatos, RED/GREEN e limites; autor distinto dos dois implementadores. |
| Integração | Codex coordenador | Verificações gerais, evidência, documentação, publicação e preservação do escopo autorizado. |

O laboratório recebe somente configuração local explícita, cria seu próprio diretório e socket e recusa URLs/configuração de banco herdadas. Os papéis descartáveis não usam senhas reutilizáveis. Nenhuma conta Auth, credencial cloud, política ou grant da homologação é criado por estes testes. Falha de infraestrutura não conta como RED de comportamento.

## Impacto de capacidades

| ID | Impacto | Comportamento e evidência exigida | Disposição |
| --- | --- | --- | --- |
| C-14 Estimating | Direto, limitado | Adaptador futuro do Calculator e relógio explícito opcional no transformador existente; valores/linhas/draft e compatibilidade dos callers legados. | Classificação canônica inalterada; nenhum novo endpoint conectado. |
| C-15 Pricing engine and price book | Indireto | Reutilização das fórmulas canônicas com fontes validadas; casos A/B/C, tipos/unidades/preços/dimensões inválidos e limites numéricos. | Fórmulas e aquisição do catálogo não são substituídas; não atesta preço operacional. |
| P-06 Data access layer | Prova local | COMMIT real como login restrito, transação única e rollback sob guards reais. | Somente teste descartável; schema/migrations de produção inalterados. |
| P-09 Evidence and provenance substrate | Dependência delimitada | IDs/revisões de fontes, data de avaliação e hashes determinísticos do adaptador. | Não implementa todo o substrate nem promove sua classificação. |

As duas visões do registro canônico e seus agregados permanecem inalterados: provas locais de um módulo ainda não conectado não estabelecem validação operacional do domínio inteiro. Aprovação, versões, exportação e recuperação continuam em tarefas posteriores.

## Evidência de execução

### Banco descartável — concluído

A [prova física detalhada](../security/financial-executor/local-db-proof-2026-10-10.md), registrada em `5b41a4f7`, passou **32 casos distintos, zero falhas e zero casos ignorados** no PostgreSQL 17.11. O RED de COMMIT teve uma caracterização aprovada e uma falha esperada (`42501` após o retorno da função); o RED de visibilidade teve duas falhas esperadas quando policies escondiam evidência. O GREEN comprova a correção mínima de teste e a recusa desses desvios no laboratório. Diretório próprio removido após cada rodada.

O revisor independente inspecionou código, logs RED/GREEN, privilégios efetivos, conexão LOGIN e leitura do observador, sem achado bloqueante neste recorte. As injeções de PUBLIC, coluna, herança, SET-role, default ACL e definer desconhecido são **caracterizações de ampliação de acesso**, não provas de que um instalador de produção detecta/rejeita esses desvios. Somente migrations 0000–0014 foram exercitadas; coexistência com 0015–0019 continua pendente.

### Adaptador puro — concluído

Implementação `e1c23b25`: **81 testes novos** e **346 regressões existentes** passaram na rodada focal de seis arquivos, **427/427**, zero falhas. Somados aos 32 casos físicos distintos, são **113 casos novos**; os 346 antigos e as reexecuções não entram nessa soma. Logs locais: `/private/tmp/calculator-t2-{red,boundaries-red,number-red,regressions}-20261010.log`. O RED inicial registrou 71 falhas/1 sucesso; a revisão acrescentou quatro REDs de borda e três numéricos. Casos adicionais que já passaram caracterizam limites existentes; não são apresentados como falhas reproduzidas.

A/B/C preservam respectivamente custo/preço em centavos `4000/10000`, `6000/9000`, `1/1`. A razão exata da margem fica separada do percentual arredondado de exibição. B/C podem formar payload de draft com aviso; isso não os aprova. Os testes conferem ordem, provenance, referências ativas do mesmo tenant, preços únicos na unidade/data correta, intervalo `[effectiveDate, expirationDate)`, política completa e recusa de modificadores não suportados. Falta de fonte nunca vira um preço ou multiplicador padrão.

Correções decorrentes da revisão: aviso individual usa o piso decimal protegido, eliminando o erro de `0.28 * 100` no limite exato de 28%; quantidade `0.1 × 3` torna-se `0.3` sem recalcular totais; valores que poderiam perder centavos mesmo com inteiro numericamente seguro são recusados pelo limite suportado. O schema de snapshot inspeciona descritores antes da leitura e não executa accessors. Fórmulas gerais dos motores existentes não foram alteradas.

### Contrato congelado para os próximos autores

- `buildCalculatorResult` é **assíncrona apenas por WebCrypto** e recebe snapshot/comando; não lê DB, ambiente ou relógio atual. Os schemas públicos Calculate/Create/Recover são estritos. O tipo de snapshot não comprova sozinho autenticação ou autorização: T3/T4 ainda precisam produzir e validar suas fontes protegidas.
- Contexto inicial: `direct/standard/charleston_sc`, USD, `America/New_York`, dimensões unitárias explícitas, manifesto de fixture auditada e contexto completo de política/geo. O campo BOM `wasteFactor="1"` é multiplicador normalizado, **não** o percentual bruto da tabela; T4 deve transformar somente fonte previamente validada. Overrides, componentes opcionais, base quantity ou dimensões fora desse recorte são recusados.
- Limites deste adaptador: 1–25 seleções distintas, quantidades públicas inteiras 1–100; quantidade BOM positiva até 1 milhão com até seis decimais; valores monetários até USD 1 bilhão por taxa, extensão e total agregado. Snapshot: até 25 assemblies/1.000 componentes cada, 1.000 códigos/tipos/unidades e 5.000 registros de preço. Esses limites de snapshot **não prometem elegibilidade A1**; aquisição/writer terão de compatibilizar seus limites de linhas, payload e aprovação antes da integração.
- `sourceHash` inclui todo snapshot normalizado menos `capturedAt`; `calculationHash` acrescenta seleção ordenada, valores e linhas exatas. Dia, política, preço, revisão e proveniência invalidam a confirmação. Nome/timestamp de apresentação não participam do hash de cálculo. Hash não é assinatura nem autorização.
- `transformBatchToEstimateDraft` mantém os quatro argumentos existentes e aceita um quinto relógio explícito opcional. Callers antigos permanecem compatíveis; o novo ramo usa o instante protegido tanto no nome quanto em `metadata.generatedAt`.

O revisor independente leu o código final e os RED/GREEN e não encontrou bloqueador remanescente neste recorte. O último ajuste foi a recusa explícita de `undefined` no conversor de centavos para satisfazer os tipos opcionais legados; a suíte geral da publicação exercita essa fonte exata. **`pnpm check` final passou com zero erros, exit 0**, após corrigir os dois campos opcionais e executar com permissão de escrita do cache local. **`pnpm build:vercel` passou, exit 0**; permanecem os avisos existentes de analytics opcional ausente e chunks grandes. Logs: `/private/tmp/calculator-integration-typecheck-final-20261010.log` e `/private/tmp/calculator-integration-build-20261010.log`. Os checks obrigatórios de publicação registram a suíte geral final no PR, sem atribuir números antigos ao código novo.

### Identidade dos artefatos de cálculo

| Artefato | SHA-256 |
| --- | --- |
| `shared/financial-calculator-engine.ts` | `b52410fb0b5b87a22ea78866107054e6e50a20f6becdcce2b9f9ec2f156c26fb` |
| `shared/domain/taxonomy.ts` | `6283b858a4eae1c25edc20b7c472a15f50f7786ee2e4ccbdb1fd9a00c1eb7e97` |
| `shared/domain/normalization.ts` | `4546fdeee02de33f9dc97818a5d47b81be8d370fc00e47ae8795add0c12cfb99` |
| `shared/estimate-engine.ts` | `f439ccfc150a332c81ba24ef8cfa1d042799885fe671d1083af207710c930df5` |
| `server/financial-calculator-engine.test.ts` | `aa249a5f4f9eff019b05b7f92770125e64f614c54184d507c8228d982cbaa51f` |
| `server/test-support/calculator-engine-fixture.ts` | `d52c67f25f69c4c65ba6157317ed3d27dc2dc236d97c96684271d620d27db067` |

### Relatório de conclusão desta fatia

Novos arquivos: engine puro, teste de engine, fixture de engine, teste físico, helper/duas fixtures SQL físicas e os dois registros de evidência. Modificados: taxonomy, normalization, relógio opcional do estimate engine e ponteiros/plano de estado. **Zero tabelas, helpers DB ou endpoints novos de produção.** F1/F2/F5 de runtime permanecem inalteradas: não há mutation de negócio nova; as funções SQL são exclusivamente instrumentos descartáveis de teste. F3: assertions de comportamento; F4: regressões focais aprovadas e suíte geral exigida no hook/CI. Não declara sprint completo nem satisfaz por contagem isolada as quotas separadas de router/DB/integração de S1.

Os 32 casos físicos usam opt-in e ficam ignorados na suíte padrão. Seu GREEN separado está acima; outros testes ignorados na suíte geral continuam sem ser considerados aprovados. TypeScript, suíte geral e CI/integração devem ser conferidos pelo commit do PR e pelos resultados de publicação, não por totais de rodadas anteriores.

## Gates que permanecem

A prova física é pré-requisito de T1, não conclui o SQL fechado e o manifesto de permissões de produção. Ainda faltam esse fechamento, executor e binding JWT, aquisição protegida de fontes, lifecycle/auditoria/recibos, endpoints/UI e provas hospedadas. Antes de criar credenciais ou ampliar acesso, o coordenador apresentará os artefatos concretos revisados para confirmação específica. Uso em campo exige aceite completo.
