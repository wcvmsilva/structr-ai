# Primeira entrega do fluxo de autorização comercial

> **Reconciliação 18/09/2026 — PROPOSTA / EVIDÊNCIA HISTÓRICA.** Documento local task5 incorporado como planejamento atribuído, não como novo aceite de arquitetura, implementação ou liberação. C-20/C-21/C-22 permanecem não implementados por esta publicação; decisões ainda propostas não são promovidas a aprovadas. O [estado atual](../engineering/current-state.md) prevalece sobre próximas ações e status antigos. Resultados e linhas de código preservam sua base temporal.


**Estado:** proposta de escopo preparada em 2026-09-10 por autorização do usuário para definir a próxima entrega. Este documento não é uma aprovação de implementação, uma decisão de arquitetura ou uma atribuição de horizonte no registro canônico.

**Recomendação:** entregar primeiro a emissão rastreável de proposta a partir de orçamento aprovado (C-20), com a proveniência necessária a esse percurso (P-09). Em seguida, implementar aceite comercial (C-21) e, separadamente, autorização de execução (C-22). O fluxo completo continua sendo o objetivo; a primeira entrega tem um resultado verificável por si só.

Referências: [registro canônico](canonical-structr-truth-v1.md), especialmente §§3.2, 3.3, 3.11 e 5; [procedimento de manutenção e matriz de impacto](feature-evidence-maintenance.md); [regras de execução](../../AGENTS.md).

## Problema e evidência disponível

O operador precisa saber qual versão de uma proposta foi transmitida, a quem, quando e com qual evidência. O código examinado oferece aprovação interna de orçamento e exportações, mas isso não estabelece emissão de proposta, aceite do cliente ou autorização de execução. Sem separar esses fatos, uma representação exportada pode ser confundida com um avanço comercial que não foi demonstrado.

**Âncora da inspeção:** repositório `https://github.com/wcvmsilva/structr-ai`; `main` observada em `8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf`; registro de observação `2026-09-10T19:03:16Z`. A árvore remota `3763b0a2909cbf3c295d96b939078cb8b67d2b43` foi confirmada e é idêntica à árvore do HEAD local `91d083c2aa1e5b92c88b3a77a808f196c8d92012`. A leitura local dessas fontes representa, portanto, os mesmos bytes da main observada. Nenhuma conclusão operacional nova decorre desta inspeção estática.

| Observação | Fonte no SHA observado | Consequência para o escopo proposto |
|---|---|---|
| Existem estruturas `leadProposals`, `proposals` e `proposalAccessLog`, com campos de termos, assinatura ou arquivo | `drizzle/schema.ts:550–617` | Avaliar reaproveitamento antes de criar outro modelo; nomes e campos não comprovam o fluxo de emissão |
| Aprovação de orçamento valida transição, aplica Profit Shield e registra aprovador, horário e bloqueio da versão | `server/estimate-db.ts:488–539` | Consumir a aprovação existente; não confundi-la com emissão |
| Exportação JSON produz e armazena uma representação, com auditoria | `server/estimate-router.ts:756–778` | Exportação permanece uma operação distinta do registro de transmissão |
| Tela existente expõe exportações e aprovação | `client/src/pages/EstimateDetail.tsx:269–286, 339–343, 650–682` | Ponto de entrada candidato; não exige escolher outra navegação neste PRD |
| Controle de field launch altera configuração | `server/field-launch-router.ts:46–64` | Não reutilizar esse controle como prova de autorização de execução |
| Há proveniência parcial, mas a ligação entre `draftData` e `metadata` não está estabelecida | Registro canônico, §9, com fontes delimitadas | Verificar o percurso completo dos dados usados pela proposta; não declarar P-09 concluída |

Não há pesquisa com usuários, medidas de tempo comercial ou taxa de retrabalho fornecidas para este PRD. A prioridade acima é uma recomendação de produto baseada na lacuna do fluxo e nas regras canônicas, não uma estimativa comprovada de ganho de receita.

## Resultado da primeira entrega

