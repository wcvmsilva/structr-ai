# Calculator ADR-003 — plano de implementação

> Executar por tarefas com RED/GREEN, revisão independente e evidência por commit. Aprovação de arquitetura já recebida; criação de credenciais ou ampliação de acesso exige confirmação específica posterior.

**Objetivo:** calcular e formar um draft pelo par projeto/intake conhecido, com fontes protegidas, valores determinísticos, transação/auditoria integrais e recuperação após resposta perdida.
**Arquitetura:** web protegido sem SQL → executor TypeScript isolado → quatro rotinas nominais EXECUTE-only; Drizzle SERIALIZABLE real; motores existentes.
**Stack:** Node/TypeScript, jose, Zod, Drizzle/postgres, PostgreSQL 17.11 observado, Vitest, React/tRPC; sem nova biblioteca financeira.
**Spec:** [ADR-003 aceita](../../adr/ADR-003-pilot-financial-executor.md), [inventário de permissões e contratos](../../security/financial-executor/inventory-2026-10-10.md), [AGENTS](../../../AGENTS.md).
**Base do desenho:** `dc9dfee61d22687000d0e71bc080ee9f3b0feebd`. **Estado em 10 de outubro:** desenho revisado; [incremento local](../../engineering/calculator-local-proofs-2026-10-10.md) na base `5a5557c7` concluiu o experimento prévio de T1 (32 casos físicos, migrations 0000–0014) e T2 (81 novos casos; 346 regressões focais). T1 manifesto/SQL de produção, coexistência 0015–0019 e T3–T8 permanecem pendentes. Os caminhos dessas tarefas ainda são entregáveis pretendidos; nada foi ativado na homologação por este incremento.

## Restrições globais e fronteiras de revisão

- F1/F2/F5 literais: procedimentos protegidos, overload transacional real de `withAuditLog`, `db.transaction()` único por operação. Nenhuma nova exceção IF-1/SWR; nenhuma transação que envolva HTTP fingindo compartilhar conexão.
- S2–S6: Zod estrito nas duas entradas; normalização canônica antes de rejeitar valores fora do recorte; enums em taxonomy; math/constants existentes. Preservar quantidade inteira 1–100, 1–25 IDs únicos. Sem preço/ator/tenant/policy/modificador autoritativos no payload público.
- Fixtures locais isoladas não são dados reais. Não provisionar usuários Auth, credenciais Vercel/SQL, grants/policies cloud nem reativar A1/A2/B1 nesta fase. Flags de produto continuam fechadas até revisão, confirmação específica e provas hospedadas.
- Operador fixo + tenant fixo não substituem autorização atual. Comparar JWT verificado com binding derivado de session_user real a cada tentativa; pool não troca vínculo por GUC. Recuperação também reautoriza.
- Primeiro contexto financeiro: fixture auditada direct/standard/charleston_sc, dimensões unitárias explícitas, geo/política completos. Não abrir outros canais/dimensões como fallback. O financeiro não depende de implementar o ramo Scope; seleção de assemblies é explícita e a área do intake não vira quantidade automaticamente.
- Preservar valores e decisões históricas, paths diretos legados, policies e guards atuais. Nenhuma abertura de mutations genéricas, CSV, printable, change order ou execução de obra.

Cinco modos de falha dirigem a revisão:

| Foco | Falha concreta | Prova exigida |
| --- | --- | --- |
| Autoridade | JWT válido de outro operador, binding/policy/GUC forjado, PUBLIC/inheritance abre caminho indireto | T1/T3/T7: login efetivo + tokens assinados reais e ACLs hostis; negação direta e via web. |
| Atomicidade | Trigger deferido roda sem direitos; audit/recibo confirma estado inválido | T1/T4: COMMIT PG17 como login, flush nominal, readback, supressão de audit e rollback integral. |
| Dinheiro | Fonte fora do tenant, preço duplo/vencido, dimensão silenciosa, data muda no meio | T2/T5: snapshot congelado, paridade A/B/C, erro discriminante e zero write em conflito. |
| Concorrência/replay | Segunda conexão, retry parcial, request duplicado ou autoridade retirada | T4/T5/T8: transação única, duas conexões reais, resposta perdida e um único draft/audit. |
| UI/entrega | Cache de outra sessão, margem impede draft, reload repete write | T6/T8: sessão/par alterados, C salvo com aviso, lookup nominal sem resubmissão automática. |

