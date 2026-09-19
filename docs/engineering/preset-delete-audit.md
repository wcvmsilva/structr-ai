# R2 — tentativa de auditoria em preset.delete

A rota existente `preset.delete` agora tenta registrar exatamente um evento `bundle.delete` após `deleteBundle` concluir. O estado autorizado é capturado antes da escrita. Permanecem `tenantProcedure`, UUID, autorização pelo tenant, `NOT_FOUND` para ausente/estrangeiro, exclusão lógica e resposta `{ success: true }`.

## Base e autoridade

R1 candidate-2 foi aceito por Michael em `2026-09-18T20:13:01.304Z`, após revisão independente Gemini (parecer inicial `2026-09-18T20-08-38-473Z-8e215b`, complemento `2026-09-18T20-11-41-698Z-05537c`). Decisão e conferência local dos 21 arquivos: r1-accepted.json (evidência local preservada: `../../tmp/munder-r1-r3/r2/r1-accepted.json`).

- Base Git: `fbf7e4cabf8e60ee1d46a13d9d316afee353b451`.
- Branch: `codex/munder-r1-r3-20260918` no mesmo diretório isolado.
- Manifesto R1: SHA-256 `54706417f0ea94dd183be8c385f1babe7903e9ea5efd4ec6c44ae54c2ff1090f`.
- Patch R1: SHA-256 `3e252d2f82ba9e28fe7f26c9d10f0a3f2326e3220eb9b65627da2bfc3417f998`.

Nenhum byte aceito de R1 foi alterado. A negativa anterior de staging (`index.lock` fora da raiz gravável) não foi repetida; a entrega usa base + patch + manifesto, sem commit novo presumido. R1 não executou uma suíte completa válida; o baseline focal passou 46 casos e os tipos passaram. Suas tentativas anteriores incompletas/com erro de cache permanecem registradas, sem promoção a PASS.

## Contrato de auditoria e limites

Payload idêntico ao contrato de `bundle.delete`: `userId = ctx.user.id`, `action = bundle.delete`, `tableName = bundles`, `recordId = input.bundleId`, `before = linha autorizada anterior`, `after = { isActive: false }`.

O audit é uma tentativa posterior à escrita, sem aguardar sua conclusão para retornar sucesso de negócio. `logAudit` pode retornar `null`; uma rejeição inesperada é capturada localmente e reportada por `console.error`. Nenhum desses resultados desfaz a exclusão concluída. **Não há garantia de linha de audit persistida, durabilidade, transação conjunta ou entrega eventual.** Capturar `before` antes da escrita também não introduz lock nem garantia de concorrência.

Não foram alterados `audit.ts`, guards, schema, outras rotas ou política de tenant nulo. Bundles legados com tenant nulo continuam mutáveis quando `TENANT_STRICT=false` e recusados quando `true`; isso documenta compatibilidade, sem validar a propriedade dessas linhas.

## TDD e verificação

Os testes importam o router tRPC original, helpers reais de `db.ts` e guards reais. Somente driver PostgreSQL e destino de auditoria são substituídos. O driver retorna cópias da linha, aplica o UPDATE à linha confirmada do modelo e deliberadamente não filtra tenant, exigindo que a guarda real rejeite registros estrangeiros. Não há banco real.

RED foi executado antes de editar a rota, em ambos modos estritos: a exclusão teve sucesso e alterou `isActive`, mas a asserção de um evento recebeu zero chamadas. Resultado: duas falhas esperadas; os outros 22 casos foram excluídos pelo filtro desse comando. Fonte original e teste estão preservados em red-source (evidência local preservada: `../../tmp/munder-r1-r3/r2/red-source/`), com hashes; log RED (evidência local preservada: `../../tmp/munder-r1-r3/r2/red.log`).

GREEN executou todos os 24 casos novos mais os 46 controles existentes: **70 passaram, zero falhas, zero ignorados**, pelo comando normal:

```sh
pnpm test server/preset-delete-audit.test.ts server/tenant-b2-bundles.test.ts --maxWorkers=1 --minWorkers=1 --no-cache
```

Cobertura: evento único e payload completo; ordem leitura/escrita/audit; `before` preservado após mutação; predicados com tenant/ID; UUID inválido; usuário não autenticado; tenant não resolvido inclusive admin; linha ausente/estrangeira; escrita rejeitada sem audit; audit `null`; rejeição capturada; ambos modos estritos; legado nulo; escrita suspensa sem audit antecipado; resposta de negócio independente da conclusão do audit. Os controles existentes não precisaram de alterações.

Log GREEN (evidência local preservada: `../../tmp/munder-r1-r3/r2/green-focal.log`), comandos/cwd/ambiente/tempos/exit codes e resultados de tipos estão em evidências R2 (evidência local preservada: `../../tmp/munder-r1-r3/r2/`). Ambiente saneado sem credenciais de aplicação; `--no-cache` evita escrita nas dependências compartilhadas. Tipos de aplicação usam `pnpm check --incremental false`; configuração dedicada inclui o teste novo e mantém todos os testes C1 alterados/novos e Sprint17. O manifesto registra resultados observados e hashes.

Não se executou suíte completa em R2: ela pertence ao fechamento após R3. Nenhuma execução PostgreSQL opt-in ou navegador foi realizada. Estes testes provam contratos do código sob driver controlado, não o driver físico, persistência de auditoria ou segurança global.

## Inventário e saída

Alterado: `server/preset-router.ts`. Criados: `server/preset-delete-audit.test.ts` e este documento. Novas tabelas, engines, helpers públicos e endpoints: zero. A rota continua exigindo usuário autenticado e tenant resolvido via `tenantProcedure`; tentativa de audit presente na mutação corrigida. Nenhuma regressão nos 46 controles executados. Revisão R2 independente ainda é requisito antes de R3; o aceite R1 não a substitui.

M00 D1–D6, disposição formal F5b e G4b-1 NO-GO/STOP permanecem conforme [reconciliação R1](integration-lineage-2026-09-18.md). Sem banco vivo, migração, seed, instalação, publicação ou liberação de campo.


## Publicação reconciliada

Este registro preserva a evidência e os limites da unidade original. Caminhos de logs e missões marcados como locais não integram o repositório público; os originais e seus hashes permanecem no arquivo privado. O estado de integração posterior é registrado em [reconciliação de 18/09](progress-reconciliation-2026-09-18.md).
