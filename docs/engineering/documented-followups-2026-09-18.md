# Próximos trabalhos documentados — preparação delimitada

## Estado e método

Preparação documental da Unidade B, após o aceite limitado da Unidade A em
2026-09-18. Referência de código: HEAD
`fbf7e4cabf8e60ee1d46a13d9d316afee353b451`, branch
`codex/munder-maintenance-20260918`. As linhas citadas são deste candidato.
Não houve alteração produtiva, novo teste, acesso a banco ou execução operacional
de seed nesta preparação. Este documento não é desenho aprovado nem autorização
de implementação.

Fonte de prioridades: [reconciliação G2](../security/g2-family-reconciliation-2026-09-17.md),
seção “Resíduos e classificação”. A atomicidade de `seedCoastalRules` continua
classificada ali como bloqueio `rule-F5` da PR #9; a política dos pais do preview
é dívida de autorização relevante à revisão B2 final. A documentação abaixo
não promove nenhum desses estados.

“Observado em código” significa leitura estática. “Observado em teste” significa
caso existente incluído na execução pós-edição da Unidade A; os logs por suíte
estão em `tmp/munder-maintenance/postedit-{focal,full}-configfalse.log`.
“Risco inferido” não significa falha reproduzida, incidente ou acesso real.

## 1. Atomicidade do lote em `seedCoastalRules`

### Código e cobertura existentes