## Interfaces a congelar antes de dividir autores

Novos tipos em `shared/financial-calculator-engine.ts`, operações canônicas em `shared/domain/taxonomy.ts` e normalização em `shared/domain/normalization.ts`. Versão nominal `calculator-v1`. Números financeiros retornados usam a representação exata adotada pelos adaptadores existentes, com conversão minor units explícita; nunca aceitar NaN/Infinity/coerção bool→number.

```ts
type CalculatorPair = { projectId: string; intakeFormId: string };
type CalculatorSelection = { assemblyId: string; quantity: number };
// Zod .strict() em cada nível. Contexto permitido é resolvido no servidor.
type CalculateCommand = CalculatorPair & {
  contractVersion: "calculator-v1";
  operation: "calculator.calculate";
  assemblies: CalculatorSelection[];
};
type CreateCalculatorCommand = Omit<CalculateCommand, "operation"> & {
  operation: "calculator.create";
  requestId: string;
  expectedSourceHash: string;
  expectedCalculationHash: string;
};
type RecoverCalculatorCommand = CalculatorPair & {
  contractVersion: "calculator-v1";
  operation: "calculator.recover";
  requestId: string;
};
```

Sem nome/notes editáveis no novo ramo inicial: nome determinístico gerado com o relógio protegido; recursos legados não desaparecem do modo direto. `assembly.list` recebe a variante `{mode:"calculator", projectId, intakeFormId}` estrita no modo novo; nenhum filtro legado nesse ramo. Resposta contém contexto, opções mínimas e disponibilidade financeira, sem totais de cliente. UI não consulta categorias ou listas globais.

Snapshot interno contém binding/actor/tenant protegidos, par/cliente, data UTC + data de avaliação/timezone, fonte classificada, IDs/revisões de assembly/BOM/preço/tipos/unidades, configuração completa geo/comercial/política, ordem de linhas e versão de contrato/motor. `sourceHash` exclui campos voláteis sem efeito financeiro (como instante de simulação) e inclui data de avaliação, valores e todas as fontes relevantes; `calculationHash` inclui seleções ordenadas, linhas/valores e contexto, não o nome/timestamp gerado. Mudança de dia/política/preço relevante invalida a confirmação. `capturedAt` e nome do draft são gerados no save e registrados separadamente. Hash usa canonicalização explícita e estrita, validada com vetores fixos, nunca JSON de chave arbitrariamente ordenada.

Saída pública da simulação: versão, par, fontes/valores permitidos ao operador, hashes de confirmação, warnings e provenance sem informação de outros tenants. O snapshot interno não sai do executor por conveniência. Receipt público expõe IDs/hashes/estado necessários; receipt interno completo, audit e binding permanecem no serviço/banco. Nenhum token de download/autoridade nasce dos hashes.

```ts
// Os nomes definem responsabilidade; os tipos exatos são implementados em T2.
buildCalculatorResult(snapshot: CalculatorSnapshot, command: CalculateCommand): Promise<CalculatorResult>;
withCalculatorTransaction<T>(identity: VerifiedOperator, fn: (tx: FinancialTx) => Promise<T>): Promise<T>;
loadCalculatorSnapshot(tx: FinancialTx, command: CalculateCommand): Promise<CalculatorSnapshot>;
createCalculatorDraft(tx: FinancialTx, command: CreateCalculatorCommand, result: CalculatorResult): Promise<CalculatorReceipt>;
recoverCalculatorResult(tx: FinancialTx, command: RecoverCalculatorCommand): Promise<CalculatorRecovery>;
// Overload nominal, coexistindo com a assinatura legada; tx é Drizzle real.
withAuditLog(tx: FinancialTx, intent: CalculatorAuditIntent, lifecycle: () => Promise<CalculatorReceipt>): Promise<CalculatorReceipt>;
```

