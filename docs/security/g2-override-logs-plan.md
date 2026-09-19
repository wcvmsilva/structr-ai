# G2 — recorte de implementação dos históricos de regras geográficas

Base `a9c30f143f1fda7f64c2b7454f051011c217e84b`. Política aprovada em `g2-override-logs-policy.md`. Este documento descreve o recorte implementado localmente e suas fronteiras; não declara gate, consolidação, publicação ou liberação.

## Objetivo

Restringir as quatro operações de histórico ao rascunho/projeto autorizado, preservar a proveniência das ocorrências novas e verificar gravação e exclusão sem efeitos parciais.

## Arquivos produtivos

| Arquivo | Responsabilidade |
|---|---|
| `server/geo-override-db.ts` | Tipos de autoridade e snapshot; preflight local; predicado dos pais; locks; whitelist do lote; comparação e verificação |
| `server/geo-override-router.ts` | Fronteiras de `getLog`/`hasOverrides`/`clearLog`; autoridade em `resolveForDraft`; mapper; validação mesmo com lote vazio |
| `server/remodel-router.ts` | Leitor com autoridade e permissão write; nenhum writer |
| `server/workflow-visualization-router.ts` | Leitor com autoridade e permissão read |
| `server/scope-to-estimate-pipeline.ts` | Autoridade obrigatória; preflight na entrada; leitor com write |
| `server/estimate-router.ts` | Fronteira de tenant em `createFromScopeDraft`; preflight antes do catch de recuperação e antes de `markRetrying` |

## Interfaces

```ts
requireScopeOverrideLogAccess(authority, draftId, permission): Promise<OverrideLogAccess>
getOverrideLogForDraft(authority, draftId, "read" | "write"): Promise<ScopeOverrideLogEntry[]>
hasOverridesApplied(authority, draftId): Promise<boolean>
writeOverrideLogEntries(authority, draftId, batch): Promise<number>
clearOverrideLogForDraft(authority, draftId): Promise<number>
```

O preflight recusa identidade ausente antes de obter banco, chama o guard de projeto existente **fora de transação**, exige que o projeto retornado seja o pai atual e que a empresa retornada seja a do contexto, e confere a política local na consulta aos pais. Ele não devolve token durável: **cada operação repete o predicado final**.

## Leitura, escrita e limpeza

- **Leitura:** consulta ancorada no par rascunho/projeto autorizado com `LEFT JOIN` do histórico. Pai válido sem registros devolve `[]`; zero linhas de pai é recusa. Ordem `createdAt` decrescente com `id` como desempate.
- **Escrita:** lote copiado e validado antes de qualquer `await` (cinco campos exatos por entrada; campos protegidos invalidam o lote); preflight fora da transação; dentro dela projeto `FOR SHARE` → rascunho `FOR UPDATE` → regras referenciadas por id crescente `FOR SHARE` → histórico `FOR UPDATE`; comparação do histórico inteiro e das dez colunas das regras referenciadas; `INSERT ... SELECT` reafirmando o pai autorizado no predicado final; verificação por `RETURNING`, releitura em multiconjunto e histórico final igual ao anterior mais as linhas confirmadas. Qualquer divergência reverte todo o lote.
- **Limpeza:** preflight `delete`, mesmos locks, snapshot anterior sob lock, `DELETE` com `EXISTS` do pai autorizado e `RETURNING`; conjunto devolvido comparado ao anterior e verificação de vazio final; devolve a quantidade realmente excluída.
- **Multiplicidade:** todas as ocorrências não ignoradas pelo motor são preservadas, inclusive idênticas. A contagem gravada é de ocorrências de resolução, não de trocas distintas.
- **Auditoria:** após o commit, com estado anterior real e linhas efetivas. Um retorno nulo é auditoria não confirmada e uma exceção posterior ao commit não desfaz o negócio — ambos são limites registrados, não atomicidade.

## Erros

| Situação | Resultado |
|---|---|
| Identidade/empresa ausente ou inválida | `FORBIDDEN`, antes de obter banco |
| Pai B/NULL/inconsistente/excluído | `FORBIDDEN` com mensagem genérica |
| Erro conhecido do guard | preservado |
| Snapshot de histórico ou regra divergente | `CONFLICT` |
| Lote estruturalmente inválido | `BAD_REQUEST` |
| Falha de banco, verificação ou releitura | `INTERNAL_SERVER_ERROR` sem SQL, detalhe privado ou causa serializada |

Nenhuma dessas falhas vira `[]`, `false`, `0` ou erro comercial de pipeline.

## Fora do recorte

Motor, schema, taxonomia, catálogo, preços, UI, política global de guards e `TENANT_STRICT`, propriedade de catálogo G4, RLS, migração, seed e backfill. O contrato numérico da visualização de workflow continua excluído. Nenhuma alteração de dependências.
