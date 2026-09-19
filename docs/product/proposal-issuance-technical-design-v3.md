# Desenho técnico v3 — emissão rastreável de proposta

> **Reconciliação 18/09/2026 — PROPOSTA / EVIDÊNCIA HISTÓRICA.** Documento local task5 incorporado como planejamento atribuído, não como novo aceite de arquitetura, implementação ou liberação. C-20/C-21/C-22 permanecem não implementados por esta publicação; decisões ainda propostas não são promovidas a aprovadas. O [estado atual](../engineering/current-state.md) prevalece sobre próximas ações e status antigos. Resultados e linhas de código preservam sua base temporal.


**Estado:** proposta técnica local consolidada em 2026-09-10, por autorização do usuário para avançar após a revisão do v2. Não é código implementado, aprovação de arquitetura, sprint executada ou alteração de classificação canônica.

**Escopo:** C-20 e a proveniência de P-09 necessária à emissão. Aceite comercial e autorização de execução continuam separados e fora desta implementação.

Referências: [PRD](commercial-authorization-first-delivery.md), [registro canônico](canonical-structr-truth-v1.md), [manutenção de evidências](feature-evidence-maintenance.md), [AGENTS.md](../../AGENTS.md).

## 1. Base e supersessão

Este documento consolida os contratos necessários sem depender de seções do v1. Substitui, como proposta para discussão nesta tarefa, os desenhos anexados v1/v2; os anexos permanecem históricos e não foram editados. Não afirma que arquivos em outra conversa ou uma sprint spec não fornecida tenham sido alterados.

Fonte de código examinada nas revisões: `https://github.com/wcvmsilva/structr-ai`, SHA `8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf`, árvore `3763b0a2909cbf3c295d96b939078cb8b67d2b43`, anteriormente confirmada igual à árvore local de `91d083c2aa1e5b92c88b3a77a808f196c8d92012`. A consolidação relê os trechos de versionamento e auditoria; não realiza nova inspeção global ou avaliação de produção.

Fatos relevantes: os itens carregam `unitCostSnapshot` e as montagens `unitCost` (`drizzle/schema.ts:817–843`); exportadores recebem `EstimateDraft` (`server/estimate-export.ts:104–156`); o versionador atual insere o sucessor antes de atualizar a origem (`server/estimate-version-db.ts:118–178`); `logAudit` usa `getDb` e retorna null em falhas (`server/audit.ts:31–55`); `storageGet` resolve uma URL, sem comprovar leitura dos bytes (`server/storage.ts:27–42, 96–102`). Não generalizar esses fatos para todas as mutações do repositório.

## 2. Decisões propostas e limites

| Tema | Proposta v3 | Decisão ainda necessária |
|---|---|---|
| Persistência | Novas propostas e transmissões; não reinterpretar tabelas legadas | Chief Architect aprova modelo e uso do runtime PostgreSQL observado, diante do texto divergente em AGENTS.md |
| Conteúdo comercial | Allowlist recursiva e termos explícitos na proposta | Product Authority aprova campos, condições e canal inicial |
| Verificação | Permissão separada; recomendar verificador diferente do registrador | Aprovar política e responsáveis para este percurso; não resolver OD-06 globalmente |
| Auditoria | Modo transacional estrito, compatível com assinatura antiga | Aprovação da mudança compartilhada e seu escopo de regressão |
| Armazenamento | JSON literal nesta primeira entrega; leitura dos bytes após upload | Aprovar armazenamento, acesso, retenção e tratamento de uploads órfãos para este percurso |

A aprovação para preparar este desenho não fecha automaticamente estas decisões. A escolha de JSON reduz a primeira entrega: PDF específico de proposta fica posterior, sujeito à aceitação de produto. Não reutilizar o PDF atual com campos internos nem converter o novo snapshot artificialmente em EstimateDraft.

## 3. Dados persistidos e invariantes

### commercialProposals

- `id`, `tenantId NOT NULL`, `projectId NOT NULL`, `clientId NOT NULL`, `estimateDraftId NOT NULL`, `estimateDraftVersion NOT NULL`.
- `contentSnapshot`, `internalProvenanceSnapshot`, `contentHash`, `internalSnapshotHash`, `sourceToken`, `snapshotSchemaVersion`.
- `contentArtifactKey`, `contentArtifactHash`, `contentArtifactMediaType`, `contentArtifactByteLength`, `artifactVerifiedAt`: preenchidos somente após releitura e comparação dos bytes do artefato.
- `idempotencyKey`, `requestHash`, `preparedBy`, `preparedAt`, `createdAt`, `updatedAt`, `deletedAt`.
- Unicidade de `(tenantId, idempotencyKey)` e `(tenantId, id)`. FKs e validações asseguram que projeto, cliente e orçamento pertencem ao tenant correto e ao contexto comercial selecionado. O tenant vem do contexto confiável, nunca do input.
- Não existe coluna de status comercial. Não há revisão automática da proposta: preparar outra versão gera outra proposta; a antiga permanece consultável.

