# R3 — transações dos helpers de itens de bundle

`addItemToBundle`, `updateBundleItemQuantity` e `removeBundleItem` agora executam cada invocação em uma transação. O mesmo handle transacional faz autorização existente de item/pai, leituras, escrita e releitura existente. Os leitores privados aceitam a interface de leitura compartilhada por banco/transaction, sem abrir outra conexão.

## Base aceita e escopo

Michael aceitou R2 candidate-1 em `2026-09-18T20:22:07.811Z`, após parecer independente Gemini `2026-09-18T20-20-33-128Z-b5b5df`. A decisão R2 (evidência local preservada: `../../tmp/munder-r1-r3/r3/r2-accepted.json`) registra a conferência dos 24 arquivos antes de R3.

- Diretório: `<local-workspace>/munder-workspace/worktrees/structr-r1-r3-20260918`.
- Branch: `codex/munder-r1-r3-20260918`.
- Base Git: `fbf7e4cabf8e60ee1d46a13d9d316afee353b451`.
- Manifesto R2: SHA-256 `3a40da6a8135cb442f8c3703c6cb2b3b9bfba2a84a68333585fc0d08b2d0c491`.
- Patch combinado R2: SHA-256 `e6bdaa381101f8fa89767dc4898ef0e15d18e04e4d317c3a0d22c95be1bbd965`.

R1 e R2 continuam preservados. O candidato final é base + patches + manifesto; a negativa de staging R1 não foi repetida e não há commit novo. A evidência de R1 era focal (46 testes) e R2 passou 70 casos (24 novos + 46 controles). Nenhum resultado anterior é apresentado como teste desta implementação.

Em produção, a alteração limita-se à região de bundles em `server/db.ts`: três transações, duas assinaturas privadas de leitura e seu tipo estrutural. Assinaturas públicas, autorização, predicados, mensagens de erro, resultados, quantity/isOptional e cálculo de sortOrder foram preservados. `duplicateBundle`, outros helpers, routers, auditoria, schema, guards e políticas não mudaram. A verificação de escopo (evidência local preservada: `../../tmp/munder-r1-r3/r3/production-scope.json`) compara as regiões preservadas ao arquivo original do RED.

## Prova comportamental

O [teste novo](../../server/bundle-item-transactions.test.ts) usa helpers e routers reais, guards reais e um modelo de driver. Cada transaction recebe cópia independente do estado confirmado. Publicação ocorre somente depois de callback bem-sucedido e commit explicitamente aceito pelo modelo. Rejeitar descarta a cópia; nenhuma asserção desfaz escritas. Operações fora da transaction publicam imediatamente, tornando a ausência da fronteira observável.

**RED original:** `updateBundleItemQuantity` executou UPDATE de `3` para `9`; a releitura seguinte lançou erro injetado. A evidência de escrita confirmou `9` e a asserção do estado confirmado esperou `3`, recebendo `9`. Assim o teste falhou pelo efeito persistido do helper original, sem exigir que ele já utilizasse transaction. Log RED (evidência local preservada: `../../tmp/munder-r1-r3/r3/red.log`) e fontes originais com hashes (evidência local preservada: `../../tmp/munder-r1-r3/r3/red-source/`) estão preservados. Um caso falhou como esperado; 63 foram excluídos pelo filtro do comando RED.

Os 64 casos R3 verificam:

- Sucesso de add/update/remove nos dois modos estritos, resultado e estado confirmados, mesma identidade de handle e ordem das operações.
- Guardas reais de pai estrangeiro/ausente, item ausente, caller tenant ausente, vínculo item/pai no predicado e compatibilidade de tenant nulo nos dois modos.
- Falha depois de insert/update/delete realmente aplicados ao snapshot, erro na releitura após UPDATE e commit explicitamente rejeitado; estado confirmado anterior preservado.
- Quantidade/defaults/opcionalidade, ordem restrita ao pai, preservação de itens alheios e comportamento atual de `duplicateBundle`.
- Callers reais: uma tentativa de audit depois do commit, payload anterior/resultante preservado, ausência de audit após rollback, commit rejeitado ou autorização negada.

A execução GREEN inicial passou os 64 casos e os 46 controles B2 (110, sem falhas/ignorados). O primeiro check dedicado encontrou duas incompatibilidades na união dos arrays do modelo de insert. Foram corrigidas com variáveis locais tipadas por inferência, sem casts de mascaramento nem mudança de comportamento. Fonte RED e log desse check permaneceram intactos. As verificações finais executam o arquivo corrigido.

## Limites preservados

O modelo testa a composição do código; **não prova o driver PostgreSQL físico, isolamento concorrente ou resultado real de COMMIT sob perda de conexão**. A falha de commit testada é explicitamente rejeitada. Não foi adicionado lock, isolamento mais forte, constraint, migração, unicidade de sortOrder ou política nova de propriedade de catálogo. Calcular MAX+1 na transação não garante ordem única entre escritores concorrentes.