Um operador autorizado consegue preparar uma proposta vinculada a uma versão aprovada do orçamento, identificar o artefato exato transmitido e registrar a transmissão com evidência. Outro operador consegue consultar essa cadeia sem reconstruí-la por suposição.

**Modo inicial recomendado, sujeito à decisão de produto:** registrar uma transmissão feita pelo canal comercial já utilizado pela equipe. A interface deve dizer “Registrar transmissão”, exigir referência à evidência e distinguir a declaração do operador de uma confirmação independente do canal. Preparar ou baixar o arquivo não registra emissão. Integração de envio automático não faz parte deste primeiro recorte.

Essa recomendação não afirma que todo comprovante é suficiente: os tipos aceitos e a autoridade que os verifica precisam ser definidos antes da implementação. Evidência não verificada deve permanecer identificada como tal; não pode virar emissão confirmada por padrão.

### Objetivos verificáveis

1. Toda emissão confirmada no escopo possui vínculo com projeto, cliente, versão aprovada, conteúdo transmitido, destinatário, horário, origem e evidência.
2. Repetir a mesma solicitação não cria uma segunda emissão lógica; um reenvio real fica distinguível do primeiro envio.
3. Preparar, exportar ou registrar transmissão não cria aceite nem libera execução.
4. Alterações posteriores de orçamento ou termos não modificam silenciosamente o conteúdo já emitido.

### Histórias prioritárias

- Como responsável comercial, quero preparar uma proposta da versão aprovada para apresentar ao cliente os valores e termos corretos.
- Como operador autorizado, quero registrar qual documento foi transmitido e seu comprovante para não depender de memória ou mensagens dispersas.
- Como responsável pelo projeto, quero distinguir preparação, transmissão pendente de verificação e emissão confirmada para saber o que realmente aconteceu.
- Como revisor, quero consultar a origem de cada fato e suas limitações para verificar a emissão sem presumir aceite ou autorização de obra.

## Requisitos P0 e critérios de aceitação

Os termos de estado abaixo descrevem comportamento de produto; não prescrevem enums, tabelas ou endpoints antes da revisão de arquitetura.

| ID | Requisito | Critério verificável |
|---|---|---|
| R1 | Preparação a partir de versão aprovada | Dado um orçamento não aprovado, a preparação para emissão é recusada com o motivo. Dada uma versão aprovada acessível ao operador, o conteúdo mantém referência inequívoca a essa versão |
| R2 | Identidade do conteúdo comercial | Dado um artefato preparado, sua consulta permite recuperar o conteúdo e os termos daquela revisão. Expiração de um link temporário não pode apagar a identidade do artefato |
| R3 | Registro de transmissão com origem explícita | Dado destinatário, canal, horário e evidência válidos segundo a política aprovada, o operador registra a transmissão. Ausência de requisito produz erro acionável; mero download não satisfaz o critério |
| R4 | Separação entre registro e verificação | Dada evidência ainda não verificada, a interface e a API preservam essa condição e identificam quem registrou o fato. A confirmação exige a regra e autoridade acordadas; não se inventam horário de verificação ou identidade do cliente |
| R5 | Repetição, reenvio e falhas | Repetir uma solicitação com a mesma identidade retorna o mesmo resultado lógico. Um novo reenvio gera um evento próprio. Falha entre etapas não deixa emissão confirmada sem seus vínculos e evidências |
| R6 | Preservação de versões | Dada uma proposta já emitida, modificar o orçamento ou termos cria uma revisão distinta; a consulta da emissão anterior continua exibindo seu conteúdo original. Concorrência entre preparação e alteração é detectada antes da confirmação |
| R7 | Acesso e auditoria | Operador sem permissão ou de outro tenant não acessa nem altera a proposta ou suas evidências. Toda mutação registra autor, ação e antes/depois; operações de banco com múltiplas etapas são transacionais |
| R8 | Independência das autorizações | Após preparar, exportar, registrar ou confirmar emissão, continuam ausentes novos registros de aceite e de autorização de execução. Testes exercitam essas consequências, além de conferir nomes de estados |
| R9 | Experiência operacional completa | A tela apresenta versão, destinatário, evidência, condição de verificação e histórico; erros indicam o que falta. O usuário consegue concluir e consultar o fluxo sem acessar o banco diretamente |
| R10 | Evidência entregue com o código | O mesmo PR contém matriz de impacto, testes relevantes, resultados reais, referências no SHA examinado e atualização delimitada das alegações afetadas. Nenhuma classificação muda automaticamente por aprovação do PR |