Conteúdo, origem, artefato e identidade da requisição são imutáveis após inserção. Propor proteção explícita em aplicação e banco para essas colunas; não depender do bloqueio parcial dos orçamentos. A migração correspondente precisa de revisão e teste. `deletedAt` atende à convenção de soft delete, mas não haverá endpoint de exclusão nesta entrega, nem desaparecimento de evidência por cascata.

### proposalTransmissions

- `id`, `tenantId NOT NULL`, `proposalId NOT NULL`, `channel`, `recipient`, `transmittedAt`, `recordedBy`, `recordedAt`.
- `proposalArtifactHash`: copiado do artefato da proposta; a transmissão identifica exatamente o conteúdo cuja remessa está sendo declarada.
- `evidenceKind`, `evidenceRef`, `declaredEvidenceHash` opcional, `evidenceObservation` e `evidenceObservedAt` opcional.
- `verificationStatus` (`unverified`, `verified`, `disputed`), `decisionVersion`, `decisionBy`, `decidedAt`, `decisionNote`.
- `resendOfTransmissionId` opcional, `idempotencyKey`, `requestHash`, timestamps e `deletedAt` sem endpoint de exclusão nesta entrega.
- Unicidade de `(tenantId, idempotencyKey)`; FK composta `(tenantId, proposalId)` para a proposta. Reenvio referencia uma transmissão do mesmo tenant e proposta. A origem da transmissão e sua evidência não são sobrescritas; correção de fato exige outro registro e uma decisão explícita sobre o anterior.

Decisões de verificação são mutáveis sob controle de versão, com before/after na auditoria transacional. O histórico é recuperado pelo servidor autorizado, não expondo uma consulta genérica de audit_logs ao cliente.

### Tabelas legadas

`proposals`, `leadProposals` e `proposalAccessLog` ficam intactas. A v3 abandona a proposta de reinterpretar a FK de proposalAccessLog: ausência de imports não prova ausência de dados, e nullable/ON DELETE SET NULL não corrigiria referências antigas incompatíveis. Registrar acesso de leitura pelo mecanismo existente de auditoria, com IDs de contexto, sem copiar conteúdo interno para logs de acesso. Nenhum backfill, expurgo ou inspeção de dados de produção é necessário para elaborar este desenho.

## 4. Snapshot e artefato

`buildProposalContentSnapshot` recebe um DTO explícito e normalizado. Não recebe conexão, relógio ou usuário corrente e não importa o módulo de schema em runtime.

Allowlist proposta, a confirmar com Product Authority:

- Identidade: versão do schema, referência da proposta/orçamento, versão do orçamento, identificação comercial de projeto e cliente.
- Itens: descrição aprovada para apresentação, quantidade, unidade, preço unitário e indicadores tributários necessários. Nunca copiar objetos de itens por spread; excluir unitCostSnapshot, costCode e demais campos internos não aprovados.
- Montagens: nome, quantidade e preço unitário, mediante decisão de como evitar dupla apresentação/cobrança com os itens. Nunca copiar unitCost ou o objeto original inteiro.
- Preços: subtotal de venda, desconto e total de venda já aprovados; não recalcular Profit Shield ou preços durante a preparação.
- Termos: `commercialTermsText`, obrigatório no contrato proposto, armazenado na proposta; não modificar o orçamento aprovado para inserir termos. Produto deve definir o conteúdo mínimo antes de implementar.
- Notas ao cliente: campo explícito `customerNotes`, sem copiar automaticamente `draft.notes`.

O snapshot interno preserva os dados usados, incluindo referências e lacunas de pricingSnapshot/metadata. Não é usado como DTO de resposta comercial. Sua consulta depende de permissão interna específica ou permanece restrita à auditoria autorizada; `proposal:read` sozinho não o expõe.

`canonicalJsonV1` aceita apenas JSON normalizado, ordena recursivamente chaves de objetos, preserva ordem dos arrays e usa UTF-8. Rejeita undefined, ciclos, números não finitos e instâncias Date. Datas fixas admitidas pelo schema são strings ISO normalizadas; não banir genericamente timestamps. Campos gerados pelo relógio, como preparedAt, ficam fora do conteúdo hasheado. Valores monetários seguem representação decimal definida pelo DTO, sem transformação que altere preços.

