# C-20 M01 — inventário e contrato da origem da proposta

> **Reconciliação 18/09/2026 — PROPOSTA / EVIDÊNCIA HISTÓRICA.** Documento local task5 incorporado como planejamento atribuído, não como novo aceite de arquitetura, implementação ou liberação. C-20/C-21/C-22 permanecem não implementados por esta publicação; decisões ainda propostas não são promovidas a aprovadas. O [estado atual](../engineering/current-state.md) prevalece sobre próximas ações e status antigos. Resultados e linhas de código preservam sua base temporal.


**Estado em 2026-09-11:** inventário delimitado e contrato preparados; seis testes de caracterização executados. A aprovação para seguir cobre esta preparação. As recomendações de contrato abaixo não equivalem à aprovação arquitetural de D1–D6, à implementação do percurso comercial ou à validação de produção. F5b permanece o primeiro piloto do processo de engenharia.

**Base examinada:** checkout `task5`, HEAD `91d083c2aa1e5b92c88b3a77a808f196c8d92012`. As referências de código e linhas deste documento apontam para essa base. Os três documentos de planejamento C-20 já estavam locais e sem commit. O único código acrescentado por esta M01 é `server/proposal-source-approval.test.ts` (artefato local de preparação excluído deste pacote), que caracteriza comportamento existente; nenhuma função de negócio, schema ou migração foi alterada.

Relacionados: [plano M00–M21](proposal-issuance-implementation-plan.md), [desenho v3](proposal-issuance-technical-design-v3.md), [PRD](commercial-authorization-first-delivery.md) e [manual](../../AGENTS.md). Este documento fecha o perímetro do inventário para revisão, sem reabrir a auditoria das 48 capacidades.

## 1. Resultado que muda a próxima implementação

`status = approved` não comprova uma aprovação completa. O helper genérico aceita essa transição e grava apenas o status; o helper dedicado aplica Profit Shield e grava aprovador, horário, lock e avaliação. O contrato C-20 precisa recusar a origem incompleta e a origem cujo conteúdo mudou desde sua aprovação. Comparar apenas `version`, `updatedAt`, `lockedAt` ou um token calculado no preview não comprova o segundo caso.

Há três complementos delimitados ao desenho v3:

1. Atualizar os caminhos existentes de aprovação/status, desconto e versionamento quando o contrato for implementado; não criar outro endpoint que deixe a aprovação genérica em paralelo. Uma proposta mínima de evidência vinculada ao conteúdo está na seção 5, ainda sujeita à decisão arquitetural.
2. A leitura final de `prepare` precisa proteger também o cliente cujos dados entram no conteúdo. O protocolo proposto passa a ser projeto → origem → cliente, com rechecagem após bloqueios. Bloquear apenas projeto/origem não serializa mudanças em `clients.name` ou `clients.company`.
3. Auditoria estrita não basta para a confidencialidade: o feed existente de Field Launch lê linhas completas de `audit_logs` sem filtro de tenant. O novo histórico comercial não pode ser publicado por esse caminho genérico. A seção 7 delimita a correção necessária antes de gravar decisões C-20.

## 2. Perímetro e método do inventário

Foram pesquisados `server`, `shared`, `client/src`, `scripts`, arquivos executáveis na raiz e `drizzle`, incluindo SQL, imports dinâmicos, nomes SQL, imports por namespace/alias e atualizações com nomes de tabela em variáveis. A busca partiu de `estimateDrafts`/`estimate_drafts`, `projects`, `clients`, dos helpers exportados de estimativa/versionamento e de `audit`/`auditLogs`/`audit_logs`. Depois foram lidos os corpos dos escritores, os chamadores e os consumidores compartilhados.

Não foi encontrado outro escritor de `estimate_drafts` no código de aplicação dessa base além dos três módulos da seção 4.1. Isso é uma conclusão sobre a árvore examinada, não sobre clientes SQL externos, jobs remotos, funções instaladas fora das migrações versionadas ou conteúdo de produção. Os SQLs foram lidos e não executados. Nenhum segredo ou ambiente remoto foi necessário.

O inventário é finito porque o DTO abaixo enumera suas tabelas e colunas. Não consulta preço vigente, assemblies atuais, escopo vivo, lead ou cadastro de termos durante a construção do conteúdo. Um novo campo de origem exige alteração explícita do DTO, versão do contrato, matriz de escritores e testes; um `SELECT *` seguido de spread não é o contrato.

## 3. DTO e identidade da origem propostos

### 3.1 Projeção de leitura `ProposalSourceV1`

As linhas vêm de exatamente três tabelas. UUIDs são strings válidas; nulos são explícitos; datas persistidas são strings ISO UTC no DTO. A identidade deve satisfazer `draft.tenantId = project.tenantId = client.tenantId = tenant do contexto`, `draft.projectId = project.id` e `draft.clientId = project.clientId = client.id`, todos presentes. Não resolver cliente por nome, e-mail ou valor enviado pelo navegador. Uma discrepância exige correção explícita da origem.

