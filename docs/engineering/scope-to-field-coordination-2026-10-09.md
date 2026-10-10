# Do escopo ao uso em campo — coordenação de 9 de outubro de 2026

**Base:** `17f27632`. **Estado: SWR-1 comprovado na homologação em `7dd40526`, com CI aprovado; nominal 0019 e identidades sintéticas novamente fechadas/retiradas.** [Prova hospedada](scope-workspace-read-hosted-proof-2026-10-09.md), [PR #45](https://github.com/wcvmsilva/structr-ai/pull/45). Uso real permanece pendente.
O [contrato SWR-1](../security/scope-workspace-read/contract-2026-10-09.md) define a leitura autenticada de um projeto e um intake conhecidos no workspace de escopo existente. A [evidência de implementação](scope-workspace-read-implementation-2026-10-09.md) registra 299 testes novos distintos, verificações e limites.
A operação consulta múltiplas fontes; ser uma query não a isenta da regra literal
F5. O responsável ratificou o adendo nominal apresentado, autorizando sua
implementação e testes. AGENTS/ADR-002 registram a substituição exata de
`db.transaction()` pela transação da Data API nessa leitura. A instalação e a
primeira tentativa hospedada estão no registro de implementação; a segunda
comprovou UI A1, RPC direta A1/A2/B1 e retirada com bearers válidos. A [ADR-003](../adr/ADR-003-pilot-financial-executor.md)
propõe o próximo pacote financeiro e aguarda ratificação.

O resultado pretendido é uma jornada hospedada delimitada, com escopo e cálculo
verificáveis, aprovação interna, documento entregue e recuperação comprovada,
antes de avaliar uso em projetos reais. Não há promessa de data.
O cadastro IF-1 e as provas já concluídas são a base; não serão refeitos como
substituto das operações seguintes. Seus limites permanecem no
[fechamento IF-1](homolog-intake-formation-proof-2026-10-09.md).

## Etapas e gates

| Etapa | Resultado mínimo e dependências | Gate para avançar |
| --- | --- | --- |
| 1. SWR-1: leitura do workspace | Concluído no recorte: `scopeGeneration.loadWorkspace` lê o par autorizado; UI A1 e recusas diretas comprovadas, sem DML das leituras. Escopos e catálogo não consultados. | Ratificação, testes e prova hospedada concluídos; janela fechada após retirada. Isso não abre os writers financeiros nem libera uso real. |
| 2. Dados sintéticos de cálculo | Delimitar assemblies, regras, componentes, preços, dimensões e contexto geográfico/comercial necessários aos casos escolhidos. | Manifesto e preparação auditada revisados; nenhuma suposição de catálogo pronto ou uso de dados reais. Identidades sintéticas inativas exigem novo ciclo nominal, não replay de reativação. |
| 3A. Ramo Scope | `scope.generate` → revisão de scope → estado `approved`/`converted` → `estimate.createFromScopeDraft`. Reutilizar os motores e endpoints existentes. | Contratos próprios de escrita e autoridade em cada transição. Aprovação de scope não é aprovação financeira; conversão em bundle não é cálculo aprovado. |
| 3B. Ramo Calculator | Seleção de assemblies → `assembly.calculateBatch` → `estimate.createFromCalculator`, para projeto autorizado. | Contrato do snapshot de cálculo e writer; persistência coerente com o cálculo protegido. Não depende de scope aprovado nem da conclusão do ramo 3A. |
| 4. Comparação financeira | Comparar valores persistidos/revisados com os casos Manus aceitos; explicitar USD, precisão, origem, canal e piso aplicável. | Reconciliação independente dos valores e contexto; nenhum total da UI ou timestamp do cliente se torna autoridade do banco. |
| 5. Decisão financeira | Revisão → `approveEstimate`; `revokeInternalApproval` preserva a evidência original. | Integração autenticada própria, autorização atual, hashes/política, locks, audit durável e recusas; leitura de revisão não autoriza decisão futura. |
| 6. Entrega e versões | Provar exportação autorizada antes de invalidar a origem por revogação/sucessão; depois provar recusas e formar versão sem decisão herdada. | Contratos próprios de exportação/redownload e `createVersion`; entrega real de artefato verificada. Versão também admite draft calculado sem aprovação: essa origem não depende da etapa 5. |
| 7. Recuperação e aceite | Fechar os cenários aplicáveis de acesso, resposta perdida, recuperação de draft e ambiente; confrontar a jornada com os critérios do operador. | Evidência hospedada, limitações remanescentes explícitas e verificação do ambiente de produção antes de liberação de projetos reais. |

As etapas 3A e 3B são ramos existentes, não uma cadeia artificial única.
SWR-1 é um incremento útil de leitura e integração visual; não resolve nem deve
atrasar a preparação independente do contrato financeiro do ramo Calculator.
A sequência de execução escolherá um ramo delimitado; não abrirá ambos por lote.

## Contratos antes dos writers

Prevalecem [AGENTS](../../AGENTS.md) e a
[ADR-002](../adr/ADR-002-pilot-authenticated-database-boundary.md).
IF-1 autoriza exclusivamente sua formação nominal e não se estende a scope,
geocode, cálculo, aprovação, versionamento, exportação ou recovery de negócio.
O adendo SWR-1 de leitura tampouco autorizará essas mutations.

Antes de qualquer grant ou ampliação da allowlist de escrita, fechar:

1. Operação nominal, comando estrito e autoridade comprovada perante o banco,
   incluindo chamadas diretas à RPC e resolução protegida de identidade/tenant.
2. Fontes e snapshot coerentes do motor existente; revalidação dos vínculos,
   política e contexto, sem confiar em valores ou hashes declarados pelo cliente.
3. Mudança, readback e audit obrigatório na mesma transação; falha aborta a unidade.
   Preservar F2/F5 ou ratificar a substituição exata antes de implementá-la.
   Uma transação Drizzle em volta de HTTP não satisfaz essa exigência.
4. Identidade, expiração e autorização atuais por tentativa/fase, após esperas;
   locks, concorrência e retry integral limitados pelo contrato da operação.
5. Replay, conflito, entrega incerta e recuperação específicos de cada operação,
   com limites/credenciais do canal definidos e nenhum segredo administrativo no web.

Não presumir que todos os helpers atuais estejam prontos para esse canal:
`scopeGeneration.sendToReview` usa `adminProcedure`; seu helper de transição
não reúne update/readback/audit numa transação e o router acrescenta audit
best-effort. Essa transição requer tratamento próprio, sem elevar o operador a
admin como atalho. O writer de Calculator persiste em transação, mas suas leituras
e cálculo anteriores não constituem por si só o snapshot protegido exigido.

## Frentes exclusivas e estado dos pedidos

| Responsável | Entrega delimitada | Estado nesta publicação |
| --- | --- | --- |
| Root / Codex integrador | Contratos, integração de autores com arquivos separados, gates, verificação final e decisões sobre ambiente. Único integrador/publicador. | SWR-1 comprovado e fechado; próxima dependência é ratificar ADR-003 para o pacote financeiro. |
| Manus | Reutilizar os pacotes aceitos e preparar o aceite financeiro da jornada, distinguindo referência de resultado executado. | Recebido, incluindo errata de sequência e dependência de versões; não executado. |
| Kimi | Oito contraprovas delimitadas do contrato, com precondição e evidência discriminante; hipóteses não equivalem a testes executados. | Oito cenários recebidos; correções L3/L4/L6/L8 confirmadas. |
| Gemini | Seis cenários de recovery com critérios observáveis, separando recuperação de acesso, de operação e de ambiente. | Seis grupos recebidos; limitações de transporte, PDF, identidade e restore confirmadas. |
| Perplexity | Três fatos oficiais pertinentes às lacunas operacionais, com fonte e limite da conclusão; sem configuração de serviços. | Recebido com quatro fontes públicas; documentação não atesta configuração hospedada. |
| Claude Code | Revisão delimitada da UI e suas dependências/capacidades; sem acesso ou alteração do repositório. | Resposta recebida via CLI isolada, sem ferramentas de repositório: dez ambiguidades e oito propostas de teste. |

Contrato/backend e preparação de UI/casos podem avançar em paralelo com donos
distintos. A UI implementada deve consumir um envelope congelado. Apenas um autor
por endpoint/migration; uma revisão independente do diff integrado por incremento.
Não duplicar implementação, reabrir pacotes aceitos ou transformar pesquisas em
aprovação de arquitetura. Root atualiza esta matriz conforme recibos verificáveis.

### Reconciliação dos pareceres recebidos

- Manus: exportar a origem aprovada antes de revogação/sucessão; a filha não herda decisão. Não exigir aprovação para toda criação de versão nem refazer a prova IF-1 encerrada.
- Kimi: par divergente e campos extras são recusados, não corrigidos/ignorados. Revogação de membership só prova perda de acesso sem outra autoridade válida no mesmo tenant. Ausência de DML exige comparação física antes/depois; tentar um writer é prova distinta.
- Gemini: consulta pode ser POST RPC com locks. PDF persistido/redownload, recuperação por e-mail e restauração/PITR não estão demonstrados; resultado incerto exige mecanismo contratado. Descritor público de sessão não prova identidade protegida.
- Claude Code: aceitar as propostas de testar vínculos, resposta parcial, sessão/cache, URL direta, disponibilidade separada e ausência de writers/listas. Não adotar textos que mandem recuperar por IDs desconhecidos ou exponham detalhes internos ao operador. Foi revisão abstrata, não inspeção de código.
- Perplexity: referências primárias [PostgREST v14](https://docs.postgrest.org/en/v14/references/transactions.html#access-mode-on-functions), [PostgreSQL 17 SELECT/locks](https://www.postgresql.org/docs/17/sql-select.html#SQL-FOR-UPDATE-SHARE), [retry de serialização](https://www.postgresql.org/docs/17/mvcc-serialization-failure-handling.html) e [sessões Supabase](https://supabase.com/docs/guides/auth/sessions). Codex abriu as três últimas; a primeira retornou HTTP 429. Versão/configuração reais ainda exigem prova local/hospedada do novo recorte.

Recibos locais desta coordenação: `/private/tmp/structr-scope-round9-20261009/`, com [índice sanitizado e hashes](scope-to-field-coordination-2026-10-09.json). Foram enviados resumos abstratos delimitados; nenhum novo arquivo privado de código, credencial ou dado de cliente foi enviado nesta rodada. Pareceres externos são insumos revisados, não achados comprovados nem testes aprovados.

A revisão independente local do SWR-1 apontou uma ambiguidade na concessão de leitura a owner/admin. O contrato foi corrigido: esses caminhos concedem leitura somente após validar identidade, tenant, projeto e integridade de membership. Nenhum outro bloqueador documental foi apontado; isso não aprova implementação futura.

### Preparação independente do Calculator

Inspeção estática adicional deixou estas dependências para o contrato financeiro seguinte, sem ampliar SWR-1:

| Dependência | Evidência no código atual e consequência |
| --- | --- |
| Catálogo autorizado ao solicitante | `assembly.calculateBatch` não usa `ctx` (`server/assembly-router.ts:357`); `getAssemblyById` busca por ID (`server/assembly-db.ts:159`) e valida cost-code/assembly, mas não caller/assembly (`:416`). O writer também consulta por ID (`server/estimate-router.ts:610`). O candidato precisa vincular todas essas fontes ao tenant protegido. |
| Fixture completa | `server/assembly-db.ts:369–436` exige calendário/Settings coerentes, componentes/unidades/tipos e exatamente um preço vigente. Os totais A/B/C sozinhos não constituem fixture de cálculo. |
| Snapshot de cálculo e política | Cada assembly usa seu próprio repeatable-read (`server/assembly-db.ts:163`), dimensões são resolvidas separadamente (`server/assembly-router.ts:396`) e persistência ocorre depois (`server/estimate-router.ts:713`). Ausência/falha de dimensão pode retornar identidade (`server/pricing-dimensions.ts:80–84`). O contrato deve definir coerência, fontes e defaults legítimos. |
| Paridade calcular/salvar | Batch aceita decimal desde 0,01 (`server/assembly-router.ts:139`); salvar aceita inteiros 1–100, no máximo 25 seleções (`server/estimate-router.ts:395–413`) e recusa assembly inativo (`:618`). `geoDimensions` participa do batch (`server/assembly-router.ts:411`), mas não do cálculo do writer (`server/estimate-router.ts:672`). Não presumir paridade geral. |
| Auditoria e resultado incerto | Persistência já exige audit na transação (`server/estimate-db.ts:141,207`), a preservar. O comando atual não define requestId (`server/estimate-router.ts:410`); idempotência/recovery precisam de contrato próprio, sem herdar IF-1. |

Essas observações não demonstram exploração na homologação: as operações continuam fechadas no canal autenticado. O próximo candidato financeiro deve tratar as lacunas antes da abertura; usar entradas compatíveis A/B/C não substitui as recusas e provas de coerência.

## Referência financeira e fechamento

A [referência Manus V2 aceita](homolog-access-coordination-2026-10-08.md#frentes-paralelas-de-8-de-outubro-insumos-recebidos)
contém A: custo $40/preço $100/margem 60%; B: $60/$90/33⅓%; C: $0,01/$0,01/0%.
A é candidata ao positivo de aprovação/exportação; B/C exercitam recusa pelo piso
aplicável de 42%. O writer atual permite draft abaixo do piso com aviso: não exigir
recusa da criação. O aceite documental não significa execução hospedada.
Recuperação por e-mail continua distinta da troca de senha em Settings já aceita;
replay de RPC não prova reenvio visual, entrega de resposta ou recuperação após reload.

Para implementação, observar RED de comportamento antes do código, GREEN focal,
regressão e revisão. Registrar tipos/build, fonte exata, testes novos distintos e
resultados físicos/hospedados separadamente; skips não contam como passes e reruns
não aumentam o total. O planejamento acima foi seguido pela implementação SWR-1 registrada separadamente; esta matriz não atesta os demais writers. Nenhum runtime financeiro ou uso de campo foi liberado.