| Ponto | Fato observado |
|---|---|
| [Router:429](../../server/geo-override-router.ts#L429), `seedCoastalRules` | `adminTenantProcedure`; recebe tenant/operador do contexto. Descobre regras em 433 e ignora o seed se existir qualquer regra em 434. |
| [Router:444](../../server/geo-override-router.ts#L444) | Executa `createOverrideRule` sequencialmente por regra e incrementa `inserted` após cada retorno. Não envolve descoberta e lote em uma única transação. |
| [DB:193](../../server/geo-override-db.ts#L193), `createOverrideRule` | Cada chamada abre sua própria transação em 203, insere e confirma a linha. O `logAudit` em 215 é posterior ao commit dessa chamada. |
| [Router:462](../../server/geo-override-router.ts#L462) | Auditoria de conclusão do lote ocorre após o loop; `seeded: true` é retornado em 475. |
| [Seed:31](../../shared/geo-override-seed.ts#L31) | O próprio comentário declara referências provisórias; `"101"` e `"201"` aparecem em 54–55. Os campos são UUIDs e referências a assemblies no [schema:1439](../../drizzle/schema.ts#L1439). |

Testes existentes, aprovados na execução da Unidade A:

- [Caller tests:330](../../server/tenant-g2-rule-read-callers.test.ts#L330): erro
  de descoberta interrompe antes de criar/auditar; descoberta usa tenant do
  contexto; usuário sem admin ou sem tenant é recusado. A criação é um dublê.
- [CRUD caller test:252](../../server/tenant-g2-1-override-crud.test.ts#L252):
  tenant A e operador chegam a cada chamada de criação; verifica quantidade
  de chamadas com criação substituída. Isso não prova commit/rollback do lote.

Não foi localizado, nos testes de `seedCoastalRules` examinados, um caso que
falhe na segunda criação real e verifique a ausência da primeira linha após o
erro. Os laboratórios PostgreSQL da regressão permaneceram ignorados.

### Cenários concretos a medir

| Cenário | Consequência inferida, ainda não reproduzida nesta missão |
|---|---|
| Lote com referências válidas: primeira criação confirma, segunda lança erro | A transação já confirmada da primeira chamada não pertence à segunda; pode restar lote parcial sem auditoria final de conclusão. |
| Primeira criação confirma, auditoria dessa chamada lança erro | A operação de negócio já confirmou; o erro posterior pode interromper o loop antes de incrementar `inserted`. Não há prova de atomicidade entre auditoria e negócio. |
| Repetição após lote parcial | A descoberta encontra alguma regra e retorna `seeded: false`; a regra de idempotência ampla pode impedir completar o lote. |
| Dois administradores descobrem simultaneamente um tenant vazio | Ambos podem iniciar o lote; o comportamento de concorrência/duplicação exige decisão e teste próprio. Uma transação isoladamente não define idempotência concorrente. |

Esses cenários usam referências sintéticas válidas para isolar atomicidade.
O seed atual possui IDs provisórios incompatíveis com UUID; ele pode falhar já
na primeira inserção. Não se afirma que houve lote parcial no banco ou que o
seed atual esteja pronto para provisionamento.

### Testes faltantes e decisões para uma unidade futura

1. Definir a operação atômica: descoberta, conjunto de regras esperado,
   confirmação de persistência e resposta. Exercitar falha no meio do lote
   com estado final idêntico ao inicial e nenhum falso sucesso.
2. Definir idempotência: qualquer regra existente, identidade do seed ou outra
   chave explicitamente aprovada; medir lote completo, lote parcial e regra
   manual preexistente. Não escolher chave ou migration neste documento.
3. Definir a garantia de concorrência e testar duas invocações no mesmo tenant,
   preservando isolamento de outro tenant. Sem assumir que o isolamento padrão
   fornece exclusão mútua.
4. Separar a decisão sobre auditoria pós-commit: comportamento em retorno nulo
   e em exceção, fidelidade do evento e ausência de declaração enganosa de
   sucesso. Não prometer auditoria atômica sem escopo próprio.
5. Resolver o manifesto de referências válidas e sua autoridade antes de seed
   operacional. Não inferir catálogo canônico a partir de IDs ou tenant NULL.

O RED futuro deve demonstrar a falha de atomicidade por comportamento, com
fixtures válidas e persistência/rollback observáveis. Falhar por UUID inválido
não demonstraria o defeito do lote. Uma prova PostgreSQL, se necessária, depende
de autorização própria e laboratório descartável; não usar banco operacional.
Preservar os controles atuais de admin, tenant, auditoria e recusa na descoberta.

## 2. Política dos pais em `previewForDraft`

### Caminho atual

| Ponto | Fato observado em código |
|---|---|
| [Router:314](../../server/geo-override-router.ts#L314) | `tenantProcedure`, UUID validado; chama `requireEntityAccess("scopeDraft", ..., "read")` em 322 antes dos leitores comerciais. |
| [Guard:387](../../server/project-access.ts#L387) | O resolvedor de scope draft seleciona somente `projectId` por ID; não lê o tenant do draft para decidir acesso. |
| [Guard:530](../../server/project-access.ts#L530) | `requireEntityAccess` entrega o projeto resolvido a `requireProjectAccessTrpc`. |
| [Guard:151](../../server/project-access.ts#L151) | Carrega `deletedAt` do projeto, mas a função não testa esse campo antes de conceder acesso por admin, owner, membership ou permissão do tenant. |
| [Guard:183](../../server/project-access.ts#L183) e [tenant-scope:140](../../server/tenant-scope.ts#L140) | Tenant do usuário é obrigatório; tenant diferente no projeto é recusado. Projeto sem tenant passa pela comparação somente quando `TENANT_STRICT` está desligado; ainda precisa de um caminho de permissão. |
| [Scope DB:276](../../server/scope-db.ts#L276), [406](../../server/scope-db.ts#L406) e [review DB:190](../../server/scope-review-db.ts#L190) | Após o guard, carregam draft/itens/deltas por identificador; não implementam a política local adicional dos históricos. |
| [Router:348](../../server/geo-override-router.ts#L348) | Leitura de regras recebe `ctx.tenantId`; isso limita as regras, mas não substitui a decisão sobre o draft e o projeto. |

A política dos históricos é mais restritiva e **local àquele contrato**:
[parentWhere:362](../../server/geo-override-db.ts#L362),
[parentApproved:392](../../server/geo-override-db.ts#L392) e
[authorizeParents:403](../../server/geo-override-db.ts#L403) exigem projeto do
tenant, `deletedAt === null`, vínculo draft→projeto correspondente e draft do
mesmo tenant ou NULL. O preview não chama esse caminho. Essa diferença não
autoriza transplantar a política ou mudar o guard compartilhado automaticamente.

### Matriz de evidência e próximos casos

| Caso | Evidência atual | Medição/decisão faltante |
|---|---|---|
| Projeto do tenant B, solicitante admin de A | Teste existente [caller:261](../../server/tenant-g2-rule-read-callers.test.ts#L261), incluindo preview, exige `FORBIDDEN` antes dos leitores; passou na suíte focal. | Preservar essa recusa e a ausência de efeitos como controle. |
| Projeto sem tenant, owner de A, `TENANT_STRICT=false` | Caso existente [caller:270](../../server/tenant-g2-rule-read-callers.test.ts#L270), com modo desligado em 184, permite o caminho e entrega tenant A ao leitor de regras; passou. | Não é ausência total de cobertura: restringir isso muda comportamento deliberadamente preservado. Decidir política e atualizar o endpoint/teste existentes, se autorizado. Medir também modo estrito. |
| Draft do tenant B vinculado a projeto de A acessível ao solicitante | Guard resolve projeto sem validar tenant do draft; risco inferido de leitura do draft e seus itens. Não reproduzido para preview nesta missão. | Caller com guard real e driver de existência deve expor a decisão; se a política aprovada for negar, exigir recusa antes de itens, catálogo e regras. |
| Projeto de A com `deletedAt` preenchido | Campo carregado sem recusa explícita no guard; risco inferido de preview de projeto excluído, condicionado aos demais controles. | Caso dedicado com owner e admin; definir código de erro e provar que nenhum leitor comercial roda após a recusa. |
| Draft NULL vinculado a projeto válido de A | Histórico permite essa combinação; não é evidência de política aprovada para preview. | Decidir tolerância de legado para o draft separadamente de projeto NULL, nos dois modos de `TENANT_STRICT`. |
| Draft/projeto inexistente ou indisponibilidade de autorização | O guard possui recusas próprias; isso não prova todos os caminhos de preview. | Controles focais de ausência, erro de aquisição e inexistência; não permitir resposta vazia de sucesso como substituta da recusa. |

O teste [caller:294](../../server/tenant-g2-rule-read-callers.test.ts#L294),
também executado, confirma swap pelo motor real com regras do tenant A,
sem gravação de histórico e sem auditoria no preview. Deve permanecer como
controle de sucesso autorizado.

Os casos de pais nos [históricos PostgreSQL:203](../../server/tenant-g2-override-log-postgres.test.ts#L203)
e [276](../../server/tenant-g2-override-log-postgres.test.ts#L276) são referências
de cobertura de outro contrato e não foram executados nesta missão. Os casos
de estimate create/retry em [caller de históricos:236](../../server/tenant-g2-override-log-callers.test.ts#L236)
passaram, mas não provam que o preview aplique a mesma política.

Antes de implementar, decidir: política exata de cada pai e de NULL; semântica
de `FORBIDDEN`/`NOT_FOUND`; fronteira local versus guard compartilhado; garantia
contra mudança de vínculo entre o guard e os leitores. A preparação não escolhe
arquitetura nem mecanismo de sincronização. Os testes futuros devem manter o
guard real, instrumentar acessos/efeitos e distinguir falha de autorização de
erro de fixture ou validação de UUID.

## 3. Dependências e limites que permanecem

- **G4b-1 continua NO-GO/STOP.** O registro mais recente consultado,
  [correção do Recover](../security/g4b-catalog-ownership/2026-09-17-g4b-1-recover-correction.md),
  preserva a parada e corrige migration history para `FAIL` (seções 3 e 7).
  O [Recover/Design](../security/g4b-catalog-ownership/2026-09-17-g4b-1-recover-design.md)
  não autoriza Plan, G4b-2, implementação ou operação de dados.
- A leitura de assemblies em [buildAssemblyLookup:489](../../server/geo-override-router.ts#L489)
  e os placeholders do seed são dependências do catálogo já registradas em G2.
  Nenhum tratamento dos pais ou do lote prova ownership/canonicalidade do
  catálogo; não se reabre G4a nem G4b por este documento.
- **M00 permanece sem decisão comercial resolvida.** A missão e o board
  determinam preservar essa pendência. Não foi localizado registro detalhado
  de M00 no conteúdo Markdown consultado deste candidato; portanto não se
  inventam preço, oferta, público, gate ou decisão aprovada. Uma futura unidade
  comercial precisa indicar seu registro de autoridade antes de alterar esse
  estado.
- Nada aqui fecha G2 inteira, `rule-F5`, auditoria global, B2 global, PR #9,
  prontidão operacional ou segurança. Não houve leitura do ambiente vivo;
  fatos de 2026-09-17 são referências históricas, não revalidação atual.

## Disposição

Preparação pronta para revisão documental independente. Próximos passos são
decisões e unidades separadamente delimitadas, com testes RED próprios; não
há autorização implícita para implementá-los. A redução de tipos da Unidade A
e seus testes aprovados não validam os cenários novos propostos neste documento.


## Publicação reconciliada

Este registro preserva a evidência e os limites da unidade original. Caminhos de logs e missões marcados como locais não integram o repositório público; os originais e seus hashes permanecem no arquivo privado. O estado de integração posterior é registrado em [reconciliação de 18/09](progress-reconciliation-2026-09-18.md).