## Matriz inicial de impacto

Esta é uma matriz de escopo proposto, não uma declaração de dependências implementadas. Durante o desenho técnico, rastrear chamadas, dados e consumidores para confirmar inclusões e exclusões.

| Capacidade | Impacto | Comportamento ou alegação afetada | Fontes e consumidores a examinar | Evidência exigida / revisão |
|---|---|---|---|---|
| C-20 — Proposal issuance | Direto | Preparar e registrar emissão rastreável | Estruturas de proposta e percurso novo aprovado pela arquitetura | R1–R6, R9; revisão de produto e Engineering Evidence |
| P-09 — Evidence and provenance substrate | Direto e delimitado | Preservar origem, derivação, autoridade, tempos e lacunas da emissão | Produtor → armazenamento → leitor → representação | Testes do percurso e das lacunas; não implica cobertura de todo o substrato |
| C-14 — Estimating | Dependência / possível ponto de entrada | Identificar versão aprovada sem mudar sua autoridade | `estimate-db`, `estimate-router`, `EstimateDetail` | R1, R6, R8 e regressão da aprovação/Profit Shield |
| P-10 — Export and transmission | Dependência / possível extensão | Artefato e transmissão permanecem distintos | Exportadores, armazenamento e consumidores da representação | Identidade do conteúdo, falhas e não promoção por exportação |
| P-02, P-03 — Authorization / Tenancy | Transversal | Permissões e isolamento do novo percurso | `project-access`, `rbac`, `tenant-scope` e novos acessos | R7; avaliação de segurança delimitada ao percurso |
| P-05, P-06 — Audit / Data access | Transversal | Auditoria, vínculos e atomicidade | Helpers de banco, esquema, relações e auditoria | R5–R7; rastreio de consumidores de qualquer helper alterado |
| C-06, C-07 — Client / Project formation | Referências existentes | Vínculos corretos sem recriar cliente ou projeto | Identidades e permissões dos registros consumidos | Referências válidas e recusas entre tenants; nenhuma nova regra de formação |
| C-21, C-22 — Acceptance / Execution Authorization | Limite obrigatório | Emissão não cria aceite nem autoridade para executar | Transições e eventuais consumidores de status comercial | R8; permanecem entregas posteriores |
| C-33 — Baseline management | Limite e dependência futura | Vincular versão sem declarar o pacote de baselines completo | Aprovação, versionamento e referências preservadas | R6; desenho futuro do Accepted Commercial Package não é resolvido aqui |

## Fora do primeiro recorte

- Aceite digital do cliente, assinatura eletrônica e portal público: pertencem à etapa de aceite e exigem decisões próprias de identidade e evidência.
- Autorização de execução e alteração do controle field launch: a proposta emitida não libera Delivery.
- Implantação completa de baselines, Change Orders ou P-09 em toda a plataforma: o recorte cobre apenas referências e proveniência necessárias à emissão.
- Envio automático, lembretes e negociação de múltiplas opções: possíveis extensões, sem compromisso de entrega nesta unidade.
- Reclassificação global, resolução de todos os ODs ou afirmação de Production Ready: não são resultados deste PRD.

## Decisões necessárias e recomendações

Não há necessidade de resolver os quinze ODs antes de preparar esta entrega. As decisões abaixo precisam apenas do escopo suficiente para implementá-la com clareza.

