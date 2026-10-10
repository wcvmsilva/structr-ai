# Calculator: SQL fechado e executor transacional — 10 de outubro de 2026

## Escopo e autoridade

Incremento T1/T3/T4 do [plano aprovado](../superpowers/plans/2026-10-10-adr003-calculator.md), a partir de `5f5c9bbb375179ca689a6c8e31b1c9d4c18cb6cf` (PR #47). O usuário autorizou fechar o SQL/manifesto e implementar o executor com autenticação e auditoria transacional. A aprovação exige confirmação específica antes de credenciais ou ampliação de acesso hospedado. Nenhuma dessas mudanças externas integra esta entrega.

O [incremento anterior](calculator-local-proofs-2026-10-10.md) concluiu T2 e o experimento prévio de permissões; seus 113 casos novos não são recontados aqui. Este pacote implementa o serviço e suas rotinas privadas. A integração dos endpoints/tela existentes permanece em T5/T6; o uso real depende também de homologação e aceite de aprovação, versionamento, exportação e recuperação.

## Comportamento implementado

- Migration `0020_closed_financial_calculator_boundary` cria três tabelas privadas (`principal_bindings`, `calculator_fixtures`, `calculator_requests`), relações, constraints, índices e policies nominais. O principal permanece `NOLOGIN`, sem senha, binding ou fixture; owners não têm login, herança, ownership de tabelas ou BYPASSRLS. O login tem apenas quatro assinaturas EXECUTE; não recebe SELECT/DML bruto nem entrada na Data API.
- Migration `0021_financial_calculator_lifecycle` substitui as quatro rotinas fechadas por contexto, snapshot, criação e recuperação autorizados. As fontes são classificadas por fixture auditada e verificadas sob locks/SERIALIZABLE. A ordenação começa pelo projeto. Preço/BOM/autoridade concorrentes produzem snapshot coerente ou recusa/retry integral.
- `services/financial-executor` é um pacote independente, sem importar pool, ambiente ou frontend do web. Verifica assinatura assimétrica e issuer/audience/expiração/identidade/sessão de um bearer humano; compara o sujeito com o binding derivado de `session_user`, ator e organização protegidos. Recusa cookies, autoridade no corpo, JWT inadequado e configuração incompatível.
- Uma transação Drizzle SERIALIZABLE real contém aquisição, motor canônico, comparação de hashes, criação, auditoria e readback. A referência opaca de transação não permite trocar conexão ou comando. O adapter `withAuditLog` valida a intenção, a linha física completa de 54 colunas, o audit completo e uma segunda leitura persistida antes do commit. A assinatura legada de auditoria continua compatível, mas não é usada por esse fluxo.
- O recibo imutável registra a criação original. Replay e recovery reautorizam antes de procurar o pedido e não recalculam preços para reconhecer um commit anterior. A resposta pública separa confirmação original e estado atual do draft; não expõe binding, audit ou snapshot interno. Um resultado de transporte incerto não dispara nova criação automática.
- A mesma requisição tem orçamento finito para corpo, autenticação, conexão e SQL; conexões concorrentes ficam limitadas a duas por instância. O cancelamento usa a conexão efetiva do pedido, sem derrubar a outra operação. A dependência `postgres` está fixada na versão já resolvida `3.4.8`, pois o adaptador de cancelamento depende de seu comportamento inspecionado. As provas de cancelamento não garantem rollback de um COMMIT cuja resposta foi perdida.

Não há nova exceção F2/F5. Os helpers TypeScript são parte efetiva da validação e da transação, não uma chamada decorativa em torno de uma RPC HTTP. F1 continua exigido nos endpoints tRPC; este serviço separado autentica diretamente sua única entrada HTTP. Nenhum novo endpoint web ou flag de produto foi aberto.

## Manifesto e instalação

O [manifesto](../security/financial-executor/permission-manifest.json) contém definições e hashes observados, ACLs por coluna, relações/policies/triggers/rotinas, dependências e estados antes/depois. Schema/relations refletem os objetos estruturais de 0020; 0021 altera rotinas, não cria tabelas ou novas permissões de dados. A instalação é transacional e recusa drift em vez de o corrigir silenciosamente.

A base física aplica migrations 0000–0019 e contenção local explícita: a tentativa sem contenção é recusada por 0015 e verificada sem instalação parcial. Portanto, esta evidência não afirma que o histórico legado aberto instala diretamente. IF-1/SWR-1 entram com seus companions de fechamento. As oito tabelas compartilhadas de SWR não recebem RLS novo.

PostgreSQL soma privilégios; não existe um DENY por papel para neutralizar o TEMP concedido a PUBLIC. A migration 0020 exige ausência dos privilégios ambientais CREATE/TEMP e recusa sua presença; ela não revoga silenciosamente o TEMP de PUBLIC. A fixture descartável faz essa contenção explicitamente. A eventual contenção hospedada deve constar do futuro pedido de confirmação com seu impacto ambiental. As provas locais não autorizam revogar permissões de outros consumidores num ambiente real.

## Evidências e revisão

As suítes novas verificam comportamento, valores, commits, linhas/audits completos e recusas. Testes físicos usam PostgreSQL 17.11 descartável, sockets locais e clientes com proveniência conferida; a limpeza do cluster é verificada. Nenhum resultado de teste ignorado conta como aprovação física.

REDs efetivos registrados nesta rodada incluem o instalador/rotinas ausentes ou fechados, aquisição inválida, conteúdo de recibo divergente, JSON financeiro decimal, tentativa com conexão privilegiada, conflitos de pedido, visibilidade RLS insuficiente, adulteração/supressão/duplicação de audit e operação ainda ativa no banco depois de uma resposta de timeout. As correções foram reavaliadas por revisor separado do autor.

Os casos A/B/C verificam custo/preço em centavos, incluindo margem zero como draft. As provas de integração usam JWT ES256 realmente assinado, objetos HTTP Node com transporte em memória e duas conexões PostgreSQL reais para concorrência, recuperação e expiração durante espera. No caso de resposta perdida, o corpo é descartado deliberadamente após um commit confirmado e uma nova sessão recupera o recibo; não foi simulada queda de socket durante COMMIT. A compatibilidade positiva IF-1/SWR-1 após 0020/21 é uma prova SQL com claims sintéticas; não é uma nova prova criptográfica/PostgREST nem uma execução hospedada.

Identidades congeladas:

| Artefato | SHA-256 |
| --- | --- |
| Migration 0020 | `e4023b3ca7ceace78acd1b367f3d14d68fb94d6270fffced51e7f8931b44eba0` |
| Migration 0021 | `6c947ba1f081f692f211e76dd15ee11bceb169f1dc371adaf59cf6024dab552a` |
| Manifesto de permissões | `6f7411cf091e254711e80862b442ae8c80b51647da9b76df91bfde9dd501b677` |
| Catálogo final, 1.144 objetos | `e2523193143830601ddb537d70a224567aa755241f0673fe00cb2d6ddefa79d1` |

O revisor independente recalculou todos os hashes de objetos e o agregado final; as 13 mudanças de funções em 0021 (quatro entradas e nove helpers privados) correspondem ao manifesto. A prova final do SQL aprovou **82/82** casos: 25 T1 + 57 T4, zero ignorados, com seis clusters descartáveis removidos. O pacote final dos adapters aprovou **71/71**: 20 DB + 2 coexistência + 45 recibos + 4 regressões legadas de auditoria. Os quatro legados não são testes novos.

Tipos gerais e build web passaram. O build web mantém os avisos existentes de variáveis opcionais de analytics e tamanho de chunks. As verificações históricas foram reconciliadas com o inventário exato: 22 migrations, 47 policies (29 Calculator) e os owners/tabelas privados adicionais; as recusas e comparações de segurança foram preservadas. A publicação exige o hook obrigatório de tipos e suíte geral sem bypass, além do CI. Os resultados gerais e a identidade da fonte publicada ficam registrados na descrição da PR e nos checks do GitHub; testes ignorados permanecem explicitamente separados de passes.

## Reprodução local

Sem variáveis de conexão PostgreSQL externas herdadas e com PG17.11 instalado:

```sh
APP_PRINCIPAL_LAB=1 FINANCIAL_CALCULATOR_BOUNDARY_PHYSICAL=1 FINANCIAL_CALCULATOR_LIFECYCLE_PHYSICAL=1 FINANCIAL_EXECUTOR_TX_PHYSICAL=1 pnpm exec vitest run server/financial-calculator-boundary-physical.test.ts server/financial-calculator-db.test.ts server/financial-calculator-coexistence.test.ts server/financial-executor-transaction.test.ts server/financial-calculator-integration.test.ts
pnpm check
pnpm test
pnpm build:vercel
pnpm check:financial-executor
pnpm build:financial-executor
```

O build próprio verifica o grafo realmente emitido e padrões de credenciais; CI verifica os dois pacotes. A saída gerada do executor fica em seu diretório `.vercel`, ignorado pelo Git, sem implantação automática.

## Próxima etapa

Integrar a variante Calculator nos endpoints existentes e na tela (T5/T6), com confirmação dos hashes, isolamento por sessão/par e recuperação por request ID após reload. Depois apresentar o pacote exato de homologação para confirmação específica: destino/versão/conexão, projeto isolado do executor, credencial restrita, binding do operador, fixture sintética auditada, permissões, janela de prova e retirada. Não usar esta entrega para criar credenciais, ampliar acessos ou liberar projetos reais automaticamente.

## Fechamento local do executor

O revisor independente aprovou o SQL, o adapter de auditoria/recibo e o runtime final. Foram aprovados **22/22 testes físicos de transação**, **6/6 de integração**, **98/98 de autenticação/configuração**, **74/74 de handler**, **11/11 de transporte HTTP** e **10/10 de isolamento de build**, além dos 82 SQL e 67 novos adapters/recibos/coexistência acima. A reconciliação de schema acrescenta uma comparação exata das 29 policies Calculator; a suíte focal correspondente passou **37/37**, incluindo seus três casos físicos. Total novo distinto deste incremento: **371** (239 padrão + 132 físicos), sem recontar os 81 T2 da PR #47 nem as regressões legadas. O pacote independente foi compilado, verificado em TypeScript e importado sem inicializar configuração ou banco; saída final de 913.726 bytes.

O overload novo de `server/audit.ts` carrega seu adapter apenas quando recebe a transação nominal Calculator. Isso preserva as ferramentas administrativas legadas, cujo pacote deliberadamente mínimo não inclui o executor, sem ampliar seus arquivos confiáveis ou enfraquecer os testes de procedência.

Quando o servidor confirma cancelamento/rollback, os testes verificam imediatamente a ausência de atividade transacional e de locks no PID afetado, preservando a outra conexão. Falha do canal de cancelamento ou erro de transporte principal sem confirmação coloca o slot em quarentena até reiniciar a instância; não há reposição automática que possa acumular conexões incertas. A reserva de limpeza usa o mesmo deadline total de 30 segundos, sem somar novos prazos. Essa redução deliberada de disponibilidade não prova o resultado de um COMMIT incerto.

Novos helpers principais: `createExecutorAuthenticator`, `createExecutorTransactionRunner`, `callCalculatorRoutine`, `loadCalculatorSnapshot`, `executeFinancialCalculator`, `validateCalculatorReceipt` e o overload transacional de `withAuditLog`. O cálculo puro continua nos motores T2 existentes. A única entrada nova é `POST /api/execute`, autenticada pelo executor; nenhum endpoint tRPC foi adicionado ou aberto. As três novas tabelas são privadas. Todas as criações desse fluxo têm auditoria transacional obrigatória; a auditoria legada não foi promovida a essa garantia.

## Arquivos do incremento

### Criados

- `docs/engineering/calculator-executor-implementation-2026-10-10.md`
- `docs/security/financial-executor/permission-manifest.json`
- `drizzle/0020_closed_financial_calculator_boundary.sql`
- `drizzle/0021_financial_calculator_lifecycle.sql`
- `scripts/build-financial-executor.mjs`
- `server/financial-calculator-audit.ts`
- `server/financial-calculator-boundary-physical.test.ts`
- `server/financial-calculator-coexistence.test.ts`
- `server/financial-calculator-db.test.ts`
- `server/financial-calculator-db.ts`
- `server/financial-calculator-integration.test.ts`
- `server/financial-calculator-receipt.test.ts`
- `server/financial-calculator-receipt.ts`
- `server/financial-executor-auth.test.ts`
- `server/financial-executor-build.test.ts`
- `server/financial-executor-handler.test.ts`
- `server/financial-executor-http.test.ts`
- `server/financial-executor-transaction.test.ts`
- `server/test-support/financial-calculator-boundary.ts`
- `server/test-support/financial-calculator-boundary/catalog.sql`
- `server/test-support/financial-calculator-boundary/foundation-probe.sql`
- `server/test-support/financial-calculator-boundary/legacy-public-containment.sql`
- `server/test-support/financial-executor-auth.ts`
- `services/financial-executor/.gitignore`
- `services/financial-executor/README.md`
- `services/financial-executor/api/execute.ts`
- `services/financial-executor/src/auth.ts`
- `services/financial-executor/src/config.ts`
- `services/financial-executor/src/handler.ts`
- `services/financial-executor/src/http.ts`
- `services/financial-executor/src/index.ts`
- `services/financial-executor/src/transaction.ts`
- `services/financial-executor/tsconfig.json`
- `services/financial-executor/vercel.json`
- `shared/financial-executor-contract.ts`
- `shared/financial-executor-error.ts`
- `shared/financial-executor-json.ts`

### Modificados

- `.github/workflows/ci.yml`
- `README.md`
- `docs/engineering/current-state.md`
- `docs/security/financial-executor/inventory-2026-10-10.md`
- `docs/superpowers/plans/2026-10-10-adr003-calculator.md`
- `drizzle/meta/_journal.json`
- `drizzle/relations.ts`
- `drizzle/schema.ts`
- `package.json`
- `pnpm-lock.yaml`
- `server/audit.ts`
- `server/historical-estimate-schema-security.test.ts`
- `server/migration-history-reconcile.test.ts`
- `server/test-support/app-principal-postgres.ts`
- `shared/domain/taxonomy.ts`
- `shared/financial-calculator-engine.ts`
- `todo.md`