`withAuditLog` compara intent protegido com receipt/audit/readback completos e lança antes do commit. SQL lifecycle grava audit obrigatório `estimate_draft.create`; não recebe action/table/user livres. Mutation de configuração/fixture usa procedimento administrativo separado auditado. Recibo imutável: requestId + comando canônico + binding/operação/tenant + draft + hashes + row snapshot + audit completo. Recovery distingue `not_found`, `confirmed` e `unavailable`; não revela existência quando autorização falha. Repetir criação confirmada verifica comando/recibo e retorna criação original e estado atual separados, mesmo que preços tenham mudado depois. Payload conflitante nunca cria outro draft.

## T1 — provar privilégios e triggers antes de congelar o SQL

**Dono:** backend; revisor de segurança separado. **Consome:** inventário, migrations 0007–0019, harness descartável `server/test-support/adr002-postgrest.ts`. **Produz:** prova do caminho mínimo, manifesto exato e schema/migration fechados por padrão.

**Arquivos:** criar `server/financial-calculator-physical.test.ts`, `server/test-support/financial-calculator.ts`, `docs/security/financial-executor/permission-manifest.json`; depois atualizar `drizzle/schema.ts`, `drizzle/relations.ts` e criar migration seguinte à 0019, conferindo a numeração antes de escrever. Não reutilizar permissões globais do harness como evidência.

1. RED físico primeiro: instalar baseline em cluster descartável PG17.11; conectar cliente novo como login restrito por socket local sem senha reutilizável. Registrar `session_user`, versão e ACLs. Função definer mínima que insere draft deixa `a1_draft_final` para COMMIT: esperar falha de privilégio e zero draft confirmado. Em PG18 a expectativa de papel muda; não contar ambiente errado como prova PG17.
2. REDs adicionais: grant/policy ausente, restrictive policy ocultando contradição, coluna extra não inventariada, primitive/PUBLIC/NULL-proacl/role herdável/SET-role/definer desconhecido. Expectativa: `42501` ou recusa nominal e ausência de instalação parcial, nunca sucesso sem evidência. GUC falsa não muda identidade.
3. GREEN mínimo: schemas/roles sem credenciais externas, tabelas privadas de binding/fixture/requests, grants de coluna enumerados, policies nominais e rotinas vazias fechadas até sua implementação. Para a prova de INSERT, `SET CONSTRAINTS public.a1_draft_final DEFERRED`, writes, `... IMMEDIATE` ainda sob owner, depois readback. Testar COMMIT real, modo inicial IMMEDIATE, duas chamadas/tx e savepoint rollback. Não mudar guards compartilhados.
4. Congelar tabela/coluna/FK/index/constraint/trigger/function/ACL/policy/hash no manifesto. Novas policies apenas em relações já RLS; não ligar RLS nas oito relações SWR. Owners sem ownership/BYPASS/inheritance; login sem raw SELECT/DML. Principais privados não são expostos na Data API.
5. Rodar `pnpm exec vitest run server/financial-calculator-physical.test.ts`; RED deve ser assertion de comportamento ou erro de privilégio esperado, não falha por binário ausente; GREEN sem casos físicos ignorados. Registrar separado da suíte padrão.

**Critério:** receipt só poderá ser emitido após todos os checks pendentes da operação; versão/role/visibilidade reais comprovadas. `feat(calculator): define closed financial database boundary` somente após GREEN/revisão. Instalação cloud não faz parte desta tarefa.

## T2 — schemas, snapshots e adaptação pura do motor

**Dono:** motor/contrato, sem editar SQL do outro autor. **Consome:** fontes do inventário e contrato acima. **Produz:** schemas/tipos/resultados canônicos consumidos por T3–T6.

**Arquivos:** criar `shared/financial-calculator-engine.ts`, `server/financial-calculator-engine.test.ts`; atualizar taxonomy, normalization e `shared/estimate-engine.ts` para relógio explícito opcional que preserve callers legados. Reusar math/Profit Shield; não alterar fórmula geral por efeito colateral.

