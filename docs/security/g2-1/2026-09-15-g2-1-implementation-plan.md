<!-- Incorporação histórica G2-1: corpo original preservado, salvo links de anexos externos. -->
> **Registro histórico do desenho de 2026-09-15.** O estado “proposto/não executado” abaixo descreve a rodada de desenho. A autorização posterior de implementação e os resultados pertencem ao [registro de execução](../g2-1-override-crud-evidence.md); os checkboxes do plano continuam históricos. Esta incorporação não reaprova política, não amplia o escopo e não transfere GO entre SHAs.
>
> Fonte externa aprovada: `/private/tmp/structr-g2-design-20260915/2026-09-15-g2-1-implementation-plan.md`. SHA-256 original: `0677e9a62cf080b0b057859d57f70894ebb7c57ac342c3ecc265622e1bf3b414`. Alterações desta cópia: este enquadramento temporal e resolução dos links de anexos externos, quando existentes. Os anexos continuam locais, fora do repositório; sua disponibilidade depende da preservação do dossiê local.

# G2-1 Override CRUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aplicar tenant estrito ao ciclo de criação, consulta e edição das regras, preservando o ciclo próprio e a atomicidade dos writes.

**Architecture:** Evoluir cinco helpers/rotas existentes. Privados locais recebem o mesmo executor tx, com predicates estritos, whitelists, RETURNING e readback. Dois callers de criação propagam owner; listagem, logs, seed completo e integrações posteriores permanecem fora do claim.

**Tech Stack:** TypeScript, tRPC, Zod, Drizzle/PostgreSQL, Vitest; dependências já existentes. Sem instalação.

**Spec:** [2026-09-15-g2-1-design.md](2026-09-15-g2-1-design.md), junto da [decisão humana](2026-09-15-g2-policy-decision.md). Ler ambos. Este plano é **proposto, não executado nem autorizado para execução nesta rodada**.

## Global Constraints

- Base exata `bf9fbb6bd917ceb207d7bf01ad77704e48ca8b2a`; recuperação nova antes de executar. Não usar main local ou origin/main como remoto atualizado.
- GIT_OPTIONAL_LOCKS=0 em consultas Git; nenhum fetch/pull, reset ou recuperação automática.
- Cinco CRUD completos + duas adaptações de callers; seis rotas tocadas e três arquivos de produção, conforme a spec.
- Tenant NULL/B é indisponível na fronteira corrigida; nenhum backfill/DELETE/reatribuição de legado ou mudança global de TENANT_STRICT.
- Nenhuma alteração de schema, engine, catálogos, audit.ts, middleware/guards globais, UI, pipeline, packages, hooks/CI.
- TDD: escrever prova antes do patch, executar RED válido, implementar o mínimo, GREEN e regressão. Não trocar falha de schema/assinatura por evidência tenant.
- Auditoria aguardada pós-commit, com limites NULL/throw explícitos; sem claim de atomicidade dado+audit.
- Sem Supabase, DB operacional, seed operacional, migração ou credenciais. PG de teste só em cluster/socket privados criados pelo harness.
- Publicação, merge, mudança da PR #9, automação e Phase 3 não pertencem à execução proposta.

## Entregas e arquivos

1. Uma unidade de implementação revisável reúne o ciclo CRUD, todos os callers de create e suas provas; não publicar intermediários que quebrem create→get.
2. Produção: `server/geo-override-db.ts`, `server/geo-override-router.ts`, `server/seed.ts`.
3. Provas novas: `server/tenant-g2-1-override-crud.test.ts`, `server/tenant-g2-1-override-crud-postgres.test.ts`, `server/tenant-g2-1-seed-context.test.ts`, `server/test-support/g2-1-postgres.ts`.
4. Relatórios/saídas e configs temporárias no diretório externo da execução; evidência documental separada depois do commit de código/provas. Não incluir resultados previstos como realizados.

O mínimo de testes da regra de sprint não exige inventar um novo engine ou asserts de existência. A matriz abaixo prevê **84 casos comportamentais** (34 normais e 50 PG), a confirmar pela coleta real. O engine não muda; sua cobertura existente participa da regressão. Se a coleta diferir, explicar IDs/consolidações sem mascarar omissões por um total verde.

