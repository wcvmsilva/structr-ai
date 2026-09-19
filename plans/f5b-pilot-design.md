# F5b — persistência geográfica no projeto: medição e desenho do piloto

> **Reconciliação 18/09/2026 — PROPOSTA / EVIDÊNCIA HISTÓRICA.** Documento local task5 incorporado como planejamento atribuído, não como novo aceite de arquitetura, implementação ou liberação. Este é o desenho histórico anterior à implementação. F5b já é ancestral do candidato atual; fechamento formal e retrospectiva permanecem não verificados. Não reiniciar implementação a partir deste plano. O [estado atual](../docs/engineering/current-state.md) prevalece sobre próximas ações e status antigos. Resultados e linhas de código preservam sua base temporal.


**Estado: PROPOSTA preparada em 2026-09-11 sob aprovação do checkpoint de retomada.** A prioridade de F5b como primeiro piloto foi aprovada pelo usuário e está registrada em [current-sprint.md](current-sprint.md). Este documento entrega recuperação, medição estática e um desenho para o gate de arquitetura. Não registra desenho aprovado, implementação iniciada, testes executados de F5b, security GO, merge GO ou autorização de produção.

## 1. Fontes, bases e significado de F5b

| Fonte | Evidência recuperada | Limite |
|---|---|---|
| [PR #9](https://github.com/wcvmsilva/structr-ai/pull/9), corpo consultado pelo conector GitHub em 2026-09-11 | Seção **G3a-1-F5a+c — rule-F5 atomic geo CRUD + Charleston seed**, subseção **Non-claims / remaining work**: “**F5b project geo persistence is NOT fixed (`assignZoneToProject`, `persistGeocodeResult`)**” | Identifica expressamente os dois helpers; não contém spec unitária completa de F5b |
| [Commit 9c8ded31](https://github.com/wcvmsilva/structr-ai/commit/9c8ded31cf82c10456f1931a8830b50d53483a59), mensagem completa | F5a+c implementou atomicidade de CRUD de zonas e seed; registra F5b project geo persistence como não corrigido | Precedente de arquitetura, não implementação de F5b |
| [Código de segurança b95ea0bf](https://github.com/wcvmsilva/structr-ai/tree/b95ea0bf4741646f418fcc99a22d22a42d24be51) | HEAD do PR #9 observado: `b95ea0bf4741646f418fcc99a22d22a42d24be51` | Todas as linhas de código deste documento se referem a esse SHA; não são alegações sobre `main` |
| [Workflow f60cf9a5](https://github.com/wcvmsilva/structr-ai/blob/f60cf9a56679d4d7083b2c11ac4e2727d53d84c3/docs/engineering/current-state.md#L21) e [decisão de fechamento](https://github.com/wcvmsilva/structr-ai/blob/f60cf9a56679d4d7083b2c11ac4e2727d53d84c3/docs/engineering/decision-correction-log.md#L159) | Tasks 1–6 aprovadas e encerradas; dry run PASS em `23a3e3278bcd38f04b4316dfd7d9c5e58690a05d`; F5b ainda não implementado | Não repetir o dry run encerrado nem transferir seu PASS para código novo |
| [AGENTS.md no SHA de segurança](https://github.com/wcvmsilva/structr-ai/blob/b95ea0bf4741646f418fcc99a22d22a42d24be51/AGENTS.md#L65) | Regra F5: operações de banco em múltiplas etapas usam `db.transaction()` | Atomicidade é distinta de isolamento e de auditoria transacional |

O corpo do PR também estabelece que, depois do checkpoint de workflow aprovado, o próximo trabalho é **measurement and design** de F5b. A recuperação local e remota feita nesta retomada não encontrou uma spec detalhada adicional nos documentos, mensagens de commits ou discussões/review threads examinados. Este documento supre essa lacuna como proposta explícita, sem apresentá-la como decisão histórica.

**Não confundir as três referências:** F5b é a persistência geográfica de projeto nesta família de atomicidade; `finding-F5` do relatório de segurança original tratava de endpoints públicos com dados de pricing/templates; G1 `rule-F5` trata de fluxos de bundle items. O [handoff:232](https://github.com/wcvmsilva/structr-ai/blob/f60cf9a56679d4d7083b2c11ac4e2727d53d84c3/docs/security-remediation-handoff.md#L232) registra essa separação. G1 não entra no piloto.

A documentação atual está no worktree `task5`, branch `docs/canonical-structr-truth-v1`, base local `91d083c2aa1e5b92c88b3a77a808f196c8d92012`. O candidato de implementação F5b deve preservar a linhagem de segurança: a base proposta é `b95ea0bf`, em checkout isolado, após confirmar que o HEAD autorizado continua esse. Não aplicar as referências abaixo diretamente à linhagem canônica nem incorporar a branch de segurança a `main` para transportar documentação. A criação/publicação do candidato é uma operação posterior, não executada por esta preparação.

## 2. Medição estática concluída

Método: leitura de objetos Git no SHA acima, busca das declarações e chamadas estáticas/dinâmicas pelos nomes dos três helpers de geo e de `resolveProjectGeoContext`, leitura dos corpos dos helpers, callers, guard de projeto, módulo de auditoria e testes relevantes. A busca por símbolos não prova ausência de chamadas indiretas por mecanismos que não usem seus nomes; novas superfícies encontradas no candidato precisam entrar no inventário. Nenhuma aplicação, teste, consulta de banco, geocodificação ou configuração de ambiente foi executada nesta medição.

### 2.1 Helpers explicitamente incluídos

| Helper | Fluxo observado em `b95ea0bf` | Contrato observado |
|---|---|---|
| [`assignZoneToProject`, geo-db.ts:552–579](https://github.com/wcvmsilva/structr-ai/blob/b95ea0bf4741646f418fcc99a22d22a42d24be51/server/geo-db.ts#L552) | `getDb` → SELECT do projeto para `before` → UPDATE de `zone` e `zoneModifierSnapshot` por ID → `logAudit(project.assign_zone)`; sem transação abrangendo leitura/escrita | `Promise<boolean>`; `false` se banco/projeto ausente, `true` após escrita/audit; erros de banco podem propagar. Não recebe tenant |
| [`persistGeocodeResult`, geo-integration.ts:135–200](https://github.com/wcvmsilva/structr-ai/blob/b95ea0bf4741646f418fcc99a22d22a42d24be51/server/geo-integration.ts#L135) | `getDb` → SELECT de `before` → UPDATE de geocodificação e, quando fornecido, snapshot de zona → audit de geocode → audit de zona quando nome muda; sem transação abrangendo leitura/escrita | `Promise<boolean>`; `false` se banco/projeto ausente. Snapshot ausente preserva os campos atuais de zona. Geocode malsucedido também pode ser persistido, com `geocodedAt=null` |

Os dois helpers usam predicado de projeto por ID. O comentário de `geo-db.ts:548–550` explicita que a autorização de destino é responsabilidade do caller e que G3a-1 protegeu a origem do snapshot. Isso não prova autorização em qualquer chamada arbitrária aos helpers, nem demonstra uma exploração na aplicação. A presente constatação é de ausência da fronteira transacional exigida para o fluxo e de risco de `before` desatualizado entre escritores concorrentes; não houve reprodução comportamental nesta etapa.

### 2.2 Callers e consequências das falhas

| Caminho observado | Autorização/composição observada | Falha e fronteira a preservar |
|---|---|---|
| [`geo.assignToProject`, geo-router.ts:248–291](https://github.com/wcvmsilva/structr-ai/blob/b95ea0bf4741646f418fcc99a22d22a42d24be51/server/geo-router.ts#L248) → `assignZoneToProject` | `tenantProcedure`, guard de write no projeto, fonte da zona consultada por `ctx.tenantId` | `false` vira `NOT_FOUND`; erro lançado propaga pelo router. A origem estrangeira continua recusada antes da persistência |
| [`project.create`, project-router.ts:81–115](https://github.com/wcvmsilva/structr-ai/blob/b95ea0bf4741646f418fcc99a22d22a42d24be51/server/project-router.ts#L81) → `geocodeAndDetectZone` → `persistGeocodeResult` | Projeto criado com tenant/owner; a geocodificação ocorre depois; persistência só é chamada quando `geoResult.success` | Retorno booleano da persistência é ignorado; exceção é absorvida. Falha de geo não desfaz a criação do projeto |
| [`project.update`, project-router.ts:145–164](https://github.com/wcvmsilva/structr-ai/blob/b95ea0bf4741646f418fcc99a22d22a42d24be51/server/project-router.ts#L145) → `refreshProjectGeocode` | Guard de write, atualização do projeto primeiro; refresh se endereço mudou | Falha de geo é absorvida e não desfaz atualização do projeto |
| [`project.geocode`, project-router.ts:202–227](https://github.com/wcvmsilva/structr-ai/blob/b95ea0bf4741646f418fcc99a22d22a42d24be51/server/project-router.ts#L202) → `refreshProjectGeocode` | `tenantProcedure` e guard de write | Expõe `persisted`; exceções propagam. `success` de geocode e sucesso da persistência são campos distintos |
| [`refreshProjectGeocode`, geo-integration.ts:206–263](https://github.com/wcvmsilva/structr-ai/blob/b95ea0bf4741646f418fcc99a22d22a42d24be51/server/geo-integration.ts#L206) → `persistGeocodeResult` | Lê projeto por ID, faz geocodificação externa/detecção com tenant e persiste | Banco/projeto ausente retorna objeto com `persisted:false`; booleano do helper é propagado; erros não são absorvidos aqui. A leitura do endereço ocorre antes da chamada de rede |
| [`convertLeadToProject`, lead-conversion.ts:520–569](https://github.com/wcvmsilva/structr-ai/blob/b95ea0bf4741646f418fcc99a22d22a42d24be51/server/lead-conversion.ts#L520) → `resolveProjectGeoContext` → `refreshProjectGeocode` | Conversão comercial tem transação própria já encerrada; geo é pós-commit; tenant vem do input validado da conversão. Entrada: `leads.convertToProject`, lead-router.ts:358–378 | `resolveGeo:false` pula geo. Exceção gera warning e a conversão retorna `created:true` com IDs já criados; não reabrir/reverter essa transação por falha posterior de geo |
| [`leads.refreshGeoContext`, lead-router.ts:406–415](https://github.com/wcvmsilva/structr-ai/blob/b95ea0bf4741646f418fcc99a22d22a42d24be51/server/lead-router.ts#L406) → `resolveProjectGeoContext` | `tenantProcedure`, guard de write no projeto, `ctx.tenantId` encaminhado | Exceções passam por `mapConversionError`; observar o erro real nos testes de regressão, sem substituir por sucesso vazio |

O import de `assignZoneToProject` em `geo-integration.ts:28` não possui invocação nesse módulo; não conta como caller de produção. Corrigir esse import não é necessário ao piloto.

### 2.3 Limites encontrados no caminho de lead

[`resolveProjectGeoContext`, lead-conversion.ts:584–637](https://github.com/wcvmsilva/structr-ai/blob/b95ea0bf4741646f418fcc99a22d22a42d24be51/server/lead-conversion.ts#L584) chama `refreshProjectGeocode` em **:593**, constrói resumo, atualiza `geoWarnings`/`geoRiskClass` em **:612–620** e audita `project.geo_context_resolved` em **:622–634**. Esse segundo UPDATE ocorre depois da persistência do helper, fora da unidade proposta. A função **não consulta `result.persisted`** antes de construir/gravar o resumo.

Consequências para o desenho:

- Um erro lançado pelo helper interrompe a execução antes do UPDATE de warnings; a conversão já confirmada permanece, com warning do catch externo. O endpoint de refresh explícito mapeia o erro.
- Um retorno `persisted:false` não interrompe o resumo; esse comportamento preexistente não pode ser usado como prova de persistência integral do contexto geo. Se a releitura falhar depois de um UPDATE tentado, a proposta abaixo lança erro após rollback, em vez de introduzir mais um caminho silencioso `false` nesse consumidor.
- Não existe neste recorte uma transação única envolvendo coordenadas/snapshot, warnings/risk e seus audits. Uma falha no UPDATE de warnings pode deixar a geocodificação previamente confirmada. O gate deve aceitar a alegação **por helper** ou definir outra unidade para o contexto inteiro; não anunciar “geo context atômico” com este patch.
- O warning de conversão cita `project.refreshGeocode`, enquanto o endpoint observado chama-se `project.geocode`. Registrar a discrepância; a correção de copy não é necessária à atomicidade dos helpers.

### 2.4 Segurança e auditoria herdadas

[`project-access.ts:181–191`](https://github.com/wcvmsilva/structr-ai/blob/b95ea0bf4741646f418fcc99a22d22a42d24be51/server/project-access.ts#L181) rejeita caller sem tenant e verifica o tenant do projeto com `assertSameTenant`. O próprio comentário registra a tolerância a projetos legados sem tenant enquanto `TENANT_STRICT` está desligado. Não trocar essa política por igualdade estrita no piloto por analogia com `geo_zones`: isso mudaria F15 e acesso legado.

[`audit.ts:31–54`](https://github.com/wcvmsilva/structr-ai/blob/b95ea0bf4741646f418fcc99a22d22a42d24be51/server/audit.ts#L31) obtém seu próprio handle, não aceita transação e captura erros de inserção retornando `null`. O precedente F5a+c registra auditoria depois do commit, payloads capturados dentro da transação e nenhum audit de sucesso após rollback. Não afirma que negócio e audit confirmam atomicamente. `server/audit.ts` não é candidato de alteração de F5b.

## 3. Desenho proposto para o gate

**Alegação pretendida, se implementada e demonstrada:** cada invocação dos dois helpers executa leitura de `before`, atualização e verificação do estado persistido numa única transação de banco; falhas dentro dessa unidade causam rollback e não emitem audits referentes à escrita abortada. Escritores concorrentes desses campos são serializados no projeto, de modo que o `before` de uma operação concluída reflita o estado que ela efetivamente substituiu. Perda de conexão durante confirmação não permite inferir o resultado do commit; esse caso tem limite próprio abaixo.

### 3.1 Unidade transacional

Aplicar o precedente de wrapper público proprietário da transação e operações internas sobre o mesmo handle, sem criar abstração compartilhada nova apenas para dois fluxos:

1. Obter o banco; manter `false` quando indisponível, como no contrato atual.
2. Abrir **uma** `db.transaction()` por chamada de helper; nenhuma transação aninhada. Nenhum caller observado desses helpers os chama dentro de transação de negócio ainda aberta.
3. Selecionar o projeto por seu predicado atual e bloquear a linha para atualização (`SELECT … FOR UPDATE`, por mecanismo suportado pelo Drizzle instalado). Capturar `before` a partir da linha retornada **depois da aquisição do bloqueio**. Se ausente, retornar resultado sem mutação; o wrapper retorna `false` e não audita.
4. Construir o UPDATE com as mesmas regras de campos atuais, usando o handle da transação. Não alterar preços, Profit Shield, escolha de zona ou campos históricos não pertencentes à operação.
5. Fazer read-back obrigatório pelo mesmo handle e predicado enquanto o bloqueio ainda é mantido. Verificar existência e correspondência dos campos efetivamente escritos, levando em conta representação numérica/data/JSON real do schema. Não comparar campos alheios que triggers possam manter legitimamente.
6. Se não houver confirmação da escrita, lançar erro de persistência dentro do callback para rollback. **Proposta de contrato:** esse erro propaga após rollback; não é transformado em `false`, porque callers como `resolveProjectGeoContext` ignoram esse valor. Isso não muda a assinatura `Promise<boolean>`, mas é uma escolha de semântica de falha que o gate deve ratificar. Erros reais de banco/commit continuam propagando, sem captura genérica que os reclassifique como ausência.
7. Somente depois de a transação resolver, montar os mesmos eventos de auditoria com `before` e estado verificado mantidos em memória. Não reler o projeto após commit para montar audit. Retornar `true` depois do caminho de audit atual.

O read-back verifica persistência; com as assinaturas atuais ele **não é uma nova autorização de tenant**. Não chamá-lo de “read-back autorizado” nem inferir tenant a partir da linha. O bloqueio alinha leitura/escrita e before/after; não revalida permissões externas nem fecha uma eventual mudança de tenant ocorrida entre guard e helper. A medição não estabeleceu exploração desse intervalo. Qualquer alteração de assinatura para receber tenant, novo predicado de autorização ou endurecimento de projeto legado precisa ser apresentada como mudança adicional, com impacto e decisão próprios, antes de entrar no patch.

### 3.2 Rede e estado da origem

`geocodeAddress` e `geocodeAndDetectZone` permanecem fora da transação. `refreshProjectGeocode` continua obtendo o resultado antes de invocar o helper de persistência. A conversão de lead, criação e atualização de projeto continuam confirmadas independentemente da etapa posterior de geo.

Não há nesta proposta token/versionamento de endereço nem rechecagem da zona de origem após rede. Um endereço ou política de zona pode mudar enquanto a resolução externa ocorre; a serialização da persistência não prova que o resultado corresponde ao endereço mais recente. Essa possível necessidade é registrada como questão de consistência do percurso, não silenciosamente incluída em F5b ou tratada como falha já reproduzida. A revisão deve aceitar esse limite ou definir escopo adicional antes de implementar.

### 3.3 Eventos e contratos preservados

| Condição | Resultado proposto |
|---|---|
| Projeto/banco ausente antes da escrita | `false`; zero escrita e zero audit |
| Escrita e read-back confirmados | Commit; audits atuais após commit; `true` |
| Erro de SELECT/UPDATE/read-back ou rejeição de commit com rollback confirmado | Erro propaga; zero escrita confirmada e zero audit da operação abortada |
| Resultado do commit indeterminado, por exemplo perda de conexão durante confirmação | Erro propaga e o wrapper não audita sem confirmação; não afirmar rollback ou ausência de escrita sem evidência. Não introduzir retry automático com potencial de duplicar eventos |
| Read-back inexistente/divergente depois da tentativa de escrita | Rollback; erro de persistência propaga; zero audit; sem novo sucesso/`false` silencioso |
| Falha de inserção em `logAudit` depois do commit | Preservar comportamento atual de `logAudit`; negócio não é revertido; não afirmar trilha garantida ou F2 transacional |
| `persistGeocodeResult` sem `zoneSnapshot` | Preservar zona e snapshot existentes |
| Mesmo nome de zona, snapshot diferente | Atualizar conforme contrato existente; não introduzir evento de mudança de zona baseado em comparação nova |
| Geocode com `success:false` fornecido ao helper | Preservar campos e ação `project.geocode_failed` previstos hoje; uma escrita desse resultado confirmada não é rollback |

`project.assign_zone`, `project.geocode_resolved`/`project.geocode_failed` e `project.zone_changed`/`project.zone_assigned` permanecem os nomes de evento. O audit de geocode falho só ocorre se esse resultado foi persistido com sucesso. Um rollback não deve emitir nem audit de sucesso nem de “geocode failed” como se a tentativa houvesse sido gravada.

## 4. Arquivos candidatos e exclusões

| Arquivo na futura base de segurança | Trabalho candidato |
|---|---|
| `server/geo-db.ts` | Modificar o helper existente `assignZoneToProject`; manter CRUD/seed já revisados e suas assinaturas |
| `server/geo-integration.ts` | Modificar o helper existente `persistGeocodeResult`; manter rede fora e contratos dos orchestrators |
| `server/tenant-f5b-project-geo.test.ts` (novo, nome proposto) | Provas de cada helper, contratos de erros/audit, regressão dos callers e segregação entre prova e controles |
| Teste PostgreSQL dedicado + suporte de teste revisado | Provar bloqueio, mesmo handle e rollback com as funções reais; localização final conforme harness aprovado no candidato |
| `server/tenant-g3a-geo-zones.test.ts`, `server/phase2-flow.test.ts`, suites existentes de geo/geocoding/projeto | Executar regressões; ajustar fixture somente quando necessário e sem enfraquecer assertions existentes |
| Registro atual/gate do candidato F5b | Registrar SHA, comandos, resultados, achados, não alegações e revisão independente; sem reescrever evidência histórica |

Routers, `server/lead-conversion.ts` e `server/project-access.ts` entram no mapa de impacto e testes. Não se tornam arquivos de alteração de produção apenas por consumirem os helpers. Se o gate optar por mudar semântica de `persisted:false`, consistência do resumo, assinaturas ou autorização, atualizar explicitamente essa lista e o desenho antes de ampliar o patch.

Fora do recorte proposto: novos domínios/tabelas/UI/endpoints; C-20/P-09; auditoria transacional estrita compartilhada; CRUD de `geo_zones` já fechado; G1 F2/F5; G3a-2/3; G2; G3b; F15/backfill; `TENANT_STRICT`; seeds/migrations; deploy; Supabase; geocodificação real; merge do PR #9. A fixture criada na preparação paralela de C-20 pode ser candidata reutilizável após revisão, mas não é prova de F5b nem deve ser transportada automaticamente entre linhagens.

## 5. Critérios comportamentais e evidência exigida

Os critérios abaixo são requisitos propostos para a execução futura; **nenhum está marcado como passado nesta medição**. Casos parametrizados nos dois helpers devem exercitar produção e efeitos reais, não apenas contar chamadas mockadas ou confirmar exportações.

| ID | Critério | Evidência que decide |
|---|---|---|
| T01 | Cada helper usa uma transação para leitura/bloqueio, escrita e read-back | Instrumentação distingue handle externo de transacional; nenhum statement da unidade foge do handle; não contar audit posterior como statement da unidade |
| T02 | `before` representa a linha adquirida sob bloqueio | Duas conexões concorrentes: segunda espera bloqueio observado; após primeira confirmar, before da segunda inclui alteração confirmada pela primeira |
| T03 | Falha de UPDATE/read-back ou commit comprovadamente rejeitado não deixa escrita confirmada | Inspecionar banco após falha, com zero audit correspondente; incluir caso UPDATE executado seguido de falha do read-back. Erro de conexão com resultado de commit desconhecido não é prova de rollback |
| T04 | Read-back inexistente/divergente não confirma atualização | Falha de verificação provocada e controlada; rollback demonstrado; erro observado pelo caller; zero audit |
| T05 | Projeto inexistente/banco indisponível preserva retorno | `false`, zero escrita e zero audit; ausência não é reclassificada como sucesso |
| T06 | Sucesso preserva campos e retorna `true` | Comparar campos persistidos e payloads de audit com before/after conhecidos, inclusive zona anterior vazia ou existente |
| T07 | Geocode falho e snapshot opcional preservam semântica | Falha de geocode persistida em sucesso de DB usa evento correto; snapshot ausente não apaga zona; mudança só de snapshot com mesmo nome não cria evento de nome alterado |
| T08 | Auditoria respeita a fronteira após commit | Não começa antes do commit; falha de negócio emite zero audit; falha interna de `logAudit` depois do commit não apaga negócio; payload não depende de releitura pós-commit |
| T09 | Geocodificação externa não ocorre sob transação/bloqueio de persistência | Serviço externo substituído por stub controlado; verificar ausência de transação aberta durante a chamada, incluindo refresh e conversão |
| T10 | `geo.assignToProject` preserva autorização e erro | Same-tenant permitido; zona estrangeira recusada e zero escrita; caller sem tenant/projeto sem permissão recusado; helper `false` vira `NOT_FOUND` |
| T11 | `project.create`/`project.update` preservam operação principal | Falha de persistência geo não desfaz projeto criado/alterado; nenhum audit geo afirma escrita abortada |
| T12 | `project.geocode` preserva distinção resultado/persistência | Sucesso geocode com retorno `false` expõe `persisted:false`; erro de persistência propaga sem resposta de sucesso inventada |
| T13 | Conversão de lead permanece independente do pós-processamento | Conversão confirmada seguida de falha F5b mantém client/project/intake e `created:true`, com warning; `resolveGeo:false` não chama geo |
| T14 | `resolveProjectGeoContext` não continua após erro lançado F5b | Falha lançada interrompe UPDATE de warnings e audit de contexto; testar chamada de conversão e endpoint de refresh |
| T15 | Limite de `persisted:false`/segundo UPDATE permanece visível | Caracterizar que false preexistente não é verificado pelo resumo e que falha posterior de warnings não reverte geocode já confirmado; controles documentam limite, não contam como prova de atomicidade ponta a ponta |
| T16 | G3a-1 permanece preservado | Suíte existente de 95 casos é regressão histórica de referência; executá-la no candidato sem inferir novo total nem novo GO antes de observar resultados |

Para T02, usar duas conexões de trabalho e observação explícita do bloqueador; espera temporal arbitrária não prova disputa. Para T01/T03/T04, combinar teste de erro controlado com banco PostgreSQL descartável que execute os helpers reais. Uma tabela mínima demonstrando que PostgreSQL faz rollback não prova que a aplicação usa o mesmo handle. Uma simulação que aplica filtros de tenant sozinha tampouco pode provar isolamento do código. Falha de read-back deve ser injetada de maneira rastreável no teste, sem adicionar um bypass de produção.

### TDD e execução futura

1. Fixar o SHA do candidato e preparar apenas testes/harness necessários ao critério escolhido. Escrever o teste antes da mudança de comportamento.
2. **RED:** demonstrar falha pelo motivo esperado contra `b95ea0bf`; guardar assertion, saída e SHA. Controles positivos devem passar na base; não apresentá-los como provas sensíveis à correção.
3. **GREEN:** implementar o mínimo no helper existente e demonstrar o critério aprovado. **REFACTOR:** limpar sem mudar contratos e reexecutar os testes afetados.
4. Executar as suites dedicadas, regressões dos callers e validações completas no candidato final. Classificar separadamente testes novos, provas sensíveis, controles, skips, warnings e limitações.
5. Revisão independente do autor no SHA exato: checar também handle por statement, fronteira de rede, before/after e não alegações. O precedente deixou NOTE-1 sobre prova de handle no fake e NOTE-2 sobre tipo amplo do handle; não declará-las corrigidas no código histórico por construir teste novo de F5b.

Comandos existentes confirmados em `package.json`/`vitest.config.ts` da base, para execução futura: `pnpm check`, `pnpm test`, `pnpm audit:tenant`, `pnpm exec vitest run server/tenant-g3a-geo-zones.test.ts server/phase2-flow.test.ts server/sprint11-geo.test.ts server/sprint15-geocoding.test.ts`, além da suite nova e do comando do harness real que constarem do candidato aprovado. Não executar `db:push`, seed ou migração remota como forma de preparar o teste.

F5b é uma unidade delimitada existente, sem motor/domínio novo proposto. O gate deve registrar seu enquadramento de entrega e a cobertura aplicável; este documento **não concede exceção ao mínimo de 60 testes por sprint de AGENTS.md**. Se o piloto for aberto como sprint, cumprir a distribuição do manual ou obter decisão explícita sobre enquadramento antes da execução; não fabricar testes de existência ou funções de engine artificiais para preencher contagem. A matriz T01–T16 é cobertura de comportamentos, não contagem de testes já entregue.

## 6. Pacote concreto para decisão de arquitetura

| Decisão delimitada | Recomendação pronta para revisão |
|---|---|
| Fronteira da alegação | Aprovar atomicidade **por helper** em `assignZoneToProject` e `persistGeocodeResult`, incluindo antes/depois e rollback; registrar o UPDATE posterior de warnings como limite, sem afirmar contexto geo integral atômico |
| Falha após UPDATE sem verificação | Aprovar rollback seguido de erro propagado; manter `false` apenas para ausência/indisponibilidade preexistentes. Isso evita criar falha silenciosa adicional no consumidor que ignora `persisted` |
| Assinaturas e tenancy | Preservar assinaturas, guards e semântica legado/F15 neste patch; qualquer endurecimento é mudança adicional explícita. Aceitar que atomicidade não equivale a isolamento global nem a autorização revalidada sob bloqueio |
| Auditoria | Preservar `logAudit` após commit e zero audit em rollback; não integrar auditoria estrita proposta em C-20 e não afirmar atomicidade negócio/audit |
| Base e validação | Candidato isolado na linhagem de segurança a partir do HEAD autorizado; testes RED/GREEN e PostgreSQL real; nenhum resultado da preparação de C-20 substitui prova dos helpers |
| Enquadramento | Registrar identificação da unidade, responsáveis por revisão e cobertura exigida pelo manual antes de implementar; não abrir novas features no piloto |

A recuperação e medição estática desta preparação estão entregues neste documento. O gate seguinte pode revisar essas escolhas diretamente, sem outra busca genérica por “o que é F5b”. Antes da implementação, só é necessária revalidação de fatos que tenham mudado — por exemplo novo HEAD, caller ou schema — e resolução explícita de eventual ampliação encontrada.

## 7. Critério de fechamento e não alegações

Fechar F5b exige implementação dos dois helpers na base aprovada, critérios comportamentais demonstrados, checks reais sem regressão, registro de achados/limites e revisão independente do SHA final. O relatório deve discriminar falha no baseline e sucesso no candidato, número de testes executados/skips, arquivos alterados e alcance exato do veredito.

Nesta preparação: **código F5b não alterado; testes F5b não escritos nem executados; desenho não aprovado; implementação não iniciada**. Os números históricos de testes pertencem aos SHAs e unidades que os produziram. A prontidão deste documento para revisão não é security GO. PR #9 permanece NO-GO; B2 global não demonstrado; F15, G1 e demais unidades permanecem independentes. O piloto, quando concluído, deve gerar retrospectiva antes de qualquer decisão sobre estabilização do workflow ou automação adicional.