1. RED: fixture A espera 4000/10000 minor e 60%; B 6000/9000 e GP sem arredondamento indevido; C 1/1 e 0%. Rejeitar bool, Infinity, decimal quantity, zero, 26 seleções, IDs duplicados, tenant/preço extra; preservar ordem e provenance de preço/data.
2. RED: fonte ausente/duplicada, tipo/unidade inativos/contraditórios, tenant nulo/outro, override não previsto, dia/timezone desconhecidos, dimensões não suportadas, campo autoritativo enviado pelo cliente. Cada um tem erro discriminante e não chama motor com default silencioso.
3. GREEN: `buildCalculatorResult` adapta somente snapshot protegido, usa `calculateMultipleAssemblies` e `transformBatchToEstimateDraft`, validando números antes de safeParseFloat. Hash determinístico ignora somente volatilidade descrita, nunca preço/política; relógio explícito gera nome estável no save.
4. `pnpm exec vitest run server/financial-calculator-engine.test.ts` — confirmar RED por valores, depois ≥20 casos comportamentais verdes. Vetores de hash/rounding independentes do próprio código testado. Commit `feat(calculator): adapt protected snapshots to canonical engines`.

## T3 — executor isolado, JWT e transação real

**Dono:** backend. **Consome:** tipos T2, SQL/manifesto T1. **Produz:** fronteira HTTP privada de implantação e helper de transação, ainda não implantados.

**Arquivos:** criar `services/financial-executor/src/{config,auth,transaction,handler}.ts`, `services/financial-executor/vercel.json`, `server/financial-executor-auth.test.ts`, `server/financial-executor-transaction.test.ts`; alterar build/package scripts somente se necessário para empacotamento separado. Extrair verificação pura de `server/_core/auth/supabase-jwt.ts` sem alterar defaults legados e sem importar ENV web no serviço.

1. RED criptográfico: JWT realmente assinado válido do operador, assinatura/issuer/audience/exp/alg errados, headers múltiplos, sem session_id/sub UUID, anonymous/service_role/outro operador. Novo executor aceita apenas bearer único, papel authenticated, sessão humana e algoritmos assimétricos aprovados (ES256 observado deve ser reconferido); sem cookie/HS256/segredo de assinatura/fallback.
2. RED tx: registrar backend PID/tx ID/isolation por etapa; tentativa com outro handle, READ COMMITTED, JWT expirado durante espera, binding alterado/desativado, segunda conexão/HTTP e retry parcial recusados. O lock/recheck de autoridade acontece também no persist/recover. READ COMMITTED não é promovido tardiamente após queries.
3. GREEN: configuração exclusiva rejeita secrets web/service role, valida destino DB/TLS com hostname/chain; pool limitado, connect/statement/lock/transaction timeouts explícitos e abaixo do deadline HTTP. Deadline total inicial máximo 30s, lock 3s e statement 10s, com até três tentativas dentro do mesmo deadline; ajustar só com prova de capacidade. Retry completo apenas 40001/40P01; audit e erro indeterminado de transporte não viram retry cego. Após bloqueios, revalidar expiração antes do write e antes de retornar, sem prometer revogação imediata por logout.
4. Contrato de conexão: SQL dedicado direto ou pooler somente se provar **session_user real correto e mesma conexão durante o tx**; nenhuma escolha por conveniência que torne todos os usuários `postgres`. Não transportar bearer para SQL/logs; binding protegido é fixo.
5. `pnpm exec vitest run server/financial-executor-auth.test.ts server/financial-executor-transaction.test.ts` + casos físicos relevantes. Build do executor deve provar ausência de bundle web e credenciais embutidas. Commit `feat(calculator): isolate verified operator executor`.

## T4 — aquisição protegida, lifecycle e auditoria atômicos

**Dono:** backend/audit, único autor SQL. **Consome:** T1–T3. **Produz:** as quatro rotinas completas (context, snapshot, create, recover), adapters de aquisição no mesmo tx, recibo final e adapter real F2.

**Arquivos:** criar `server/financial-calculator-db.ts`, `server/financial-calculator-db.test.ts`; atualizar `server/audit.ts`, `server/transactional-audit.test.ts`, migration/manifesto T1. Schema/relations antes dos helpers, conforme AGENTS.