A releitura de update que retorna array vazio, sem lançar erro, conserva o retorno `undefined` existente e pode confirmar a escrita. O teste de compatibilidade registra esse limite; R3 não introduz uma nova validação de existência/consistência na releitura. Uma exceção na releitura, por outro lado, aborta o callback transacional. Decidir uma semântica mais forte seria outra alteração de contrato.

A autorização adicional feita pelos routers antes do helper e o `before` de audit dos callers continuam fora da transação do helper. Os guards internos agora usam o mesmo handle do negócio, mas não há alegação de serialização global ou snapshot de auditoria bloqueado contra concorrência. Auditoria continua melhor esforço posterior ao negócio; audit `null` não desfaz commit. O tratamento local de rejeição de audit R2 pertence apenas a `preset.delete`, sem modificação ampla dos outros callers.

Sem banco vivo/descartável, migração, seed, navegador, instalação ou publicação nesta unidade. As suítes PostgreSQL opcionais permanecem limitações quando ignoradas; não contam como validação física. M00 D1–D6 e G4b-1 NO-GO/STOP continuam conforme [R1](integration-lineage-2026-09-18.md). O fechamento formal histórico F5b continua não verificado, sem reimplementação ou promoção de segurança.

## Evidência e inventário

Todos os comandos usam ambiente saneado sem credenciais de aplicação e `--no-cache` no runner normal. Logs brutos, comandos/cwd/tempos/exit codes e hashes estão em R3 (evidência local preservada: `../../tmp/munder-r1-r3/r3/`). Tipos dedicados mantêm Sprint17, testes C1 novos/alterados e ambos arquivos R2/R3; tipos da aplicação usam `pnpm check --incremental false`.

Alterado: `server/db.ts`. Criados: `server/bundle-item-transactions.test.ts` e este documento. Não foi necessária alteração de `server/tenant-b2-bundles.test.ts`. Novas tabelas, engines, helpers públicos ou endpoints: zero. Os três helpers existentes mantêm a auditoria em seus callers, tentada somente após sucesso. A fila adiciona 88 testes comportamentais (24 R2 + 64 R3), sem abrir sprint de produto.

## Resultado final observado

| Verificação final | Resultado |
|---|---|
| Focal R2/R3 + bundles/auth/tenant, 8 arquivos | 249 passaram; zero falhas/ignorados |
| `pnpm check --incremental false` | Exit 0; zero diagnósticos |
| `pnpm exec tsc -p tmp/munder-r1-r3/test-tsconfig.json` | Exit 0; zero diagnósticos |
| Suíte regular completa, comando normal abaixo | 3.132 passaram; 343 ignorados; zero falhas; 3.475 coletados |
| Arquivos na suíte completa | 80 passaram; 10 ignorados; 90 coletados |
| `git diff --check` e inventário/preservação | Exit 0; escopo delimitado e fontes anteriores preservadas |

```sh
pnpm test --maxWorkers=4 --minWorkers=1 --no-cache --reporter=default --reporter=json --outputFile=tmp/munder-r1-r3/r3/full-results.json
```

Execução completa: início `2026-09-18T20:27:23.666098Z`, fim `2026-09-18T20:28:24.532268Z`, exit 0; duração do comando 60,866 s. Log bruto (evidência local preservada: `../../tmp/munder-r1-r3/r3/final-full.log`), metadados do comando (evidência local preservada: `../../tmp/munder-r1-r3/r3/final-full.json`), relatório JSON do runner (evidência local preservada: `../../tmp/munder-r1-r3/r3/full-results.json`) e resumo verificável (evidência local preservada: `../../tmp/munder-r1-r3/r3/results.json`) preservados. As 649 suites internas do reporter JSON são agrupamentos `describe`; não substituem a contagem observada de 90 arquivos.

Os 343 ignorados se dividem em 264 casos PostgreSQL opt-in, 40 condicionados à ausência de banco da aplicação e 39 skips explícitos preexistentes. Inventário por arquivo, título e condição (evidência local preservada: `../../tmp/munder-r1-r3/r3/skipped-tests.json`). Nenhum skip foi adicionado para ocultar falha. A suíte completa executada tem zero regressões observadas; o resultado não prova os caminhos ignorados. Não houve repetição de suíte completa após atualização documental.

Candidato final local em `tmp/munder-r1-r3/r3/candidate-1/`: `manifest.json`, `incremental.patch` (R3) e `combined.patch` (desde a base). O manifesto contém hashes de todos os arquivos e evidências, incluindo snapshots RED. São 27 arquivos sobre a base: 24 aceitos de R1/R2 preservados e três caminhos R3. O total novo desta fila é 88 testes, todos executados; nenhum domínio ou sprint foi declarado.

Revisão independente final e decisão de Michael ainda são necessárias antes do encerramento da fila. Um candidato local revisado não é uma integração ou liberação de campo.


## Publicação reconciliada

Este registro preserva a evidência e os limites da unidade original. Caminhos de logs e missões marcados como locais não integram o repositório público; os originais e seus hashes permanecem no arquivo privado. O estado de integração posterior é registrado em [reconciliação de 18/09](progress-reconciliation-2026-09-18.md).