## Task 1: Preparar a unidade isolada e demonstrar o problema com a mesma API

**Files:** as quatro provas novas acima; produção permanece na base até um RED verificável.

**Interfaces:** consumir `geoOverrideRouter.createCaller(ctx)` da base e o schema real. O harness `startG2PointPostgres(factory)` produz `{directory, observer, connect, stop}`; cada conexão produz `{sql, db, pid, queries, endCalls, ended}`. Nenhum helper de negócio é mockado na prova PG.

- [ ] **1. Recuperar autorização, estado e árvore antes de criar o workspace.** Depois de autorização de execução, conferir que a base existe e está intacta. Destinos propostos: `/private/tmp/structr-g2-1-20260915`, branch `codex/g2-1-override-crud-20260915`, e baseline `/private/tmp/structr-g2-1-baseline-20260915` no SHA base. Se existirem, inspecionar e reutilizar somente quando correspondem ao escopo; nunca sobrescrever.
- [ ] **2. Ler e vincular spec/plano/decisão pelos hashes externos revisados.** Manter esses documentos fora da árvore até a etapa documental da Task 3; assim o commit e a revisão de código/provas não têm documentos pendentes. Não copiar o registro canônico ou o workflow de outras linhagens nem comprometer docs em G3a-3.
- [ ] **3. Criar o harness PG da unidade com as garantias do existente.** Derivar de `server/test-support/g3a3-postgres.ts` na base, mantendo o original intacto. Substituições explícitas: tipos/functions `G3a3`→`G2Point`; flag `G3A3_POSTGRES`→`G2_1_POSTGRES`; identidade/prefixos `g3a3`→`g2point`. Manter binário `/usr/local/opt/postgresql@17/bin`, socket privado, TCP desligado, allowlist de ambiente, verificação de PID/data-dir e cleanup. Trocar import/tabela fixture para geographicOverrides; remover a tabela sentinela price_book_items. Não modificar tableDDL para enfraquecer UUID/default/PK/NOT NULL. Comentários devem declarar FKs externos/RLS omitidos e claim somente das regras.

Trecho de fixture a produzir no novo harness, após abrir observer:

```ts
import { geographicOverrides } from '../../drizzle/schema';
// tableDDL é copiado integralmente do harness da base: tipos/defaults/PK/NOT NULL.
await observer.sql.unsafe(tableDDL(geographicOverrides));
// Não criar sentinelas de preços, seed, migrações, RLS ou FKs externos fictícios.
```

- [ ] **4. Criar fixtures/API compartilhadas na prova PG.** IDs concretos:

```ts
const A = 'a2000000-0000-4000-8000-000000000001';
const B = 'a2000000-0000-4000-8000-000000000002';
const USER_A = 'a2000000-0000-4000-8000-000000000003';
const RULE_A = 'a2000000-0000-4000-8000-000000000010';
const RULE_B = 'a2000000-0000-4000-8000-000000000020';
const RULE_NULL = 'a2000000-0000-4000-8000-000000000030';
const MISSING = 'a2000000-0000-4000-8000-000000000099';
const ORIGINAL = 'a2000000-0000-4000-8000-000000000040';
const REPLACEMENT = 'a2000000-0000-4000-8000-000000000050';
const createInput = {
  zone: 'coastal', trade: 'electrical', finishLevel: null,
  originalAssemblyId: ORIGINAL, replacementAssemblyId: REPLACEMENT,
  overrideType: 'swap' as const, reasonTemplate: 'Own rule', active: true,
};
```

O contexto sintético é um `TrpcContext` com user.id=USER_A, role='admin', tenantId=A e request/response de teste; preencher os demais campos com a estrutura existente dos testes B2, sem consulta de autenticação real. `caller` abaixo é o createCaller real desse contexto. `observer` é a conexão independente do harness. `audits` é o array de chamadas ao sink controlado; `getDb` é substituído apenas pela conexão privada de aplicação. Nenhuma variável de URL de DB pode ser herdada.

- [ ] **5. Escrever o primeiro teste do ciclo real antes do código.** Na implementação da prova, a API/raw query deve seguir este oráculo:

```ts
const created = await caller.createRule(createInput);
const [stored] = await observer.sql`
  SELECT tenant_id, reason_template, is_active FROM geographic_overrides
  WHERE id = ${created.id}::uuid`;
expect(stored.tenant_id).toBe(A); // RED relevante na base: NULL, sem erro de schema.
expect((await caller.getRule({id: created.id})).id).toBe(created.id);
await caller.updateRule({id: created.id, reasonTemplate: 'Own revised rule'});
expect((await caller.getRule({id: created.id})).reasonTemplate).toBe('Own revised rule');
await caller.deactivateRule({id: created.id});
expect((await caller.getRule({id: created.id})).isActive).toBe(false);
await caller.reactivateRule({id: created.id});
expect((await caller.getRule({id: created.id})).isActive).toBe(true);
```

Também registrar numa prova/observação de compatibilidade que o ciclo antigo pode funcionar globalmente apesar do stamp NULL. Não fazer a baseline carregar o código novo para obter resultado.

- [ ] **6. Escrever os pares B/NULL pela mesma API.** Antes de cada operação, reinicializar fixtures; regra alvo ativa para deactivate, inativa para reactivate. Consultar snapshot completo pelo observer antes/depois. Capturar erro/resultado sem interromper o registro do efeito:

```ts
const before = await observer.sql`SELECT * FROM geographic_overrides ORDER BY id`;
const outcome = await caller.updateRule({id: RULE_B, reasonTemplate: 'Unauthorized change'})
  .then(value => ({value, error: null}), error => ({value: null, error}));
const after = await observer.sql`SELECT * FROM geographic_overrides ORDER BY id`;
expect(after).toEqual(before); // na base a row B muda; não depende do bug de active.
expect(outcome.error?.code).toBe('NOT_FOUND');
expect(audits).toHaveLength(0);
```

Para get, observar a ausência da row na resposta em vez de esperar alteração do banco. Para de/reactivate, usar o mesmo padrão com o boolean alvo. Capturar SQL/parameters para complementar o oráculo, não substituí-lo.

- [ ] **7. Executar e preservar RED na base antes de tocar produção.** Só depois da autorização de execução. Executar os casos já escritos e que usam a mesma API; confirmar que o efeito de tenant é o motivo da falha. Não executar seed operacional. Se a prova falhar em import/parser/schema ou dependência anterior, corrigir apenas a prova legítima/fixture e repetir antes do patch; não marcar segurança RED.

## Task 2: Implementar o ciclo CRUD e a passagem de contexto

**Files:** os três arquivos de produção e provas focais. **Consumes:** contratos da spec §4 e RED da Task 1. **Produces:** cinco exports tenant-required e rotas compatíveis, sem overload antigo.

- [ ] **1. Acrescentar os casos normais de boundary e os casos candidate-only de contrato da matriz abaixo.** Guard/normalização pode usar helpers mockados; rotular isso como interface, não SQL tenant proof. Testar os nomes públicos existentes.
- [ ] **2. Implementar os privados locais de owner/predicate/whitelist e a leitura estrita.** A lista literal de chaves é a da spec, não derivada automaticamente de futuros campos do schema. Rejeitar contexto ausente antes de getDb; normalizar caixa de UUID. Forma obrigatória do predicate:

```ts
and(eq(geographicOverrides.tenantId, owner), eq(geographicOverrides.id, id))
```

Não adicionar active=true nesse ponto. Row retornada deve confirmar id+owner também no pós-read. Toda variável owner vem de requireOverrideTenant(tenantId), definida no mesmo módulo para rejeitar null/undefined/não-string/blank com TenantScopeError e retornar a identidade em minúsculas; id vem do input UUID existente, normalizado em caixa.

- [ ] **3. Implementar create dentro de uma transaction.** O código deve realizar a sequência abaixo, usando os privados definidos e o mesmo tx; `clean` é a nova cópia whitelist do input e `loadRuleInTenant` é a leitura estrita descrita na spec:

```ts
const created = await db.transaction(async tx => {
  const ids = await tx.insert(geographicOverrides)
    .values({...clean, tenantId: owner}).returning({id: geographicOverrides.id});
  if (ids.length !== 1 || !ids[0]?.id) throw new OverrideWriteVerificationError();
  const row = await loadRuleInTenant(tx, owner, ids[0].id, false);
  if (!row) throw new OverrideWriteVerificationError();
  return row;
});
```