**T4a — leituras reais, antes do writer:** implementar `calculator_context_v1`, `calculator_snapshot_v1` e `loadCalculatorSnapshot(tx,command)`, substituindo as rotinas fechadas de T1. O SQL resolve binding pelo session_user, reautoriza criação financeira/par e só lê fontes classificadas pela fixture; TS valida a projeção fechada e produz hashes sem descartar preço/data/proveniência. Context retorna somente opções mínimas e nenhum custo a caller sem autoridade financeira.

REDs físicos próprios, usando registros reais no cluster descartável: par/tenant divergentes; cliente ou fonte inativa; assembly sem BOM; código com tenant nulo/outro; unidade/tipo incompatíveis ou inativos; preço ausente, duplicado, expirado, ainda não efetivo ou em unidade errada; timezone/data protegida ausentes; fixture/dimensão desconhecidas. Comparar erro discriminante e ausência de writes. Os snapshots sintéticos de T2 não substituem estes testes. Dois clientes concorrentes alterando preço/BOM/autoridade devem produzir resultado serializável coerente ou retry/recusa, nunca mistura de fontes.

Congelar no manifesto a ordem de aquisição comum das quatro rotinas: resolver vínculo fixo sem aceitar identidade do payload; bloquear projeto primeiro como A1; depois intake, identidade/tenant/cliente, RBAC, binding/fixture, settings/geo e catálogo por categoria/ID estáveis, revalidando o vínculo lido antes. Definir explicitamente locks de pai e proteção serializável para inserções/ausências e empates de preço. Nenhuma chamada a `getAssemblyById`/pool global ou HTTP integra essa aquisição. Snapshot, relógio e provenance são retornados pelo handle recebido; testes conferem PID/tx ID e mudança de data. Atualizar grants de colunas e dependências transitivas a partir do SQL efetivo, sem conceder o catálogo geral ao login.

Rodar `pnpm exec vitest run server/financial-calculator-db.test.ts server/financial-calculator-physical.test.ts`; registrar RED/GREEN da aquisição separadamente. Commit `feat(calculator): acquire authorized source snapshots` após revisão. Só então implementar T4b abaixo.

**T4b — formação, receipt e replay:**

1. RED: falha/supressão/alteração/duplicação de audit, readback divergente ou erro após INSERT deve deixar zero novos draft/request/audit. Assert quantidade e conteúdo de rows, não presença de helper. Before=null para formação; IDs/tenant/ator/action/table/row completa conferidos, timestamps servidor.
2. RED concorrente: dois pedidos idênticos simultâneos produzem um draft e um audit; mesmo requestId com seleções/hashes/par diferente recusa. Lock de binding/par em ordem fixa antes de fontes; serialização/unique conflict converge apenas por replay reautorizado. Retirada de membership/tenant/operador durante retry ou antes de recover bloqueia. Receipt não pode ser rebindado/deletado/alterado.
3. GREEN: SQL revalida vínculo/operação/par/fixture, força constraints da operação e faz write/readback/audit/receipt completos. Overload `withAuditLog(tx,intent,lifecycle)` executa e valida recibo; callback não recebe poder de inventar ação/audit. Validação TS falha antes do commit. Assinatura background legada permanece compatível, jamais usada por este caminho.
4. Replay consulta intent persistido e readback atual antes de qualquer nova leitura de preço para criar; preço mudou depois não impede reconhecer commit anterior. Draft aprovado/suplantado retorna estado atual sem reescrever receipt original. Recovery not_found não significa que um pedido concorrente não vá confirmar; UI mantém intenção e permite reconciliação posterior, não gera UUID automaticamente.
5. `pnpm exec vitest run server/financial-calculator-db.test.ts server/transactional-audit.test.ts server/financial-calculator-physical.test.ts`; ≥20 DB comportamentais mais físicos, preservando os quatro testes de audit existentes. Commit `feat(calculator): persist audited idempotent draft receipts`.

## T5 — integrar os endpoints existentes e cálculo confirmado

**Dono:** integrador backend. **Consome:** contratos congelados T2/T4. **Produz:** transporte web sem DB e entradas reais do executor.

**Arquivos:** modificar `server/assembly-router.ts`, `server/estimate-router.ts`, `server/_core/trpc.ts`, configuração nominal de ambiente; criar `server/financial-calculator-client.ts`, `server/financial-calculator-router.test.ts`. Acrescentar somente a consulta nova `estimate.getCalculatorResult` ao router existente, sem novo router de domínio paralelo.

