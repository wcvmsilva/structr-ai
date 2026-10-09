# IF-1: reconciliação F2/F5 do cadastro — 9 de outubro de 2026

> **Continuação nominal:** a [prova IF-1](homolog-intake-formation-proof-2026-10-09.md)
> registra a promoção revisada `a54e…91b75`, com preflight ajustado por autorização
> explícita somente para homologação. O candidato `135c…db5a0` e os resultados
> desta decisão permanecem históricos. O novo registro identifica a revisão e
> os testes adicionais; não se transfere aprovação automaticamente por analogia.

**Decisão técnica:** aceitar a exceção nominal IF-1 no AGENTS para
`intake.create(newProject)` pela Data API autenticada; cadastro continua fechado.
**Base de revisão:** `982ba7469b263669cb906f33370e0a81ee83bedd` (PR #40).
**Integrador e responsável pela consolidação:** Codex, por delegação do responsável
do projeto nesta conversa. Os assistentes fornecem pareceres; não concedem
permissão de implantação nem aprovação do piloto.

## Pedido e alcance da decisão

Em 9 de outubro, o responsável informou que criou as três contas e pediu
explicitamente resolver a diferença entre o executor SQL do cadastro e os métodos
TypeScript exigidos por F2/F5, orquestrando Manus, Kimi, Gemini, Perplexity e
Claude Code. Essa instrução autoriza a reconciliação documentada, não atesta
execução hospedada nem aceite de projetos reais. A autorização prévia de integração
validada à main permanece aplicável ao incremento documental.

Houve autorização específica adicional para enviar ao Claude Code seis arquivos
privados: AGENTS, ADR-002, contrato, candidato SQL e as duas suítes físicas; Manus,
Kimi e Gemini receberam apenas trechos das regras/contrato. Perplexity recebeu
perguntas técnicas públicas. Não foram compartilhados segredos ou dados de clientes.
A primeira tentativa de envio ao Claude foi bloqueada pela revisão automática;
o envio só começou após essa autorização específica do responsável.

F2 dizia **“EVERY mutation calls `withAuditLog()` or `logAudit()`”**; F5 dizia
**“ALL multi-step DB operations use `db.transaction()`”**. A arquitetura também
exigia **“ALL mutations wrapped in withAuditLog()”**. O item 10 do ADR-002 exige
mudança, readback e audit durável na mesma transação e a fronteira aprovada impede
credencial SQL no web. A exceção IF-1 reconcilia os três textos, conservando as
obrigações de integridade. Não reinterpreta silenciosamente as regras gerais.

## Solução adotada e alternativas descartadas

O [AGENTS IF-1](../../AGENTS.md#if-1--authenticated-intake-formation-only) é a regra
normativa. O [contrato](../security/intake-formation/contract-2026-10-08.md)
identifica `POST public.structr_intake_create_v1(preimage text)` e o candidato:

`135c5200dbcc32b0653d54f17721659dbf34ef2f747666640d28c6b8e49db5a0`.

Somente essa formação pode satisfazer a exigência de mecanismo por três audits
SQL obrigatórios e a transação PostgreSQL única autenticada, SERIALIZABLE e
read-write efetivamente conferida. Mudança, auditoria e readback completo dos
novos registros permanecem anteriores ao commit. Ausência, supressão, alteração
ou falha dos audits/readbacks aborta toda a formação. `before=null` corresponde
a criação, não à omissão de um estado anterior existente.

Replay exige autorização atual e o fingerprint dos bytes originais sob a mesma
chave global; retorna o intake atual sem nova formação nem audits duplicados de
criação. Não promete entrega da resposta, recuperação após reload, exactly-once
ou compensação após commit. O replay não revalida os snapshots originais; isso não autoriza alteração de
audits nem modifica seus contratos. O caminho de
recuperação depende de autorização atual e disponibilidade do mesmo comando.

| Alternativa | Resolução |
| --- | --- |
| Exceção nomeada IF-1 com mecanismo SQL comprovado | Adotada somente para esse RPC, operação e artefato. |
| `db.transaction()` ao redor de HTTP | Não engloba a transação remota; rollback local não desfaz o commit do RPC. Não adotada. |
| Chamar helpers TypeScript vazios ou auditar após o RPC | Não torna audit e negócio atômicos. Não adotada. |
| Restaurar SQL/service role ao web para usar o helper direto | Contraria a fronteira ADR-002; exigiria outra arquitetura. Não adotada. |
| Permitir equivalência genérica para qualquer writer Data API | Amplia indevidamente a decisão; não adotada. |

Os métodos diretos continuam com seus contratos. IF-1 não inclui cadastro em
cliente/projeto/lead já existente, geocoding, provisioning, membership, scope,
financeiro, aprovação, versão, exportação ou outra RPC. Não herda a exceção
administrativa dos dois artefatos antigos nem a exceção do evento operacional
`estimate_viewed`. Não transforma toda auditoria de consulta em best-effort.

O SQL fica byte a byte preservado e fora do journal. Seus comentários iniciais
registram a pendência existente quando foi congelado; a disposição normativa
atual é a deste documento e do contrato atualizado. Mudança futura de bytes
requer revisão e evidência renovadas, sem afirmar que mudança só de comentário
altera a semântica executada. Nenhum artefato diferente é aprovado por analogia.

## Equipe e reconciliação das entregas

| Frente | Entrega e tratamento |
| --- | --- |
| [Manus](https://manus.im/app/78QH93ZwrRaLy9GpVtm8jr) | Seis critérios distinguem decisão, integração, atomicidade, replay, homologação e campo. Reutiliza os casos anteriores; não fez novo ZIP ou execução. Seus estados “não executado” são tratados como ausência de prova operacional hospedada, sem apagar a evidência local existente. |
| [Kimi](https://www.kimi.ai/chat/1a0da05b-ad42-85a8-8000-09e763a0acd7) | Seis riscos de redação. Incorporados limites de artefato, audit obrigatório, readback pré-commit e resultado incerto. A alegação de teste de exaustão faltante foi recusada: o teste já existe, e Kimi não leu código. Não se introduz logging por tentativa ou promessa de recuperação universal. |
| [Gemini](https://gemini.google.com/app/8c135063b3caad1c) | Recomenda exceção restrita e rejeita transação fictícia ao redor de HTTP. Sua primeira redação ampliava arquitetura/F5 a outras operações ADR-002; foi restringida pelo integrador a IF-1. Allowlist sozinha não é liberação. |
| [Perplexity](https://www.perplexity.ai/computer/tasks/7590945f-aa05-4b83-a186-f57e7be0e7a2) | Pesquisa pública de transações, exceções, retries e owners. Fontes conferidas pelo integrador também na versão PostgreSQL 17. Não prova configuração hospedada nem introduz consulta por transaction ID na aplicação. |
| Claude Code | Revisão estática dos seis arquivos numerados concluída: recomenda ACCEPT NARROW RECONCILIATION, apenas arquitetura. Não executou testes. Apontamentos confrontados com o repositório completo pelo integrador; limitações do pacote não viram automaticamente bloqueadores do produto. |
| Revisores locais independentes | Confirmaram a divergência literal, a equivalência delimitada sustentada no SQL/testes e a necessidade de cobrir a frase da arquitetura. Nenhum bloqueador adicional identificado nessa análise; não é prova hospedada. |

Os registros locais de prompts, respostas e capturas ficam em
`/private/tmp/structr-field-round5-20261009/`. Pareceres abstratos não são achados
de código, e parecer favorável não substitui evidência de execução.

## Triagem do parecer Claude Code

A CLI oficial concluiu uma análise estática em 384,94 segundos, uma rodada,
`is_error=false`, sem ferramentas disponíveis ou permissões negadas nessa execução.
O parecer recomenda **ACCEPT NARROW RECONCILIATION** apenas para arquitetura. Sua
lista adicional foi conferida contra o repositório completo, pois os seis arquivos
não incluíam helper direto, schema Node, decoder ou todos os testes. Não se adota
sua afirmação genérica de mecanismo “estritamente mais forte”, nem sua promessa
de exactly-once. A formação contém três linhas de negócio e três audits.

| Item do parecer | Triagem com evidência real |
| --- | --- |
| 1. Campos opcionais omitidos divergem | Falso positivo: o [helper direto](../../server/intake-db.ts#L133) também armazena `area/condition/notes` como null. A [fixture física](../../server/test-support/adr002-intake-formation-fixtures.ts#L17) omite os três e a [paridade entre caminhos](../../server/adr002-intake-formation-physical.test.ts#L235) compara formData. |
| 2. COALESCE inalcançável/schema só em prosa | Premissa incorreta: `.optional()` permite ausência; `.nullish()` permite null nos campos previstos. [Schema real](../../shared/intake-formation-engine.ts#L27). Corpus gerado mais amplo é sugestão de manutenção, não defeito demonstrado ou novo requisito desta decisão. |
| 3. Isolamento hospedado pode degradar silenciosamente | Prova hospedada continua necessária, mas [review_claims_v1](../../drizzle/0015_authenticated_review_boundary.sql#L213) recusa isolamento diferente antes do DML. Falta de suporte causa recusa; não execução silenciosa em isolamento mais fraco. |
| 4. Falta golden-bytes/CI físico | O [teste literal de bytes e SHA-256](../../server/adr002-intake-formation-engine.test.ts#L27) já existe. CI comum ignora suítes físicas, limitação preservada. Esta rodada reexecutou os 87 casos; uma lane física contínua é melhoria proposta, não implementação ou gate novo presumido. |
| 5. Decoder/transporte não verificáveis no pacote | Limite da revisão externa, não ausência no repo: [decoder](../../server/authenticated-intake-create.ts#L17), [negativos do envelope](../../server/adr002-intake-formation-decoders.test.ts#L84) e testes de transporte existem. A integração real continua pendente. |
| 6. Baseline RLS conflita com H1 | As nove relações da formação não são as tabelas de evidência H1. [0015](../../drizzle/0015_authenticated_review_boundary.sql#L71) mantém essas exigências separadas. Compatibilidade do destino e revisão de DDL posterior seguem necessárias; não se abre RLS por analogia. |
| 7. Captura de timeout e log de MESSAGE_TEXT | PostgreSQL documenta que `OTHERS` exclui QUERY_CANCELED; a afirmação sobre reescrever `57014` é falsa. Logs de mensagem bruta podem conter dados; não foram adicionados. Diagnóstico limitado a códigos pode ser estudado separadamente. |
| 8. Trocar containment por igualdade | A evidência capturada tem três objetos e a iteração compara um: trocar `@>` por `=` recusaria formações válidas. [SQL](../security/intake-formation/0018_authenticated_intake_formation.candidate.sql#L323) já confere cada evento/snapshot e a contagem. Não adotado. |

Nenhum defeito de execução foi demonstrado por esses itens após a triagem. Isso
não transforma revisão estática em prova hospedada. O integrador preserva os
requisitos existentes de instalação, integração e testes no ambiente, sem
converter limitações do pacote ou sugestões opcionais em novas autorizações.

## Evidência verificável do mecanismo

| Obrigação | Implementação e teste existentes |
| --- | --- |
| Três audits completos e distintos | [SQL 251–331](../security/intake-formation/0018_authenticated_intake_formation.candidate.sql#L251); [comparação independente das projeções Drizzle](../../server/adr002-intake-formation-physical.test.ts#L43). |
| Negócio/audit/readback na mesma transação | [corpo fixo e rethrow](../security/intake-formation/0018_authenticated_intake_formation.candidate.sql#L218); [runtime exige isolamento e escrita](../../drizzle/0015_authenticated_review_boundary.sql#L213); [falhas/tamper com contagens preservadas](../../server/adr002-intake-formation-physical.test.ts#L150). |
| Barreira de constraints e readback final | [SQL 313–335](../security/intake-formation/0018_authenticated_intake_formation.candidate.sql#L313); [trigger tardio desfaz formação inteira](../../server/adr002-intake-formation-physical.test.ts#L209). |
| Replay atual sem duplicação e conflito de chave | [SQL 232–246](../security/intake-formation/0018_authenticated_intake_formation.candidate.sql#L232); [replay e evolução legítima](../../server/adr002-intake-formation-physical.test.ts#L75); [concorrência/40001](../../server/adr002-intake-formation-physical.test.ts#L260). |
| Resposta perdida e retry limitado | [ensaio real após commit](../../server/adr002-intake-formation-physical.test.ts#L338); [limite/bytes do transporte](../../server/adr002-intake-formation-transport.test.ts#L108). |
| Identidade e autoridade mínima | [SQL protegido](../security/intake-formation/0018_authenticated_intake_formation.candidate.sql#L218); [instalação não-superuser e delta de ACL](../../server/adr002-intake-formation-migration-physical.test.ts#L116). |

**Reexecução desta rodada:** dois arquivos, **87 aprovados, zero falhas, zero
ignorados**, 28,43 segundos: 67 de comportamento físico e 20 do ciclo de migração.
São testes existentes, não 87 novos casos. PostgreSQL 17.11 e PostgREST 16.4 no
laboratório próprio, sem URL de banco remoto ou credenciais herdadas. Os hashes
dos cinco artefatos executáveis congelados coincidem antes/depois.

Os diretórios `structr-app-principal-pg-TsYaqj` e
`structr-app-principal-pg-6ee9p9` foram removidos, conforme o teardown e a conferência
independente no filesystem. A primeira tentativa parou por EPERM na preparação
Vite do worktree, sem executar testes; a execução autorizada seguinte passou.
Não se afirma inventário independente de processos, que não estava disponível.
Logs: `physical-tests.log`, `physical-cleanup-and-hashes.json` e
`physical-tests-sandbox-startup.log` no diretório desta rodada.

## Fontes primárias e limites

[PostgREST Transactions](https://docs.postgrest.org/en/v14/references/transactions.html)
documenta uma transação por requisição, POST VOLATILE read-write, isolamento e
rollback por erro. Isso não prova que a instância hospedada usa a versão/configuração
adequada. O laboratório usa 16.4; a documentação pesquisada é v14.
[PostgreSQL 17: tratamento de erros](https://www.postgresql.org/docs/17/plpgsql-control-structures.html#PLPGSQL-ERROR-TRAPPING)
distingue erro propagado de exceção capturada em bloco; o candidato relança erros,
sem transformar falha parcial em sucesso.
[Retries de serialização](https://www.postgresql.org/docs/17/mvcc-serialization-failure-handling.html)
exigem repetir a transação completa; a lista e o limite de tentativas são do
contrato da aplicação.
[RLS](https://www.postgresql.org/docs/17/ddl-rowsecurity.html) e
[SECURITY DEFINER](https://www.postgresql.org/docs/17/sql-createfunction.html#SQL-CREATEFUNCTION-SECURITY)
não autorizam presumir isolamento só pelo papel NOBYPASSRLS: RLS precisa estar
habilitada onde aplicável, e identidade/ACL/autorização do executor precisam de
prova própria. O candidato suporta a baseline contida descrita no contrato,
sem habilitar ou alterar RLS por esta decisão.

## Estado das contas e próxima execução

Consulta restrita ao Auth da homologação confirmou A1/A2/B1: três correspondências,
todas com `email_confirmed_at IS NOT NULL` e `deleted_at IS NULL`. Não foram lidos
hashes de senha, tokens ou sessões. Isso comprova existência/confirmação dessas
contas, não senha funcional, login, vínculo com perfil, papel, membership ou
isolamento entre organizações. Não se publica o identificador Auth das contas.

1. Concluir a via administrativa fora do web para aplicar bootstrap/fixture com
   Drizzle e auditoria, verificando o destino antes de escrever. A CLI oferece plan/validate e renderer sql offline,
   mas não dispõe de comando apply/execução Drizzle. IF-1 não autoriza um executor SQL administrativo diferente.
2. Comprovar sessões sintéticas, leitura positiva e recusas/revogação entre A1/A2/B1
   no ambiente hospedado, com papéis adequados a cada caso. Cadastro Auth não
   concede por si só vínculo, privilégios ou autorização de produto.
3. Integrar somente o ramo novo no endpoint existente, com validação Zod, comando
   estável, transporte/decoder e gate fechado por padrão; não deixar executar o
   geocoding legado que hoje segue a formação no router. Integrar UI de envio,
   recibo, resultado incerto e descarte de respostas de identidade anterior.
4. Revisar os bytes finais e a implantação nominal no journal, conferir baseline/
   privilégios/versão/isolation do destino e provar formação, rollback e replay
   autenticados com dados sintéticos. Aplicação de migration/grants e abertura
   controlada exigem registro próprio de ambiente e resultado; não são feitas aqui.
5. Implementar/provar os recortes financeiros restantes, aprovação, versão,
   exportação, comparação independente e recuperação. Só a jornada aplicável
   completa sustenta decisão de campo.

Esta é uma reconciliação de arquitetura/documentação, não sprint de domínio:
nenhuma tabela, função de negócio, endpoint ou migration foi criada/alterada,
e nenhum teste foi acrescentado. A configuração Vercel apenas desativa deploy
para a branch desta decisão. Não houve alteração de dados/grants/serviços,
publicação de preview ou produção, nem liberação para projetos reais nesta rodada.
A verificação integrada e o recibo de CI/main acompanham a PR.