`OverrideWriteVerificationError` é uma classe privada dedicada a falha de verificação, com mensagem interna genérica sem conteúdo de outra row. Na criação ela resulta em falha de criação após rollback, sem retorno fictício; nos point writes apenas essa classe/negação privada pode mapear para null. Erros de DB inesperados propagam. Audit só depois de db.transaction resolver, conforme spec §5.

- [ ] **4. Implementar o privado comum para update/toggles.** Sequência obrigatória: owner+id → transaction → SELECT estrito FOR UPDATE → before → se patch vazio, `{before,after:before,didWrite:false}` → UPDATE id+owner RETURNING id → exigir um id correspondente → SELECT estrito/readback → validar owner/id e isActive solicitado → commit → audit. Os dois wrappers passam somente `{isActive:false}` ou `{isActive:true}` e convertem row/null em boolean. Não chamar o get público de dentro do tx.

Trecho que impede sucesso quando BEFORE UPDATE suprimiu a escrita:

```ts
const ids = await tx.update(geographicOverrides).set(clean)
  .where(and(eq(geographicOverrides.tenantId, owner), eq(geographicOverrides.id, id)))
  .returning({id: geographicOverrides.id});
if (ids.length !== 1 || ids[0].id.toLowerCase() !== id) {
  throw new OverrideWriteVerificationError();
}
const after = await loadRuleInTenant(tx, owner, id, false);
if (!after || (clean.isActive !== undefined && after.isActive !== clean.isActive)) {
  throw new OverrideWriteVerificationError();
}
```

- [ ] **5. Adaptar as cinco rotas e o mapper.** Get usa tenantProcedure; quatro writes usam adminTenantProcedure. Remover os três checks globais prévios no router; a autorização/verificação é feita pelo helper transacional e o retorno null/false vira NOT_FOUND. Não remover a validação pura de create.

```ts
const {id, active, ...data} = input;
const patch: OverrideRulePatch = {
  ...(data.zone !== undefined ? {zone: data.zone} : {}),
  ...(data.trade !== undefined ? {trade: normalizeTrade(data.trade) ?? data.trade} : {}),
  ...(data.finishLevel !== undefined
    ? {finishLevel: normalizeFinishLevel(data.finishLevel) ?? data.finishLevel} : {}),
  ...(data.originalAssemblyId !== undefined ? {originalAssemblyId: data.originalAssemblyId} : {}),
  ...(data.replacementAssemblyId !== undefined ? {replacementAssemblyId: data.replacementAssemblyId} : {}),
  ...(data.overrideType !== undefined ? {overrideType: data.overrideType} : {}),
  ...(data.reasonTemplate !== undefined ? {reasonTemplate: data.reasonTemplate} : {}),
  ...(active !== undefined ? {isActive: active} : {}),
};
const row = await updateOverrideRule(ctx.tenantId, id, patch, ctx.user.id.toString());
if (!row) throw new TRPCError({code: 'NOT_FOUND', message: 'Override rule not found'});
return row;
```

- [ ] **6. Adaptar todos os callers de create no mesmo patch.** Create API, seedCoastalRules e bootstrap. Seeder API recebe adminTenantProcedure; bootstrap passa seedTenantId como primeiro argumento. Nenhuma assinatura de list/log/stats muda e nenhum fallback global é introduzido nos helpers corrigidos.
- [ ] **7. Provar a passagem do bootstrap sem operar seed.** No arquivo separado, mockar seedScopeRules, seedCharlestonZones, seedRemodelTemplates, listOverrideRules e createOverrideRule; as constantes podem ser lidas, sem gravá-las. `process.exit` é interceptado e restaurado. Exemplo de sincronização do main real (não chamar pnpm seed):

```ts
const done = Promise.withResolvers<number>();
vi.spyOn(process, 'exit').mockImplementation(code => {
  done.resolve(Number(code ?? 0)); return undefined as never;
});
process.env.SEED_TENANT_ID = A;
await import('./seed'); // colaboradores já mockados; import inicia main sem qualquer DB
expect(await done.promise).toBe(0);
expect(createSpy.mock.calls.length).toBe(COASTAL_OVERRIDE_SEED_RULES.length);
for (const args of createSpy.mock.calls) expect(args[0]).toBe(A);
```