1. RED: gate fechado recusa todas as quatro entradas; gate habilitado aceita apenas variante Calculator contextual. Inputs legados/globais de assembly.list, chamadas diretas não autenticadas e campos extras recusam. Funções diretas SQL antigas nunca chamadas no modo Data API; falha de executor não faz fallback.
2. RED: simulate e save usam o mesmo adaptador; mudar preço/BOM/política/dia entre eles produz conflito, zero DML e exige novo cálculo. Mensagens não incluem SQL, tokens ou detalhes de outro tenant. Novo create responde apenas após COMMIT, não após callback anterior ao commit.
3. GREEN: rotas protegidas com Zod, bearer encaminhado só ao origin fixo HTTPS do executor, sem redirects arbitrários, tenant/actor do browser ignorados por recusa. No executor, snapshot→TS→create ocorre no mesmo tx. Leitura de opções possui autoridade financeira e fixture própria, sem depender de SWR para concedê-la.
4. `pnpm exec vitest run server/financial-calculator-router.test.ts` — ≥15 casos; complementar testes existentes dos routers modificados. Commit `feat(calculator): route contextual calculation through executor`.

## T6 — conectar a jornada visual e recuperação

**Dono:** UI, após T2/T5 envelopes estáveis. **Consome:** endpoints reais; auth/session cache existente. **Produz:** Calculator contextual e fluxo de confirmação recuperável.

**Arquivos:** modificar `client/src/pages/Calculator.tsx`, `client/src/hooks/useBundleCalculator.ts` e ponto existente de navegação do workspace; criar `client/src/lib/calculator-intent.ts`, `server/financial-calculator-ui.test.ts`. Rota `/calculator` já lazy-loaded: não criar outra página/sidebar nem duplicar navegação. Modo legado preservado separadamente.

1. RED: URL sem par ou com par divergente não consulta catálogo/global projects; troca de sessão/par durante requests ignora resposta antiga e limpa caches/intenção. Formar C deve funcionar com aviso de margem, sem prometer aprovação. Área não vira quantidade.
2. RED: click duplo, resposta perdida e reload mantêm mesmo requestId e comando; usuário autenticado consulta resultado existente, nenhum create automático. Intenção local não contém bearer/custos brutos/segredos e tem limite de tamanho e expiração de 24h; após expirar, oferecer consulta manual pelo requestId/par anotados sem repetir writer. Logout limpa a intenção; não transferir para outro subject.
3. GREEN: opção/contexto protegido → seleção → cálculo → confirmação → save; stale exige recalcular/confirmar. Remover timer de navegação que sobrevive à sessão; navegar somente para draft recebido/confirmado no contexto atual. Guardar hashes/seleções/IDs mínimos para reconciliação, não tratar localStorage como autoridade.
4. `pnpm exec vitest run server/financial-calculator-ui.test.ts`; confirmar testes em navegador local com dados sintéticos A/B/C e rede interrompida. Commit `feat(calculator): connect contextual draft and recovery journey`.

## T7 — prova integrada e revisão independente

**Dono:** QA independente, integrador corrige. **Arquivos:** criar `server/financial-calculator-integration.test.ts`, registro `docs/engineering/calculator-local-proof-2026-10-10.md` (usar data real se posterior), atualizar manifesto e estado da rodada.

1. Pelo menos cinco integrações distintas: A/B/C exatos; perda de resposta/reload; fonte stale; isolamento/retirada; audit+constraint rollback. Somar ≥60 testes novos únicos (20 engine, 20 DB, 15 router, 5 integração) conforme S1, sem duplicar a contagem de execuções físicas/default/UI. Tests existentes intactos; F3/F4.
2. Executar suite física com login de verdade e defaults hostis, testes concorrentes e regressões IF-1/SWR. Incluir prova negativa de schema exposto, role SET, columns/grants e mutations ainda fechadas. Para paridade de piso, construir localmente o contexto completo e usar motor A1: A passa; B/C falham pelo piso, não por contexto ausente. Isso ainda não abre aprovação hospedada.
3. `pnpm check`, `pnpm test`, `pnpm build:vercel` e build isolado do executor; registrar SHA, contagens/pass/skip, outputs e limites. Pular físico por ambiente ausente é pendência, não aprovação. Sem novo teste de implementação para documento estático.
4. Revisor não autor verifica diff, grants/transitividade/RLS/trigger/recibo, binding/JWT, math/provenance, interface/session/recovery e fechamento do ambiente. Corrigir e reexecutar apenas verificações afetadas antes da suíte requerida final. Manter risco de confiança no executor explícito.