`requestHash` identifica a intenção normalizada do cliente; `contentHash` identifica o conteúdo congelado. Não são intercambiáveis. A política e a versão do serializador ficam fixadas na operação, sem recalcular uma operação antiga com regras novas.

Primeiro artefato: bytes UTF-8 do JSON comercial canônico, gerados por função dedicada que recebe somente ProposalContentSnapshot. O hash do artefato deve coincidir com o hash desses bytes. Exportadores antigos continuam atendendo suas funções atuais, sem alteração de significado.

## 5. Contratos completos da API

Todos os endpoints são protegidos, validados com Zod e aplicam autorização de recurso e tenant. Inputs de enum vêm de taxonomy; normalização segue o padrão do repositório. Campos extras são rejeitados. As identidades abaixo são UUIDs; hashes são SHA-256 hex; strings têm limites explícitos no desenho de implementação.

| Endpoint | Input | Resultado / permissão |
|---|---|---|
| `proposal.previewSource` | estimateDraftId | DTO permitido de origem, versão e sourceToken; `proposal:prepare` e acesso ao orçamento |
| `proposal.prepare` | estimateDraftId, expectedSourceToken, commercialTermsText, customerNotes opcional, clientRequestId | Proposta preparada ou replay idempotente; `proposal:prepare` |
| `proposal.getById` | proposalId | Conteúdo comercial, status derivado e histórico permitido; `proposal:read` |
| `proposal.listTransmissions` | proposalId | Transmissões e decisões do mesmo recurso; `proposal:read` |
| `proposal.getArtifact` | proposalId | Download autorizado do artefato literal; `proposal:read`; falha explícita se indisponível |
| `proposal.registerTransmission` | proposalId, clientRequestId, channel, recipient, transmittedAt, evidenceKind, evidenceRef, declaredEvidenceHash opcional, resendOfTransmissionId opcional | Registro unverified; `proposal:transmit` |
| `proposal.verifyTransmission` | transmissionId, expectedDecisionVersion, decision (`verified` ou `disputed`), note obrigatória, clientRequestId | Decisão auditada; `proposal:verify` e política de atores aprovada |

`evidenceKind` é uma união discriminada entre referência externa declarada e objeto armazenado com vínculo interno autorizado. Uma string não escolhe implicitamente o tipo. Este desenho não cria upload genérico: enquanto não houver contrato aprovado para ingestão e propriedade de evidências, o primeiro canal deve usar referência externa declarada. A aceitação desse recorte é decisão de produto, e nenhum acesso a URL arbitrária fornecida pelo cliente é realizado.

Canais propostos: email, portal externo, entrega presencial, correio. Produto deve escolher os habilitados e, para cada um, os requisitos de verificação. Enum fechado não substitui essa política.

## 6. Ordem operacional e concorrência

### Preparação: rede fora de transação, validação final dentro

1. Autorizar usuário, tenant e origem. Normalizar a intenção e calcular requestHash. Consultar operação já concluída pela chave no escopo correto; autorizar também o recurso encontrado. Mesmo requestHash retorna resultado anterior; divergência retorna IDEMPOTENCY_KEY_CONFLICT. Replay não revalida o estado comercial atual de um orçamento que mudou depois do sucesso original.
2. Ler a origem candidata e verificar expectedSourceToken, aprovação e ausência de sucessor. O token cobre a identidade, estado, vínculos e todos os dados de origem usados pelos snapshots, com serialização definida; não é só version ou updatedAt.
3. Construir ambos os snapshots a partir dessa leitura, gerar os bytes comerciais e fazer upload para chave restrita ao tenant e hash dos bytes. O adapter não sobrescreve conteúdo divergente sob a mesma chave. Reler bytes por uma rota confiável, verificar resposta HTTP, tamanho e SHA-256. Timeout, conteúdo diferente ou indisponibilidade encerram a tentativa antes de inserir proposta.
4. Abrir transação curta em READ COMMITTED. Reautorizar o contexto relevante e consultar novamente uma operação concluída pela chave antes de validar o estado atual da origem; isso cobre uma chamada concorrente que concluiu desde o passo 1. Bloquear projeto e depois origem, na ordem compartilhada com o versionador, e reler seus dados. Recalcular sourceToken: divergência encerra com PROPOSAL_SOURCE_CHANGED; reprovação/sucessor têm erros próprios. Os snapshots e o artefato usados no insert têm de corresponder ao token validado, não a uma nova leitura silenciosamente substituída.
5. Inserir proposta com ON CONFLICT DO NOTHING no índice de tenant/chave. Se outra chamada ganhou, consultar a linha existente em uma nova instrução da mesma transação READ COMMITTED, conferir autorização e requestHash e retornar o resultado vencedor. Na criação efetiva, inserir auditoria estrita na mesma transação; só então confirmar.