| Bloco | Campos de origem que podem ser lidos e hasheados | Uso |
|---|---|---|
| Identidade da estimativa | `id`, `tenantId`, `projectId`, `clientId`, `version`, `source`, `estimateId`, `scopeDraftId`, `bundleId`, `pricingSchemaVersion` | Vínculos e proveniência |
| Ciclo da estimativa | `status`, `approvedBy`, `approvedAt`, `lockedAt`, `supersedesId`, `supersededBy`, `changeOrderOf` | Elegibilidade e detecção de mudança |
| Apresentação | `bundleName`, `lineItems`, `assemblySelections` | Nome e projeções comerciais explícitas |
| Valores | `subtotalPrice`, `subtotalCost`, `finalTotalPrice`, `discountApplied`, `discountAmount`, `grossProfit`, `grossProfitPct` | Venda congelada e proveniência interna |
| Contexto de cálculo/aprovação | `channel`, `commercialChannel`, `region`, `zone`, `finishLevel`, `profitShieldPassed`, `profitShieldMinPct`, `profitShieldFloorPct`, `profitShieldEvaluation` | Contexto persistido; não resolver tabelas de pricing novamente |
| Evidência interna de origem | `pricingSnapshot`, `metadata`, `draftData`, `notes` | Preservação delimitada, nunca resposta comercial |
| Projeto | `id`, `tenantId`, `clientId`, `name`, `address`, `city`, `state`, `zip`, `status`, `deletedAt` | Identificação/endereço comercial e disponibilidade |
| Cliente | `id`, `tenantId`, `name`, `company`, `isActive`, `deletedAt` | Identificação comercial e disponibilidade |

