# Credencial Calculator — procedimento auditado, 12 de outubro de 2026

Estado da prova histórica anterior à correção de CI: implementação local revisada, com 116 testes novos distintos e 346 aprovações focais; suíte geral aprovada (8.552 aprovados/1.790 ignorados, zero falhas), Revisão independente completa até `56f6b3131868984879dd7c1d3071d2d6b8d2f832`: **READY TO MERGE para candidato local fechado**, zero bloqueios. Testes explícitos de injeção de falha fsync de arquivo/diretório ficam diferidos como P3; cronologia RED original da Task 2 não certificada. Push inicial passou check/suíte obrigatórios (8.552 aprovados/1.790 ignorados, zero falhas). [PR #52 draft](https://github.com/wcvmsilva/structr-ai/pull/52) publicada; [checks vivos da PR](https://github.com/wcvmsilva/structr-ai/pull/52/checks) são a referência de CI. Este adendo documental é posterior ao head revisado e não afirma revisão própria, CI aprovado, merge ou aceite hospedado. Nenhuma credencial hospedada foi gerada. O [registro de 12 de outubro](../../engineering/calculator-credential-2026-10-12.md) e o [mapa de evidência](credential-local-evidence-2026-10-12.json) identificam a fonte e os limites. A [ADR-003](../../adr/ADR-003-pilot-financial-executor.md) exige confirmação específica antes de credenciais ou ampliação de acesso. O [pacote de 10 de outubro](../../engineering/calculator-homologation-package-2026-10-10.md) continua descrevendo SQL/TEMP/RBAC/fixture/retirada; este incremento substitui sua pendência de desenho da credencial, não autoriza execução.

Correção corrente: `efdc929bbf1e34493f267605d234e2822d0df126` altera somente a criação do diretório temporário do helper de testes, após 11 ENOENT no [CI Linux inicial](https://github.com/wcvmsilva/structr-ai/actions/runs/38322652216). Runtime de produção permanece inalterado. Passaram localmente 44 casos não físicos, 25 físicos, repetição dos 11 processos com TMPDIR customizado e TypeScript; prova comportamental RED/GREEN de caminho canônico/modos/limpeza retida. Os resultados integrais acima são históricos; revisão da correção e CI final são gates separados, acompanhados nos [checks vivos](https://github.com/wcvmsilva/structr-ai/pull/52/checks). O mapa corrente fixa o novo pin; isso não autoriza atos hospedados.

## Fronteira operacional

Uma credencial aleatória exclusiva serve somente ao login `structr_calculator_login_v1`, no banco homologado, entregue somente ao projeto executor Preview. Nenhuma senha administrativa ou SQL entra no web, Production, Development, ambiente compartilhado ou repositório. Não usar a senha das contas A1/A2/B1: identidades Auth e login PostgreSQL são mecanismos distintos.

A geração local explícita produz 32 bytes aleatórios e um verifier SCRAM-SHA-256 com salt de 16 bytes e 4096 iterações. O arquivo exclusivo pertence ao operador local, em diretório canônico 0700 e arquivo 0600. A leitura é limitada, estável e rejeita links, substituições, permissões indevidas e metadados divergentes. Strings em JavaScript não oferecem apagamento comprovável; processos hostis com o mesmo UID estão fora dessa barreira. Não imprimir o objeto secreto nem encaminhá-lo a assistentes externos.

O artefato é persistido antes da operação de banco e conserva operationId/generationId, fixture, fonte, hash de pins públicos, destino TLS e projeto Preview. Hashes não incluem a senha nem o verifier. São identidades de integridade, não assinatura ou autorização. Falha parcial no arquivo exige inspeção protegida; nunca sobrescrever silenciosamente ou gerar outra senha sob a mesma operação.

## Transação e recuperação

O procedimento administrativo usa a conexão local protegida [connection.ts](../../../scripts/financial-executor-homologation/connection.ts): principal existente `postgres`, database/host fixos, PostgreSQL 17.11, TLS com cadeia/hostname e CA pinados, pool máximo um. Sua senha existente precisa estar disponível pelo canal protegido; este procedimento não redefine nem cria uma senha administrativa.

Provisionamento e substituição de geração só são permitidos com preparação íntegra, binding ativo, janela vigente, NOLOGIN, zero sessões e nenhuma abertura anterior. Uma troca antes da abertura exige o receipt atual exato. Depois da primeira abertura, perda/exposição ou necessidade de troca encerra o piloto pela retirada terminal existente; não há rotação a quente, retomada nem reativação do binding neste incremento.

A mutação usa transação Drizzle SERIALIZABLE real, lock administrativo compartilhado, `logAudit(..., tx)` obrigatório e readback integral. A senha em claro não é enviada em SQL. Um CALL parametrizado leva somente o verifier a uma procedure temporária SECURITY INVOKER de alvo fixo; EXECUTE PUBLIC é revogado e a procedure removida antes do COMMIT. O receipt registra apenas manifesto, geração, referência anterior, identidade administrativa e estados públicos da role. A auditoria é parte da mesma transação da alteração.

A abertura exige explicitamente o receipt e a geração atuais; não escolhe a última geração por suposição nem oferece bypass de teste. Ausência, corrupção, conflito, preparação diferente ou geração antiga recusam LOGIN. O receipt prova o ato auditado, não que nenhum administrador externo tenha alterado posteriormente a senha; autenticação SCRAM funcional é evidência separada.

Perda de resposta de COMMIT não autoriza repetir o escritor. Reconectar pela mesma factory e recuperar o receipt nominal; `not_observed` significa somente que a consulta não comprovou commit. Manter o artefato e reconciliar antes de nova decisão. Arquivo local, banco e Vercel são três fases distintas; não há transação distribuída entre eles.

## Logs nativos: risco que precisa de decisão

A aplicação elimina senha/verifier de seus resultados, erros e auditorias. Isso não garante ausência universal nos logs PostgreSQL. O destino observado usa `log_statement=ddl`, `log_destination=csvlog` e `log_lock_waits=on`; o contexto interno SPI de um ALTER ROLE pode conter o verifier quando há espera por lock ou encerramento fatal, antes que um handler PL/pgSQL possa sanitizar o erro. `log_error_verbosity=terse` não elimina esse contexto do formato CSV. Não alterar logging nem conceder poderes adicionais para produzir uma prova artificialmente limpa.

O risco é específico ao verifier SCRAM, que permanece material sensível. A senha aleatória de alta entropia, TLS verificado, validade curta e retirada reduzem o risco; não o tornam inexistente. Uma contraprova local usa somente credencial sintética e registra resultado booleano, sem publicar conteúdo de logs ou o verifier.

Antes de gerar, instalar ou entregar qualquer credencial hospedada, concluir o inventário de acessos, inclusive OAuth, OU obter atestado explícito do proprietário sobre as integrações autorizadas e o risco remanescente de acesso aos logs. O responsável também deve aceitar expressamente o perfil observado e os destinatários identificados, ou escolher outra arquitetura revisada. O atestado registra decisão humana; não prova enumeração técnica nem aceita audiência desconhecida. Sem essa condição, não gerar, instalar nem entregar; o aceite do manifesto só registra aprovação efetivamente dada.

A observação privada de 12/10 identificou um membro humano Owner, um token administrativo legado de terceiro com escopo completo e sem expiração e um conector de agente existente com acesso a logs. Nenhum Log Drain configurado foi exibido; OAuth não foi completamente enumerado. Uma lista de membros não prova exclusividade de acesso. Identidades precisas ficam no pacote privado; nenhuma revogação foi autorizada por esta documentação. No plano Pro, a [retenção publicada de logs API/banco é sete dias](https://supabase.com/pricing); isso não é garantia de apagamento de exports, backups ou outras cópias. A [documentação de logs](https://supabase.com/docs/guides/platform/manage-your-usage/logs-ingest) também adverte sobre valores sensíveis em statements.

Fundamentação técnica: [SPI error context](https://github.com/postgres/postgres/blob/REL_17_STABLE/src/backend/executor/spi.c#L2288), [lock waits](https://github.com/postgres/postgres/blob/REL_17_STABLE/src/backend/storage/lmgr/proc.c#L1475), [CSV error output](https://github.com/postgres/postgres/blob/REL_17_STABLE/src/backend/utils/error/csvlog.c#L181). A emissão automática de [OIDC Vercel](oidc-resolution-2026-10-12.md) é uma questão separada: não autentica o operador financeiro nem substitui SCRAM.

## Entrega protegida e encerramento

Após autorização específica, registrar os IDs não secretos da operação/geração/receipt. Entregar a connection string somente ao campo protegido `FINANCIAL_EXECUTOR_DATABASE_URL` do executor Preview. O responsável realiza a entrada/confirmação/submissão de credencial no navegador; nunca colar no chat, executar como argumento de shell, colocar em arquivo `.env` versionado ou obter valores via env pull. Conferir projeto, target, nome/ID/updatedAt da variável sem decriptá-la. Esses metadados não provam o valor; a sessão SCRAM nominal e o runtime aprovado o comprovam depois da abertura.

Antes de qualquer build/deploy futuro, produzir um export limpo da fonte rastreada exata e revisada, conferir os hashes de código/SQL/manifestos e inspecionar a lista completa dos arquivos destinados ao upload. Segredo administrativo, artefato de credencial, comandos protegidos e evidências privadas devem permanecer fora da raiz de upload. Exclusões locais do Git, isoladamente, não provam exclusão pelo provedor. O commit de execução pode ser posterior ao sourceCodeCommit por documentação/merge, somente com os mesmos bytes executáveis conferidos. Esta condição não autoriza deployment agora.

O deploy exato deve ser identificado e suas configurações conferidas. Um build autorizado implica OIDC automático da plataforma, sem criação de confiança externa ou uso de AI Gateway/Sandbox. Mudança de Deployment Protection e custo IPv4, se necessários, são itens nominais da confirmação; não seguem implicitamente da preparação da senha.

Ao finalizar ou abortar: desativar binding; comprovar recusa das quatro operações com bearer ainda válido; retirar LOGIN/senha/EXECUTE; encerrar sessões com PID e backend_start conferidos e intenção auditada; restaurar RBAC de O; fechar gate web e remover segredo/configuração de runtime no destino aprovado. Remover variável Vercel ou expirar senha não mata sessões existentes. Preservar receipts, drafts sintéticos e auditorias; contenção TEMP duradoura não é revertida automaticamente. Estado `cleanup_pending` não equivale a retirada concluída.

O operador da execução e o observador devem estar presentes durante toda a janela, de no máximo duas horas. Não há watchdog hospedado comprovado. Qualquer dúvida sobre commit, geração, alvo, auditoria ou acesso impede abertura ou aciona retirada. Corrupção da própria evidência financeira exige contenção separadamente revisada; não fabricar histórico para passar guards.

Uso em campo permanece dependente de homologação completa e aceite posterior de aprovação, versionamento, exportação e recuperação operacional.

## Execução em processo isolado

A mutação operacional deve usar `credential-runner.ts`. Esse processo instala handlers fatais antes de importar o driver; não executar o escritor diretamente no processo duradouro do agente. A contraprova física encontrou falha assíncrona do driver fora do catch, mesmo com fechamento correto do pool interrompido. O runner retorna somente campos públicos de um receipt, `not_observed` ou a saída fixa `{"status":"uncertain"}` com código 70. Crash, sinal e timeout não provam rollback.

Após a autorização humana e o atendimento dos gates, executar fases separadas:

1. Fixar manifesto, destino, IDs e janela; preparar o piloto usando os helpers existentes. Confirmar NOLOGIN, zero sessões e ausência de abertura anterior.
2. Planejar com `await planCalculatorCredentialArtifact({directory, metadata})` e invocar `stageCalculatorCredentialArtifact(plan)` uma única vez, em diretório protegido. O estágio não acessa o banco e não imprime senha/verifier. Em retomada, ler o mesmo artefato; nunca gerar novamente para encobrir resultado incerto.
3. Criar um comando administrativo em arquivo canônico próprio 0600/0400, sem links, com `operation: "provision"`, `manifest`, `artifactPlan`, `adminSecretFile` e `caFile`. O manifesto contém a aprovação humana efetiva do risco de logs; o comando referencia o artefato e o arquivo administrativo por caminho, sem copiar suas senhas. A forma e os campos desconhecidos são validados estritamente pelo runner.
4. Executar uma única vez o comando abaixo. Arquivar a saída pública e o código de saída; somente `committed` com receipt/geração reconciliados permite seguir para o handoff protegido. `not_observed` e `uncertain` não autorizam reenvio.
5. Realizar entrega, deployment fechado e readbacks externos. Só depois de satisfazer esses gates, `openCalculatorPilot(db, pairedManifest, {receiptId, generationId})` pode abrir o piloto durante a janela original. Essa chamada não escolhe a geração por suposição.
6. Executar e comprovar a retirada terminal ao terminar ou falhar. Fechar um handle de banco não equivale a retirar autoridade.

```sh
node --import tsx scripts/financial-executor-homologation/credential-runner.ts /caminho/privado/comando.json
```

O único argumento operacional é o caminho do comando. Não há flags de teste, alternativa de conexão por ambiente, senha nos argumentos ou repetição automática. O processo fecha sua conexão antes de reportar sucesso. O limite de 45 segundos é uma contenção do processo administrativo, não uma prorrogação da janela financeira.

### Recuperar o receipt sem reabrir o piloto

Em resultado incerto, usar um **novo processo**, com `operation: "recover"`, o mesmo manifesto, `adminSecretFile`, `caFile` e uma nova `admissionExpiresAt` UTC. Essa admissão deve terminar no futuro e em no máximo 15 minutos; serve apenas à consulta administrativa, inclusive depois do encerramento do piloto. A recuperação não lê o artefato secreto, altera senha, abre LOGIN, reativa binding ou muda a janela. O receipt recuperado pode ser histórico: o gate de abertura continua exigindo a geração atual e a janela financeira original.

A admissão de recuperação não substitui o aceite nem amplia o escopo autorizado; deve constar no registro da tentativa. `provision` e `replace` rejeitam esse campo e continuam presos à janela original. Um resultado `not_observed` só informa que a consulta não comprovou o commit; preservar o artefato e reconciliar antes de nova decisão. Uma substituição anterior à primeira abertura usa operação/geração novas, receipt anterior exato e `operation: "replace"`. Depois da primeira abertura, usar retirada terminal, nunca substituição ou retomada.

`withdrawCalculatorPilot` recebe o manifesto pareado original e não depende do arquivo com senha para retirar autoridade. A retirada precisa ser executada e comprovada mesmo quando um teste falha; fechar a conexão, remover uma variável Vercel ou expirar a senha não encerra sessões existentes.