Não usar catch de violação de unicidade seguido de SELECT na transação abortada. O protocolo usa READ COMMITTED e retries transacionais limitados para falhas recuperáveis, mantendo a mesma chave e intenção; o caso concorrente precisa de teste com duas conexões reais de teste, não apenas mocks sequenciais.

Um upload sem commit pode deixar objeto órfão. Isso é um efeito conhecido separado do banco, não uma falha de rollback. Não excluir objetos como compensação imediata: outro retry pode estar usando a mesma chave. A política operacional deve definir retenção e eventual limpeza segura; nenhuma rotina de expurgo é autorizada por este documento.

### Escritores de versão e resultados admitidos

Modificar o versionador existente, não criar uma rota paralela: leitura da origem sob bloqueio, criação do sucessor e atualização do ponteiro precisam ocorrer numa única transação. O desenho detalhado também deve proteger a alocação de versão por projeto contra chamadas concorrentes e preservar a auditoria.

Complemento do inventário de 2026-09-11: `createEstimateVersion` e `createChangeOrder` compartilham `nextVersionForProject` em `server/estimate-version-db.ts`. O protocolo de alocação por projeto deve abranger ambos. Testar versão × versão, versão × change order e change order × change order; a criação de change order não deve passar a superseder a origem como efeito dessa correção.

Ordem de bloqueios consistente: primeiro o recurso de projeto quando necessário à alocação de versão, depois a origem; a implementação deve documentar essa ordem entre os caminhos afetados para evitar inversões. A preparação valida novamente seus dados após adquirir os bloqueios necessários.

- Se versionar confirmar primeiro, uma nova preparação da origem supersedida é recusada.
- Se preparar confirmar primeiro, a proposta permanece ligada à origem congelada; versionar pode confirmar depois. Não prometer que o segundo sempre falha.
- Se a origem mudar entre geração do artefato e validação final, a preparação falha sem linha comercial confirmada.
- Alterações futuras de uma proposta já preparada exigem outra preparação; não reescrever a proposta antiga nem redirecionar suas transmissões.

Essa mudança adiciona `estimate-version-db.ts` ao escopo e à matriz de regressão. Outros escritores dos dados cobertos pelo token devem ser inventariados antes da implementação; nenhuma alegação de serialização global deriva apenas de um FOR UPDATE em prepare.

### Idempotência das demais operações

Transmissão usa requestHash sobre proposalId, canal, destinatário, horário declarado normalizado, referência/tipo/hash declarado de evidência e vínculo de reenvio. Replay com conteúdo divergente falha mesmo quando o conteúdo da proposta é igual. Tenant é obrigatório em ambas as tabelas.

Verificação precisa preservar o resultado de retries mesmo após decisões posteriores. Propor uma tabela de recibos de operação para decisões, com `(tenantId, operation, clientRequestId)` único, requestHash, identidade do recurso e resultado mínimo, inseridos na mesma transação da decisão e auditoria. A verificação bloqueia a transmissão e compara expectedDecisionVersion; uma decisão concorrente com outra chave exige nova leitura. Um replay retorna o recibo original, distinguindo-o do estado atual. Essa tabela e sua retenção devem constar da revisão de schema.

## 7. Emissão, evidência e auditoria

Estado derivado: sem transmissões → prepared; alguma verified → transmission_verified; todas disputed → transmission_disputed; demais combinações → transmission_recorded. A consulta usa as transmissões autorizadas da proposta e o estado atual de suas decisões. Uma decisão contestada continua visível no histórico; não apagar a decisão anterior.

`verificationStatus` indica a avaliação da alegação de transmissão. Nunca promove `declaredEvidenceHash` a hash calculado pelo sistema. Observações sobre arquivo têm dimensões próprias: declarado, leitura observada ou integridade calculada, com responsável e horário reais. Referência externa opaca permanece declarada enquanto não existir uma verificação definida; não inventar teste automático de existência para message-id.

Para objetos armazenados, resolver URL é apenas obter um endereço. Um adapter de leitura precisa conferir resposta HTTP, acesso ao objeto pelo tenant e recurso, e leitura efetiva quando essa observação for reivindicada. A primeira implementação não deve anunciar essas garantias para um caminho que ainda não implementou. Aprovar a política de verificação humana antes de habilitar decisões verified.