**Critério:** código local verificado, gates fechados, pacote exato disponível. Não declarar sprint/piloto completo por número de testes. Commit de evidência não inventa resultado futuro.

## T8 — confirmação específica e homologação controlada

**Dependências:** T7 + revisão independente concluídos. Esta tarefa não está autorizada a criar credenciais/ampliar acesso sem a confirmação requerida pelo usuário.

1. Preparar dois itens concretos de confirmação, apresentáveis juntos: projeto executor/ambiente/destino da única credencial/operador/tenant/custo/rotação; e SQL assinado por hash com rotinas, colunas, policies, binding, fixture, janela e retirada auditada. Reconciliar IDs reais de O, sem promover role ou reativar A1/A2/B1 implicitamente. Nenhum segredo no chat/repo. Se não houver capacidade no plano existente, apresentar custo antes de contratação.
2. Após confirmação, implementar por fases: criar projeto fechado e credential nominal protegida, verificar separação Preview/Production e TLS; instalar SQL fechado após preflight completo; conferir ACLs/policies/role efetivas. Abrir somente a janela e quatro operações aprovadas. Dados sintéticos preparados por script administrativo separado, com before/after/audit e hashes, sem reaproveitar seed genérico.
3. Registrar deployment/commit exatos e executar UI O + chamadas diretas negativas com identidades aprovadas. Provar A/B/C, nova autorização após retirada, stale, audit, replay, resposta perdida/reload, pool/concurrency e guard de tenant. Credencial do executor nunca entra no web; erro não chama fallback. Retirada usa desativação do binding/revogação nominal e encerramento de sessões/rotação conforme pacote, não apenas flag web.
4. Readback independente compara inventário antes/depois, dados/O/issuer/histórico preservados e somente mudanças previstas auditadas. Falha mantém acesso fechado, preserva evidência e usa rollback/retirada testados. Abertura permanente só após resultado e aceite específicos.

## Sequência e divisão sem duplicação

T1 e T2 podem avançar em paralelo após leitura do inventário; T3 depende do contrato de T2 e do teste de identidade/tx de T1. T4 depende T1–T3; T5 depende T4; UI pode preparar testes após T2, integrando após T5. Um único autor de SQL/grants e um integrador de routers; revisor de segurança independente não aprova o próprio código. O time externo já forneceu referências financeiras, contraprovas e recovery; esses insumos alimentam T2/T6/T7, sem repetir a implementação nem atribuir a eles testes não executados.

**Próxima ação executável:** completar T1 com SQL fechado/manifesto exato, REDs de instalação atômica sob drift hostil e coexistência 0015–0019; então T3/T4. O experimento prévio e o adaptador T2 já passaram pela revisão independente. O [contrato implementado](../../engineering/calculator-local-proofs-2026-10-10.md) explicita WebCrypto assíncrono, limites de valor/quantidade, normalização de waste e elegibilidade de linhas ainda dependente da integração. Não há dependência de nova decisão de arquitetura. Ao chegar a T8, apresentar os dois itens específicos com artefatos revisados, não pedir aprovação genérica antecipada.

## Dependências para uso em campo depois do Calculator

Esta fatia termina com cálculo/draft/recovery nominal comprovados, não com sistema liberado. O próximo plano mantém as mesmas fronteiras para revisão→aprovação→revogação→versão; depois entrega JSON/PDF com bytes persistidos, hashes e requestId duráveis, sem as duas transações independentes atuais. Provar entrega antes da revogação/sucessão e recusa posterior, preservar história, validar recuperação de conta/ambiente e obter aceite completo. Não chamar uma aprovação financeira de autorização para executar obra ou pagar custos.