Definir createSpy no vi.hoisted do arquivo, retornando row sintética, e listOverrideRules retornando []; demais seeds retornam respectivamente 0, 0 e `{created:0,updated:0}`. Restaurar SEED_TENANT_ID, console e exit em afterEach. O objetivo é somente contexto na chamada; nenhuma conclusão de seed funcional/atômico. Se algum colaborador real for alcançado, o teste deve falhar fechado.

- [ ] **8. Executar GREEN focal e completar a matriz de casos.** Não alterar código fora do recorte para satisfazer expectativas. Regressão completa e gate final ocorrem na Task 3. Commit intermediário, se necessário, permanece local e identificado como não revisado; não entregar ou publicar ciclo incompleto.

## Matriz concreta de provas planejadas

| Grupo | Casos | Oráculo / natureza |
|---|---:|---|
| Normal: seis rotas sem usuário | 6 | middleware recusa antes de helper; contrato, não novo SQL proof |
| Normal: seis rotas sem tenant | 6 | erro B2 antes de helper/listagem; positivo separado |
| Normal: cinco rotas admin chamadas por usuário comum | 5 | role preservado, nenhum efeito |
| Normal: contexto A propagado nas seis rotas | 6 | argumentos do helper/seed vêm de ctx; interface only |
| Normal: active true/false | 2 | isActive correto, active não chega ao ORM |
| Normal: finishLevel null e alias prem→premium | 2 | null preservado e normalização existente |
| Normal: trade electric→electrical | 1 | alias existente preservado |
| Normal: whitelist pública de update | 1 | id/active/owner/timestamps não entram no payload DB |
| Normal: get/update/deactivate/reactivate com retorno indisponível | 4 | NOT_FOUND uniforme |
| Normal: bootstrap com contexto explícito | 1 | main real e colaboradores mockados; somente passagem de tenant |
| PG: quatro pontos × B/NULL × strict off/on | 16 | negação, estado intacto, sem audit; RED de API antiga válido |
| PG: quatro pontos × ID ausente | 4 | controle NOT_FOUND nas duas bases |
| PG: criar→consultar→editar→desativar→reativar A | 1 | stamp A e continuidade; baseline NULL é RED |
| PG: cinco helpers diretamente sem tenant | 5 | candidate-only, erro antes da aquisição de DB |
| PG: create/update × payload tenant B/NULL | 4 | whitelist/stamp preservam A; candidate-only de contrato direto |
| PG: três point writes com BEFORE UPDATE RETURN NULL | 3 | zero afetado não é sucesso, sem audit, estado original |
| PG: update com owner B, owner NULL ou DELETE posterior | 3 | readback inválido provoca rollback; trigger também revertido |
| PG: create com owner B, owner NULL ou DELETE posterior | 3 | criação inválida revertida e sem audit |
| PG: quatro writes com sink audit NULL | 4 | dado committed, audit não confirmado, retorno preservado |
| PG: update com sink audit throw | 1 | erro posterior não é rollback do negócio |
| PG: patch vazio próprio e estrangeiro | 2 | próprio sem write/audit; estrangeiro indisponível |
| PG: get/update com UUID maiúsculo | 2 | mesma identidade PostgreSQL, não falsa ausência |
| PG: erros SQL inesperados em create/update | 2 | erro propaga; transaction desfaz efeito quando iniciado |
| **Previsto, não executado** | **84** | 34 normais + 50 PG; resultado e coleta reais serão registrados |

Em cada trigger/falha, guardar SQL, parâmetros, snapshot anterior/posterior, erro e ordem do audit. Nunca deixar o harness filtrar B/NULL independentemente do SQL de produção. A fixture contém UUIDs de referência válidos, mas não FKs externos: não tratá-la como prova G4. Asserções candidate-only não contam como reprodução do mesmo caso na base.

## Task 3: Verificar no SHA resultante e entregar no limite autorizado

**Files:** mesmos arquivos de código/prova; evidência separada depois. **Consumes:** ciclo GREEN, matriz completa e autorização de execução. **Produces:** commit de implementação com evidência exata, depois registro documental e revisão; nenhum push/merge.