Auditoria: `logAudit(params, tx)` usa somente o tx recebido, faz await da inserção e propaga qualquer falha. Não retorna null no modo estrito. A assinatura sem tx mantém comportamento atual para compatibilidade. Testes cobrem falha de auditoria desfazendo negócio, falha de negócio desfazendo auditoria e preservação do comportamento legado. Esta proposta não afirma que todo o resto do repositório carece de auditoria transacional.

## 8. Mapa de implementação e regressão

| Superfície | Trabalho proposto |
|---|---|
| schema, relations e migração revisada | Propostas, transmissões, recibos de decisão, índices, FKs, proteção de conteúdo e soft-delete; sem modificar tabelas legadas de propostas |
| taxonomy / normalization | Vocabulários distintos dos canais comerciais de precificação; inputs normalizados |
| shared/proposal-engine.ts | DTOs permitidos, snapshots, serialização/hash, estado derivado e validações puras |
| server/proposal-db.ts | Operações transacionais, replays, autorizações de recurso e histórico |
| server/proposal-router.ts | Sete contratos da seção 5, Zod e permissões explícitas |
| server/proposal-artifact.ts (novo) | Bytes JSON a partir do snapshot permitido; integração de escrita/leitura de artefato; não reutilizar exportadores de EstimateDraft |
| server/audit.ts | Modo tx estrito; regressão dos consumidores existentes |
| server/estimate-version-db.ts | Transação e bloqueios consistentes; preservar comportamento de versionamento e consumidores |
| project-access / rbac / seed de permissões | Resolver proposta e transmissão para projeto; concessões mínimas aprovadas; sem permissões implícitas |
| routers / App / DashboardLayout | Montagem, rota lazy-loaded e navegação conforme AGENTS.md |
| EstimateDetail / ProposalDetail | Preparar, registrar, decidir, consultar histórico e baixar conteúdo permitido; copy deixa aprovação interna explícita |
| Testes | ≥20 engine, ≥20 DB, ≥15 router e ≥5 integração, comportamentais; TDD e zero regressões |
| Documentação | Matriz C-20/P-09, C-14/P-10, P-02/P-03/P-05/P-06, referências C-06/C-07 e limites C-21/C-22/C-33; evidências no SHA resultante |

O `getById` não retorna internalProvenanceSnapshot ou payload bruto da auditoria. Logs de leitura contêm apenas identificadores necessários. Não há endpoint de aceite ou liberação de execução.

## 9. Critérios para decompor e validar a sprint

| Critério | Casos obrigatórios |
|---|---|
| Conteúdo permitido | Custos aninhados, campos extras e notas internas não aparecem no snapshot público nem no download |
| Serialização | Chaves em ordens diferentes produzem os mesmos bytes; datas fixas normalizadas são estáveis; valores inválidos falham; releitura persistida mantém o hash |
| Storage | Upload falha; download responde erro; bytes divergem; URL expira; banco falha após upload; retry concorrente não sobrescreve artefato vencedor |
| Concorrência | Ambas as ordens prepare/version; fonte alterada durante upload; duas versões concorrentes; nenhuma linha de sucessor parcialmente confirmada |
| Idempotência | Duas conexões com mesma chave; payload diferente; tenants diferentes; tenant ausente recusado; replay após supersessão e após decisão posterior |
| Decisões | Verified → disputed; múltiplas transmissões; duas decisões concorrentes; ator não permitido; hash declarado continua declarado após verificação da transmissão |
| Atomicidade | Falha de audit desfaz negócio; falha de negócio desfaz audit e recibo; chamadas sem tx preservam contrato legado |
| Isolamento | Proposta, transmissão, reenvio, replay e download de outro contexto são recusados; dados internos não vazam por resposta ou histórico |
| Independência | Operações comerciais não geram aceite, não alteram field launch nem autorizam Delivery; observar efeitos reais disponíveis, não tabelas futuras |
| Entrega | Checks exigidos, matriz atualizada, revisão por pessoa/agente diferente do autor no SHA exato; promoção de dimensão exige decisão própria |

Antes da decomposição executável, confirmar as escolhas de produto da seção 2 e revisar conjuntamente schema, contratos e protocolo de concorrência. O conteúdo deste documento permite essa decisão em um único pacote; não requer outra reverificação global das 48 capacidades. Não há prazo, número de sprint ou permissão de commit/publicação inferidos.