Fontes dos campos: [estimateDrafts](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/drizzle/schema.ts#L749), [projects](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/drizzle/schema.ts#L252), [clients](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/drizzle/schema.ts#L1243). `estimate_drafts` não possui `deletedAt`; seu arquivamento usa status. O contrato não inventa essa coluna.

As cinco colunas JSON de dados (`lineItems`, `assemblySelections`, `pricingSnapshot`, `metadata`, `draftData`) e a avaliação são unidades de evidência internas: o token cobre o JSON canônico completo de cada coluna selecionada, inclusive propriedades extras. Isso fecha o inventário **por coluna**, sem afirmar que o JSON legado tem um schema recursivo fechado. Aplicar limites de tamanho/profundidade antes de serializar; os limites operacionais devem acompanhar D5. Nada desses objetos pode chegar ao snapshot público por spread.

`createdAt`, `updatedAt`, `rejectedBy`, `rejectedAt`, `rejectionReason`, `warningsJson`, `assemblyCount`, `changeOrderReason`, `coastalModifier`, `trade` e `intakeFormId` ficam fora desta projeção. Campos derivados de execução do projeto, contato do cliente e notas de projeto/cliente também ficam fora. Não alegar preservação integral da linha ou do pipeline de pricing. A autorização continua sendo reavaliada a partir do contexto confiável e das políticas de recurso; a lista de campos de conteúdo não substitui RBAC.

### 3.2 Conteúdo comercial derivado

O builder público recebe somente uma projeção tipada, separada do DTO interno:

- Orçamento: ID, versão e nome; projeto: ID, nome e endereço; cliente: ID, nome e empresa.
- Cada item: `costGroupName` como agrupamento comercial, `costItemName` como nome, `description`, `quantity`, `unit`, `unitPriceSnapshot`, `taxable` e `assemblyId` para agrupamento. `unitCostSnapshot`, `costCode` e quaisquer outras propriedades são excluídos.
- Cada montagem: `assemblyId`, `assemblyName` e `quantity` para identificação/agrupamento. Não apresentar um segundo valor somável para a montagem quando seus componentes já estão nos itens.
- Valores: subtotal de venda, indicador/valor de desconto e total de venda. Quantidades e preços unitários preservam seu valor decimal; totais monetários devem ser representáveis em centavos sem arredondamento novo na preparação. Usar os utilitários financeiros do projeto para validação, nunca para inventar um total ausente.
- `commercialTermsText` e `customerNotes` vêm do input validado de preparação e entram no hash da intenção/conteúdo, não no token da origem. `draft.notes` continua exclusivamente interno. Destinatário é um fato de transmissão posterior; não copiá-lo implicitamente de `project.clientEmail` ou `client.email`.

Estas são recomendações concretas para D3, não confirmação de conteúdo mínimo de termos, moeda ou política tributária. `taxable` informa a propriedade existente, sem calcular imposto novo. Antes de habilitar a emissão, definir em D3 como o subtotal aprovado se reconcilia com a apresentação dos itens; divergência deve produzir erro de origem e não ajuste silencioso.

### 3.3 Origem incompleta e representação legada

Para a primeira entrega, recomendar `columns-v1`: conteúdo comercial somente das colunas tipadas acima. Não montar um orçamento misturando, por conveniência, o total da coluna, itens de `draftData` e montagens de outro caminho.

O fluxo `scope-to-estimate` constrói `draftData` em [server/scope-to-estimate-pipeline.ts:634](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/server/scope-to-estimate-pipeline.ts#L634), mas sua chamada de persistência passa apenas projeto, status, source e `draftData` em [linha 663](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/server/scope-to-estimate-pipeline.ts#L663). O helper [server/db.ts:392](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/server/db.ts#L392) não extrai itens, totais, cliente ou tenant desse JSON; tenant não fornecido resulta em null. A criação legacy usa o mesmo helper. Não afirmar que todas as origens atuais já poderão emitir uma proposta.

Sem tenant/vínculos válidos, itens comerciais completos ou totais válidos, a nova preparação retorna uma razão corrigível e não persiste proposta. Uma futura adaptação de `draftData` deve ter versão própria, precedência documentada e fixtures por formato; não é backfill implícito desta entrega. Uma origem existente elegível só será comprovada no teste integrado do piloto, sem presumir dados de produção.

### 3.4 Token da origem

Proposta: `sourceToken = SHA-256(canonicalJsonV1({ sourceContractVersion: "proposal-source-v1", source: ProposalSourceV1 }))`. O token abrange integralmente todos os blocos da seção 3.1, incluindo aprovação, ponteiros, notas internas e nomes/endereço de projeto/cliente. Os builders usados antes do upload e o insert final referenciam essa mesma leitura. Nenhuma releitura silenciosa pode substituir os snapshots sob um token anterior.

Valores decimais normalizados não podem passar por uma conversão que perca precisão. A implementação deve rejeitar número não finito, JSON inválido, escala/limite não suportado e ausência de campos necessários. Strings de termos/notas aceitas são hasheadas exatamente conforme o contrato, sem trim posterior. Arrays preservam ordem.

O token detecta mudança **desde o preview/leitura candidata**, não desde uma aprovação antiga. A identidade da aprovação da seção 5 resolve outra pergunta. Replay autorizado de uma operação já concluída devolve a proposta registrada mesmo se essa origem mudou posteriormente, conforme o plano M13.

## 4. Inventário dos escritores

### 4.1 Estimativas — todos os caminhos de aplicação encontrados

| Escritor / entrada | Campos e comportamento observado | Consequência para o contrato |
|---|---|---|
| [createEstimateDraftFromCalculator, estimate-db:124](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/server/estimate-db.ts#L124) ← `estimate.createFromCalculator`, [router:367](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/server/estimate-router.ts#L367) | Insere cliente, projeto, itens, montagens, valores e metadata; começa draft; tenant depende de payload extra. Auditoria posterior | Criar não implica elegibilidade; vínculos/tenant devem ser conferidos na origem |
| [createEstimateDraft, db:392](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/server/db.ts#L392) ← [estimateLegacy.create:35](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/server/estimate-legacy-router.ts#L35) e [pipeline:663](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/server/scope-to-estimate-pipeline.ts#L663) | Insere `draftData`, status fornecido e campos de governança opcionais; valores colunados não são extraídos do JSON | Não autorizar via nome do source; recusar conteúdo incompleto |
| [updateEstimateDraftStatus:324](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/server/estimate-db.ts#L324) ← [estimate.updateStatus:457](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/server/estimate-router.ts#L457) | Atualiza só status; transições incluem approved, archive e reopen; não limpa evidência antiga nem checa Profit Shield | F6: corrigir esse helper/endpoint existente; incluir em protocolo de bloqueios |
| [archiveEstimateDraft:671](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/server/estimate-db.ts#L671) ← [estimate.archive:551](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/server/estimate-router.ts#L551) | Alias funcional para `updateEstimateDraftStatus(id, "archived")` | Mesmo escritor; arquivamento muda elegibilidade/token |
| [updateEstimateDraftNotes:376](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/server/estimate-db.ts#L376) ← [estimate.updateNotes:527](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/server/estimate-router.ts#L527) | Atualiza notes inclusive em approved, sem atualizar updatedAt explicitamente | Notes apenas internas; mudança durante upload invalida token; lock de origem protege leitura final |
| [applyEstimateDraftDiscount:420](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/server/estimate-db.ts#L420) ← [estimate.applyDiscount:539](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/server/estimate-router.ts#L539) | Checa somente status approved; grava `discountApplied`, `discountAmount`, `finalTotalPrice`; leitura/atualização separadas | Revalidar imutabilidade sob lock; não confiar em checked-before-write |
| [approveEstimateDraft:488](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/server/estimate-db.ts#L488) ← [estimate.approveEstimate:483](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/server/estimate-router.ts#L483) | Aplica avaliação; grava status, aprovador/data, lockedAt, floor/evaluation; audit fora da operação; CO aprovado dispara materialização de campo após gravação | Aprovação/avaliação/evidência/audit devem ser atômicos quando corrigidos; C20 não chama essa função para aprovar automaticamente |
| [rejectEstimateDraft:606](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/server/estimate-db.ts#L606) ← [estimate.rejectEstimate:505](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/server/estimate-router.ts#L505) | Grava status/dados da rejeição; leitura e escrita separadas | Participa da serialização de mudança de estado; não considerar status antigo elegível |
| [createEstimateVersion:119](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/server/estimate-version-db.ts#L119) ← [estimate.createVersion:1033](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/server/estimate-router.ts#L1033) | Lê origem, aloca max+1, insere sucessor, grava `supersededBy` no anterior; etapas não estão em transaction | M10: transação projeto → origem, leitura final sob lock, insert/ponteiro/audit juntos |
| [createChangeOrder:210](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/server/estimate-version-db.ts#L210) ← [estimate.createChangeOrder:1059](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/server/estimate-router.ts#L1059) | Exige status approved; usa mesmo max+1; cria outra linha sem superseder base | Mesmo alocador/ordem de bloqueios; preservar ausência de supersessão |

`nextVersionForProject` é compartilhado ([linha 67](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/server/estimate-version-db.ts#L67)); o índice `(projectId, version)` declarado no schema é um índice comum, não unique ([schema:806](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/drizzle/schema.ts#L806)). Nenhuma garantia de unicidade concorrente deve ser inferida desse índice. Os criadores iniciais usam versão default/fornecida e não o alocador; M10 deve declarar a garantia para seus caminhos ou incluir os criadores antes de reivindicar unicidade global por projeto.

O copiado pelo versionador está enumerado em [copyPricingPayload:82](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/server/estimate-version-db.ts#L82). **Não copia `clientId`, `discountApplied`, `discountAmount`, `metadata`, `notes` nem `assemblyCount`**, embora copie total final, itens e avaliação. Uma versão de origem descontada pode conservar total líquido sem explicar o desconto. M10 deve acrescentar preservação coerente de cliente e desconto quando esse caminho passar a alimentar C20; os campos internos omitidos precisam ser copiados explicitamente ou registrados como lacuna, nunca reconstruídos. Avaliação copiada não equivale a nova aprovação, porque status/approvedAt/lockedAt da sucessora são novos.

### 4.2 Projeto e cliente

| Escritor | Interseção com `ProposalSourceV1` |
|---|---|
| [project-db.createProject:91](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/server/project-db.ts#L91), [lead-conversion:388](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/server/lead-conversion.ts#L388), [pipeline-db:80](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/server/pipeline-db.ts#L80) | Inserem identidade, vínculo, nome/endereço/estado. O caminho antigo de pipeline não fornece tenant/clientId no insert de projeto; não preencher esses vínculos por inferência no prepare |
| [project-db.updateProject:214](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/server/project-db.ts#L214) | Altera nome, endereço/cidade/estado/CEP e status; os outros campos escritos não entram no DTO |
| [project-db.updateProjectStatus:262](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/server/project-db.ts#L262), [deleteProject:300](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/server/project-db.ts#L300) | Alteram status; delete atual marca cancelled, não deletedAt |
| [previsit-db:199](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/server/previsit-db.ts#L199), [closeout-db:625](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/server/closeout-db.ts#L625) | Alteram status do projeto para previsit/closed; token muda sem interpretar isso como aprovação comercial |
| [client-db.createClient:117](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/server/client-db.ts#L117), [lead-conversion:352](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/server/lead-conversion.ts#L352), [pipeline-db:56](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/server/pipeline-db.ts#L56) | Inserem identidade/nome/empresa/estado ativo; verificar tenant no resultado |
| [client-db.updateClient:224](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/server/client-db.ts#L224), [deleteClient:292](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/server/client-db.ts#L292) | Alteram name/company ou isActive; não atualizam updatedAt explicitamente. Exigem lock de cliente na leitura final do prepare |
| [lead-conversion, reuso:376](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/server/lead-conversion.ts#L376) | Escreve tipo/canal/chaves de contato e updatedAt, sem alterar os campos selecionados de cliente; não muda token |
| [geo-db:218](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/server/geo-db.ts#L218), [geo-integration:159](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/server/geo-integration.ts#L159), [lead-conversion:563](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/server/lead-conversion.ts#L563) | Escrevem dados geo no projeto, fora do DTO; o cálculo usa contexto persistido do orçamento, não geo vivo |
| [field-operations-db:299](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/server/field-operations-db.ts#L299), [739](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/server/field-operations-db.ts#L739), [920](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/server/field-operations-db.ts#L920), [actuals-db:756](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/server/actuals-db.ts#L756), [calibration-db:564](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/server/calibration-db.ts#L564), [scope-completeness-db:241](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/server/scope-completeness-db.ts#L241) | Escrevem marcos/budgets/custos/aprendizado e updatedAt, fora do DTO. Não ampliar token com updatedAt e acoplar emissão a cada atualização operacional |

Atualizações SQL normais dessas linhas conflitam com os bloqueios de linha da leitura final. Isso permite não reescrever todos os módulos cadastrais apenas para ler uma origem estável. Ainda testar as ordens reais e manter curta a transação de prepare; ela não deve chamar helpers que atualizam cliente/projeto em outra ordem. Revalidar autorização depois de obter bloqueios, sem prometer serialização global de mudanças de RBAC que não fazem parte destas três linhas.

### 4.3 SQL, scripts e efeitos de FK

| Superfície versionada | Efeito observado e tratamento |
|---|---|
| [scripts/migrate-normalize.mjs:121](../../scripts/migrate-normalize.mjs#L121), [rollback-normalize.mjs:65](../../scripts/rollback-normalize.mjs#L65) | Nomes de tabela vêm de `channelTables`; SQL dinâmico altera `channel` em estimate_drafts/projects/clients, entre outras. O campo existe em estimate/project no schema atual; não concluir que o script funciona integralmente em clients. Não executar durante esta preparação |
| [0001_phase1_identity_tenant.sql:226](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/drizzle/0001_phase1_identity_tenant.sql#L226) | Backfill dinâmico de tenant em três tabelas e ownership de projeto. Não considerar null preenchido implicitamente no runtime |
| [mesma migração:849](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/drizzle/0001_phase1_identity_tenant.sql#L849) e demais blocos por tabela | `EXECUTE format` pode colocar FK órfã em null antes de criar constraints; inclui tenant/estimate/project da origem. É escritor de vínculo mesmo sem `UPDATE estimate_drafts` literal |
| [0002_phase2_previsit_estimate.sql:174](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/drizzle/0002_phase2_previsit_estimate.sql#L174) | Backfills de contato/endereço/canal comercial; [linha 265](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/drizzle/0002_phase2_previsit_estimate.sql#L265) atribui lockedAt a approved usando approvedAt ou updatedAt. Lock preenchido por migração não comprova decisão humana |
| [trigger:569](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/drizzle/0002_phase2_previsit_estimate.sql#L569) | Bloqueia mudanças em sete campos apenas quando `OLD.status = approved`: total final, subtotal preço/custo, desconto, itens, montagens, versão. Permite alterações em outros campos, inclusive JSON de contexto, vínculo, notes, status e ponteiros. Não é imutabilidade integral; instalação real não foi inspecionada |
| [schema:751](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/drizzle/schema.ts#L751) e SQL de FKs | Exclusão de estimate pode zerar estimateId; exclusão física de projeto pode excluir drafts em cascata. Novas FKs de proposta precisam impedir perda de evidência; nenhum expurgo/backfill foi autorizado |
| `0000`, `sync-new-columns`, `0003`, `0004` | Definições/colunas/constraints também foram localizadas; não são outros helpers de atualização comercial. Scripts de diagnóstico citam projetos/clientes, mas seus inserts de ensaio são de leads, não destas origens |

Nenhum import por alias ou namespace encontrado acrescentou um escritor oculto das três tabelas. `db` dentro de `withSupabaseAuth` em pipeline-db é o handle transacional recebido, e `tx` em lead-conversion é escritor real: ambos estão incluídos. Esta checagem não autoriza rodar scripts de diagnóstico, normalização ou migração.

## 5. Aprovação: evidência atual, lacuna e remediação proposta

### 5.1 Evidência atual comprovada

- [updateStatus no router:457](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/server/estimate-router.ts#L457) e [approveEstimate:483](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/server/estimate-router.ts#L483) usam `protectedProcedure` e o guard de acesso com `approve`; a diferença ocorre depois da autorização. O schema genérico inclui approved em [linha 160](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/server/estimate-router.ts#L160).
- O genérico grava `{ status: newStatus }` em [estimate-db:349](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/server/estimate-db.ts#L349). O dedicado avalia a margem em [linha 510](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/server/estimate-db.ts#L510) e grava a evidência em [linha 527](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/server/estimate-db.ts#L527). A avaliação não contém hash do conteúdo aprovado: [ProfitShieldEvaluation:64](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/shared/profit-shield-engine.ts#L64).
- `assertEstimateMutable` verifica somente status approved ([estimate-db:64](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/server/estimate-db.ts#L64)). O encadeamento approved → archived → draft é permitido e não limpa approvedAt/lockedAt/evaluation. Depois disso, desconto pode mudar dinheiro conservando a evidência antiga. A aprovação genérica seguinte pode voltar a marcar approved sem nova avaliação.
- Notes podem mudar em approved. `supersededBy` pode mudar por versionamento. Esses fatos exigem separar prova da aprovação, elegibilidade atual e token de preview.

### 5.2 Guardas propostas para uma nova preparação C-20

Aplicar autorização antes de revelar qualquer conflito/replay. Para uma operação nova, exigir:

1. Os três recursos existem, os vínculos/tenants são iguais e não nulos; projeto não soft-deleted/cancelled; cliente ativo e não soft-deleted. Outros estados de projeto não devem ser reinterpretados como aceite/autorização de execução.
2. Orçamento com status approved, approvedBy/approvedAt/lockedAt válidos; ausência de `supersededBy`; versão válida. Recomendar excluir `changeOrderOf != null` do primeiro percurso de proposta base, até produto definir emissão de aditivos separadamente.
3. DTO comercial completo e consistente, sem fallback silencioso para campos vazios ou formatos legados; avaliação persistida tem `passed = true`, `blocked = false` e dados coerentes.
4. Prova versionada que vincule a aprovação aos valores e conteúdo relevantes, conforme a proposta abaixo. Campos de aprovação preenchidos isoladamente não satisfazem essa prova.
5. Após o upload e bloqueios, o sourceToken continua igual ao esperado. Caso contrário, falhar sem inserir proposta, preservando o artefato órfão conforme D5. A aprovação não é refeita automaticamente por prepare.

Erros de domínio propostos para M05: `PROPOSAL_SOURCE_INCOMPLETE`, `PROPOSAL_SOURCE_NOT_APPROVED`, `PROPOSAL_SOURCE_APPROVAL_STALE`, `PROPOSAL_SOURCE_SUPERSEDED`, `PROPOSAL_SOURCE_CHANGED` e conflito de vínculos/acesso sem divulgação indevida. Colocá-los na taxonomia/schema próprios, sem enums inline. O mapeamento tRPC distingue conflito de atualização e pré-condição, mantendo mensagens corrigíveis.

### 5.3 Prova do conteúdo aprovado — decisão arquitetural delimitada

**Recomendação para revisão, ainda não implementada/aprovada:** adicionar ao JSON existente `profitShieldEvaluation` um marcador versionado e `approvalBasisHash`, conservando os campos atuais da avaliação para seus consumidores. O hash seria produzido somente no helper de aprovação existente, na mesma transação da mudança de estado e auditoria estrita. Excluir o próprio marcador do material hasheado para não criar referência circular.

`ApprovalBasisV1` seria a projeção exata destes grupos da seção 3.1: identidade da estimativa; apresentação; valores; contexto de cálculo (`channel`, `commercialChannel`, `region`, `zone`, `finishLevel`); `pricingSnapshot`, `metadata` e `draftData`. Não incluir notes, status, ponteiros de sucessão, campos derivados da avaliação ou datas de ciclo. A identidade cadastral exibida de projeto/cliente fica no sourceToken, enquanto seus IDs entram na base aprovada. Assim uma anotação interna não reaprova preço, e mudança de conteúdo/vínculo invalida a prova.

Essa escolha precisa de revisão da extensão do JSON e compatibilidade de consumidores. Alternativa arquitetural de armazenamento pode ser escolhida, mas o invariante não muda: deve existir uma evidência persistida vinculada aos dados aprovados; um hash calculado pela primeira vez em `prepare` não preenche a lacuna histórica.

Para F6, a correção deve alterar `updateEstimateDraftStatus` para recusar approved ou delegar ao mesmo núcleo transacional de `approveEstimateDraft`. Recomenda-se delegação para manter a intenção da rota existente. Desconto deve verificar sob lock o estado atual e qualquer evidência de aprovação/lock anterior; reabrir não deve permitir editar dinheiro de uma versão já aprovada. Rejeição/arquivamento/versionamento também precisam reler o estado depois de esperar pelo lock.

**Compatibilidade:** não reaprovar em massa, não inventar marcadores por migração, não invalidar exports legados. O bloqueio de evidência incompleta/stale é do novo percurso C-20. Um orçamento legado sem prova só passa a alimentar esse percurso após ação explícita de revisão/nova versão e aprovação coerente. A criação da nova versão deve preservar os valores e o cliente conforme seção 4.1. Prepare não chama materialização de change order, não assina contrato e não libera execução.

## 6. Bloqueios, rechecagens e testes reais pendentes

Proposta de ordem para prepare: bloquear `projects` → `estimate_drafts` → `clients`; reler o cliente a partir dos vínculos da origem/projeto já bloqueados; verificar novamente vínculos, autorização, guardas e token. Se o vínculo mudou, falhar em vez de obter silenciosamente outro conteúdo. Consultar replay concluído também depois de aguardar os bloqueios, antes das guardas que poderiam rejeitar uma operação já concluída.

Para versionamento/CO e correções de aprovação/desconto/status: projeto → origem; usar a mesma conexão/transaction para leitura decisória e gravações. Não manter transação aberta durante upload, HTTP ou materialização de campo. Não executar dentro da transação um helper que abre `getDb()` separado esperando modificar uma linha já bloqueada.

Resultados admissíveis continuam os do v3: versão primeiro recusa preparação nova do anterior; prepare primeiro congela sua origem e uma versão posterior pode existir. Mudança posterior em cliente/projeto não reescreve proposta preparada. Outro ID de requisição representa nova intenção, e replay não cria nova proposta nem exige que a origem continue elegível.

M02 prova as primitivas no PostgreSQL descartável; não prova ainda que os helpers de produto as utilizam. M10/M13 precisam testar duas conexões reais, espera observada e liberação determinística, não sleeps como prova. Incluir updates de cliente/nome/empresa, projeto/endereço/status e notes, além de versão × versão, versão × CO e CO × CO.

## 7. Consumidores de auditoria e versionamento

### 7.1 Auditoria compartilhada

`logAudit(params)` usa `getDb()`, retorna null se não há DB ou o insert falha; `withAuditLog` executa negócio e agenda audit posterior ([audit.ts:31](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/server/audit.ts#L31), [117](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/server/audit.ts#L117)). `await logAudit(...)` não torna o audit estrito quando a função engole a falha. M09 deve preservar a chamada antiga e adicionar a modalidade estrita usando exclusivamente o tx recebido.

Inventário completo dos imports diretos de `./audit` no código de aplicação desta base:

| Grupo | Consumidores |
|---|---|
| Estimativas/versões/exportação | `estimate-db.ts`, `estimate-router.ts`, `estimate-legacy-router.ts`, `estimate-version-db.ts`, `scope-to-estimate-pipeline.ts`, `jobtread-export-db.ts` |
| Cadastro/pipeline | `client-db.ts`, `project-db.ts`, `lead-conversion.ts`, `pipeline-db.ts`, `deal-db.ts` (consome `withAuditLog`) |
| Assembly/preços/geo | `assembly-db.ts`, `assembly-router.ts`, `bundle-router.ts`, `pricing-db.ts`, `pricing-router.ts`, `pricing-dimensions.ts`, `geo-db.ts`, `geo-integration.ts`, `geo-override-db.ts`, `geo-override-router.ts` |
| Escopo/remodel/desenhos | `scope-db.ts`, `scope-review-db.ts`, `scope-source-db.ts`, `scope-source-router.ts`, `scope-generation-router.ts`, `remodel-db.ts`, `remodel-router.ts`, `drawing-db.ts`, `draft-recovery-db.ts`, `rfi-db.ts` |
| Operação/aprendizado | `previsit-db.ts`, `field-operations-db.ts`, `daily-log-db.ts`, `actuals-db.ts`, `closeout-db.ts`, `subcontractor-db.ts`, `learning-layer-db.ts`, `learning-layer-router.ts`, `issue-report-router.ts`, `field-launch-router.ts` |
| Permissões/leitura | `rbac-router.ts`, `audit-router.ts` |

Todos os nomes da tabela são arquivos em `server/`. Não migrar esses consumidores em massa para falha estrita: a regressão deve confirmar o contrato antigo e habilitar tx apenas nos caminhos C-20/compartilhados explicitamente alterados.

Leitores adicionais de `auditLogs`: [field-launch-db:151](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/server/field-launch-db.ts#L151) usa padrões de action para métricas; [getRecentAuditActivity:222](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/server/field-launch-db.ts#L222) retorna linhas inteiras. O endpoint [fieldLaunch.recentActivity:108](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/server/field-launch-router.ts#L108) exige login, porém não aplica filtro de tenant ao helper. [audit-router](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/server/audit-router.ts#L6) retorna registros completos por `adminProcedure`.

**Complemento obrigatório ao desenho:** não colocar snapshots de proposta/origem em before/after genéricos. Na auditoria C-20 registrar contexto e deltas mínimos necessários; o histórico comercial faz autorização de recurso e projeção permitida. Antes de habilitar as gravações, retirar os novos eventos/tabelas de proposta da leitura genérica de Field Launch ou tornar essa leitura autorizada por tenant/recurso. Testar acesso por outro tenant e ausência de notas de decisão/custos/conteúdo interno, inclusive fora de `proposal.getById`. A solução exata desse leitor entra na revisão de M09/M16; deixar o leitor intacto e confiar na UI comercial não satisfaz isolamento.

Existe ainda [audit-trail.ts](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/server/audit-trail.ts#L1), que grava a tabela diferente `audit_log` com tenant. Seus consumidores são `tenant-settings-db.ts`, `scope-completeness-db.ts`, `price-adjustment-db.ts`, `calibration-db.ts`, `analytics-db.ts` e `audit-trail-router.ts`. Não são aliases de `audit.ts`. Esta M01 não escolhe migrar o domínio para outra trilha nem refazer o sistema de auditoria; registra a distinção para a decisão D4.

### 7.2 Versionamento e leitura da aprovação

| Consumidor | Comportamento a preservar / limite |
|---|---|
| [estimate-router:1033](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/server/estimate-router.ts#L1033) | Único import de produção do módulo de versionamento; expõe criação de versão/CO e leitura de cadeia/exportável |
| [getVersionChain:302](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/server/estimate-version-db.ts#L302) | Ativo usa status approved e ausência de supersededBy/changeOrderOf; não comprova evidência completa |
| [getExportableEstimate:340](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/server/estimate-version-db.ts#L340) | Exige approvedAt e filtra sucessão/CO; não substituir seus critérios implicitamente pelos do novo C-20 |
| [jobtread-export-db:129](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/server/jobtread-export-db.ts#L129) e [521](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/server/jobtread-export-db.ts#L521) | Consome a origem diretamente; preservar exportação existente e reconciliação; C20 usa artefato próprio |
| [field-operations-db:104](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/server/field-operations-db.ts#L104), [127](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/server/field-operations-db.ts#L127), [813](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/server/field-operations-db.ts#L813); [actuals-db:189](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/server/actuals-db.ts#L189) | Usam aprovação/versão/CO para orçamento e trabalho de campo. Não permitir que preparar/transmitir/verificar acione esses efeitos |
| [analytics-db:142](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/server/analytics-db.ts#L142), [307](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/server/analytics-db.ts#L307), [field-launch-db:131](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/server/field-launch-db.ts#L131) | Métricas leem status/ponteiros/valores; nova proposta não muda retrospectivamente o significado desses status |
| [project-access:402](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/server/project-access.ts#L402) | Resolve projeto do draft para acesso; C20 exige ainda tenant e vínculos obrigatórios e não usa fallback de criador para origem órfã |
| `EstimateDetail.tsx`, exportadores e demais telas via `estimate.getById/list/versionChain/exportableEstimate` | Consomem os resultados via router; não alterar formatos legados ao adicionar o DTO comercial |

`phase2-flow.test.ts` importa diretamente helpers de aprovação/versionamento e usa persistência simulada; seu sucesso não prova a concorrência real. `sprint20-field-launch.test.ts`, `sprint18-5-normalization-versioning.test.ts` e parte de `sprint11-5-hardening.test.ts` também verificam texto de código; preservá-los ou migrá-los com justificativa não substitui testes comportamentais novos.

## 8. Evidência de caracterização e critérios de implementação

Comando executado em 2026-09-11, neste checkout:

```sh
pnpm exec vitest run server/proposal-source-approval.test.ts
```

**Resultado: 1 arquivo, 6 testes, 6 passaram, 0 falhas; duração reportada 1,19 s.** Helpers reais com persistência/audit isolados, sem banco de produto. Os seis cenários comprovam: aprovação genérica abaixo do piso e sem evidência; rejeição dedicada dessa mesma origem; aprovação dedicada válida; archive/reopen/desconto conservando evidência velha; alteração de notes aprovada com before correto; ID inexistente sem tocar outra linha.

Os testes de caracterização que demonstram lacunas devem ser substituídos por testes das guardas aprovadas quando o runtime for corrigido. Não perpetuar a falha só para mantê-los verdes. Como não se implementou um comportamento de produto nesta M01, não há ciclo RED/GREEN de implementação reivindicado; os testes são evidência do estado anterior à correção.

Critérios TDD para os microtrabalhos futuros:

| Grupo | Casos que devem falhar antes da correção e passar depois |
|---|---|
| Aprovação existente | Mesmo resultado governado via updateStatus/approve; below-floor recusado nos dois; evidência/audit juntos; falha de audit faz rollback; desconto concorrente não passa após aprovação; reopen não libera dinheiro de versão já aprovada |
| Prova da origem | Approved sem qualquer campo obrigatório recusado; marcador ausente não inventado; valores/item/contexto/vínculo alterados com evidência antiga recusados; notes não invalidam prova de preço, mas invalidam token do preview |
| Conteúdo | Campos obrigatórios ausentes e legado draftData-only recusados; cliente divergente/nulo; custos e propriedades extras não vazam; preço/desconto preservados; itens reconciliam total sem segunda soma de montagem |
| Token | Cada coluna selecionada alterada muda token; campos explicitamente excluídos não o alteram; JSON interno aninhado entra no hash; normalização decimal/data é determinística |
| Concorrência | Cliente/projeto/notes alterados durante upload; duas ordens prepare/version; replay após lock; três combinações do alocador; rollback sem sucessor/ponteiro parcial |
| Auditoria/leitores | Modo legado mantém retorno/erro atual; modo tx propaga falha; histórico C20 não vaza via feed genérico; outro tenant sem leitura de decisão, recibo, snapshot ou artefato |
| Independência | Prepare/transmissão/decisão não aprovam orçamento, não criam CO, não materializam field tasks e não alteram aceite/liberação |

Regressão delimitada inicial: `phase2-flow`, `phase2-pipeline`, `phase2-previsit`, `sprint9-estimate`, `sprint19-pipeline-hardening`, `sprint20-field-launch`, `sprint20-1-jobtread-csv`, `sprint18-5-normalization-versioning`, `sprint11-5-hardening`, `sprint25-deal-db`, `sprint26-pipeline-db` e `sprint26-pipeline-integration`; depois `pnpm check` e suíte completa conforme manual. Não contar este inventário, testes de presença ou fixture de primitives como os 60 testes da sprint comercial.

## 9. Saída da M01 e entrada para revisão

Entregue: SHA/base, DTO finito por tabelas/colunas, matriz completa dos escritores encontrados, aliases/scripts SQL, consumidores de audit/versionamento, caracterização executável e critérios de correção. A implementação M03 em diante permanece condicionada ao checkpoint M00/M02.

Decisões específicas a consolidar sem nova auditoria global: extensão/persistência da prova de aprovação; adoção de `columns-v1` com recusa de legado incompleto; preservação de cliente/desconto na versão; lock final do cliente; proteção do feed de auditoria para novos eventos; política comercial de aditivos, moeda e reconciliação da apresentação. Todas têm proposta concreta acima e nenhuma é registrada como resposta humana inexistente.

## Correção delimitada de 18/09/2026

O candidato atual recusa `approved` pelo endpoint/helper genérico de status, preservando a aprovação dedicada. A observação histórica de aprovação genérica sem avaliação deixou de representar esse candidato; o teste local `server/proposal-source-approval.test.ts` que esperava esse sucesso não foi incorporado. Isso resolve somente o desvio específico, não prova de aprovação vinculada ao conteúdo, invalidação/versionamento, emissão comercial ou armazenamento. Os quatro executáveis de preparação task5 continuam externos a esta integração e suas contagens são históricas. Ver [contrato corrigido](../engineering/estimate-approval-entrypoint.md).