| Decisão | Recomendação proposta | Quem decide / momento |
|---|---|---|
| Canal e evidência inicial | Registro de transmissão externa com evidência referenciada; distinguir declaração de confirmação; definir os comprovantes aceitos | Product Authority e responsável operacional, antes da implementação de R3/R4 |
| Quem registra e quem confirma | Permissões explícitas no tenant; nomear responsáveis humanos pela aceitação da entrega, sem resolver OD-06 globalmente | Responsável humano, antes de implementar os acessos e aprovar a entrega |
| Modelo de proposta e vínculos | Avaliar as tabelas existentes primeiro; preservar identidade do conteúdo e versão, sem escolher automaticamente uma nova tabela ou reutilização inadequada | Chief Architect, antes de schema/endpoints |
| Persistência e regras de execução | Confirmar o padrão aplicável: `AGENTS.md` descreve MySQL/mysql2, mas `drizzle/schema.ts:1–15` usa pg-core e `server/db.ts:1–8` usa postgres-js. Não introduzir outro driver nem executar migração para resolver a divergência | Chief Architect, antes do desenho de persistência; divergência factual registrada, sem alterar AGENTS.md |
| Conteúdo e evidência armazenados | Definir campos mínimos, local de retenção, acesso e verificação de integridade do artefato; não depender apenas de URL temporária | Arquitetura e responsável operacional, decisão delimitada relacionada a OD-10 |

## Sequência de execução proposta

1. **Fechar as decisões delimitadas acima e o desenho técnico.** Produzir contratos, transições, modelo lógico/físico, permissões, tratamento de falhas e mapa de arquivos; submeter à revisão do Chief Architect conforme AGENTS.md.
2. **Implementar C-20 e a proveniência necessária.** Seguir a ordem arquitetural de AGENTS.md, TDD comportamental, Zod, auditoria e transações; nenhuma rota pública de negócio. Cobrir o fluxo completo de R1–R10. Se enquadrado como sprint, cumprir o mínimo de 60 testes com a distribuição prevista no manual, além de zero regressões.
3. **Revisar a entrega no SHA exato.** Conferir código, segurança do percurso, comportamento, documentação e consumidores afetados; registrar checks reais. Uma demonstração local não equivale a validação em campo ou produção.
4. **Definir C-21.** Registrar aceite ligado ao conteúdo comercial exato e produzir o Accepted Commercial Package. A definição canônica diz que esse pacote *may reference* determinados artefatos: não transformar toda a lista em requisitos obrigatórios por inferência.
5. **Definir C-22.** Validar o pacote aceito e requisitos aplicáveis de prontidão; ativar Execution Baseline e autorizar Delivery por um evento separado. O conjunto concreto de requisitos de prontidão precisa de decisão humana antes desta etapa.

Nenhuma data ou prazo foi fornecido. Estimar a primeira implementação somente após o desenho técnico, sem adicionar as etapas 4 e 5 ao mesmo sprint por padrão.

## Medidas de sucesso

**Gate de implementação:** todos os cenários R1–R10 aprovados no escopo acordado; zero falhas nos checks exigidos; todos os casos de acesso indevido, repetição e transição indevida do conjunto de aceitação recusados corretamente. Os números são metas de teste, não resultados já obtidos.

**Piloto proposto:** acompanhar as primeiras 10 emissões durante até duas semanas após uma liberação especificamente aprovada. Meta proposta: 10/10 com versão, destinatário, origem e evidência recuperáveis, zero emissões duplicadas por repetição da mesma solicitação, zero liberações de execução decorrentes da emissão. Se o volume for menor, reportar o denominador real e não declarar a amostra concluída.

**Indicadores posteriores:** medir tempo de preparação até emissão verificável e ocorrências de reconstrução manual da evidência nos primeiros 30 dias. Esse período estabelece a baseline; não há meta percentual de redução nem promessa de impacto na receita sem dados anteriores.

## Estado desta entrega de planejamento

Foi criado apenas este PRD local. Código, schema, classificações canônicas, branch e histórico Git não foram alterados por este trabalho. A autorização para definir o escopo foi executada; as recomendações de produto e o desenho de arquitetura permanecem sujeitos às decisões indicadas. O próximo resultado concreto é o desenho técnico da primeira entrega, usando este recorte e registrando as decisões sem reabrir a revisão global das 48 capacidades.