- [ ] **1. Autorrevisão de escopo e qualidade:** conferir os três arquivos de produção, todos os callers, ausência de predicate NULL/overload velho nas funções alteradas, whitelists, rollback e audit. Ler spec item por item e mapear cada claim aos casos reais. Corrigir somente o recorte.
- [ ] **2. Registrar baseline contrast:** mesmos arquivos de prova/harness e mesmos inputs nas duas árvores. Não copiar implementação nova para base. Selecionar para previous-HEAD apenas os pares com API estável; testes diretos de assinatura nova permanecem candidate-only. Preservar os logs completos e classificar toda falha, não apenas total.
- [ ] **3. Executar comandos pertinentes e preservar saídas.** Ambiente normal sem URLs de DB, variáveis PG ou flags opt-in PG herdadas; ambiente PG também sem URLs/PG herdadas, acrescido apenas de G2_1_POSTGRES=1. Rodar cada comando com cwd da árvore correspondente e registrar SHA/UTC/exit/stdout/stderr sem truncamento:

```text
pnpm check
pnpm exec vitest run server/tenant-g2-1-override-crud.test.ts server/tenant-g2-1-seed-context.test.ts
pnpm exec vitest run server/tenant-g2-1-override-crud-postgres.test.ts   [somente com G2_1_POSTGRES=1]
pnpm test
pnpm audit:tenant
git diff --check                                                   [GIT_OPTIONAL_LOCKS=0]
```

O comando PG acima contém uma anotação de ambiente, não argumento literal a passar. Usar invocação estruturada com env explícito. Não executar todos os testes PG antigos por herdar flags alheias. O scanner pode conservar gaps porque o módulo ainda tem funções abertas; silêncio ou exit0 não é prova da família. Comparar warnings/gaps sem alterar a allowlist/scanner nesta unidade.

- [ ] **4. Verificar tipos das provas separadamente.** tsconfig atual exclui `**/*.test.ts`. Criar config **externa** de noEmit/incremental=false que estende o tsconfig absoluto do candidato, inclui os três testes e suporte novo e usa exclude vazio; executar `pnpm exec tsc --project` nessa config. Não enfraquecer tsconfig global ou testes para obter verde.
- [ ] **5. Criar o commit local de código/provas quando a unidade estiver verde.** Usar a lista exata de três arquivos de produção e quatro arquivos de prova/suporte; mensagem proposta `fix(security): isolate G2 override CRUD by tenant`. Conferir o SHA após existir e repetir os checks requeridos pelo gate nesse SHA imutável; registrar skips, limitações e resultados herdados separadamente. Não registrar SHA futuro em documento.
- [ ] **6. Revisão de qualidade e gate independente no SHA exato.** Revisores não autores conferem fonte, prova, base, novas assinaturas/callers, matriz de capacidades e limites do seed. Se surgir REQUIRED/BLOCKER, corrigir em novo SHA e repetir apenas evidências afetadas mais os checks obrigatórios do novo gate. Não transferir GO antigo nem pular gate humano.
- [ ] **7. Incorporar spec/plano/decisão e produzir evidência documental separada após resultados reais.** Preservar os hashes externos revisados e identificar qualquer atualização derivada dos resultados. Registrar source SHA, comparação, ambiente, 84 previstos versus coleta real, falhas anteriores relevantes, resultados atuais, reviewers/findings, limitações e matriz. Documento e eventual commit documental precisam de conferência própria; publicação continua pendente de autorização exata.
- [ ] **8. Entregar e parar no próximo limite.** Relatar o fechamento ou bloqueio das cinco operações, adaptações parciais de seed, demais rotas G2 abertas, PR9 NO-GO e B2 NOT DEFENSIBLE. Solicitar apenas a próxima decisão material; não instalar ferramentas, abrir Phase3 ou passar a logs/seed completo automaticamente.

## Autorrevisão do plano

Os contratos de criação/point writes, cinco rotas e dois callers estão mapeados às Tasks 1–2; provas e limites têm casos nomeados; gate/evidência ficam na Task 3. A revisão humana deste desenho não é uma execução. Trechos de código mostram contratos/algoritmos de implementação futura; nenhum deles foi aplicado aos arquivos de produção ou declarado compilado nesta rodada.
