# Calculator — composição operacional e preflight de 13/10/2026

Estado: **composição operacional validada em laboratório; homologação hospedada não executada**.

A autorização específica do pacote foi recebida, incluindo custos, permissões e risco de logs. A instrução mais recente exige concluir a conferência OAuth **antes de gerar a credencial**. Essa condição não foi substituída por atestado genérico. O inventário de concessões da conta continuou mostrando carregamento, embora a página de preferências carregasse na mesma sessão autenticada. Não foi possível enumerar os destinatários OAuth; lista em carregamento não significa lista vazia.

## Conferências concluídas

- A árvore de `main` no commit `34a5b7654e2c75baa0d8b01f74d48118b5e27b4f` permaneceu idêntica ao candidato anterior `56a723770aa2a60b588b6d8ab37b96414c72d619`.
- Os 52 arquivos do mapa anterior conferiram, com agregado `8eb116952a6ffe5d8e08df6c790ec89bd23f30d6c7be307e31c2f40d8d3d5669`. Esse mapa não inclui os novos comandos deste incremento.
- Uma consulta hospedada com `transaction_read_only=on` conferiu os 1.047 objetos e 890 registros de superfície do manifesto anterior à contenção TEMP. Agregados `identity:sha256`, ordenados em C e separados por newline, sem newline final: objetos `c6f1d1f95f4fdd6db1e825cb45e88da4aae8c5f27505686ce7b02e5022940c1b`; superfície `7cd96f22006aa713843fbb734a925e71eceaad361767b3a414cc41aceed7f302`.
- O executor separado continuou com zero variáveis, zero deployments e proteção existente. No banco não havia schema ou roles Calculator. A leitura pontual indicou capacidade disponível; isso precisa ser repetido antes da abertura e não reserva conexões.
- Foi criada uma exportação local do commit integrado com 1.069 arquivos rastreados e os 52 pins conferidos. O gitlink antigo `.agent/superpowers` não contém arquivos exportados. O inventário completo fica fora da pasta de upload, assim como todos os arquivos privados. Não houve upload nem deployment.

Nenhuma credencial real foi gerada, nenhum add-on foi ativado e nenhuma janela financeira foi iniciada nesta conferência. Os recibos privados identificam destinos e operador; este documento público não contém seus identificadores ou segredos.

## Lacuna operacional encontrada

O `runner.ts` existente é deliberadamente somente planejamento. Os helpers de TEMP, RBAC, preparação, abertura e retirada têm transações/auditoria próprias, mas faltava uma composição executável para acioná-los e um instalador administrativo auditado das migrations 0020/0021. Reutilizar o bootstrap de laboratório no provedor não satisfaz essa necessidade.

O incremento adiciona `installer.ts` e `operation-runner.ts`, preservando os bytes SQL e todos os 52 arquivos do mapa anterior. A fonte dos novos comandos requer revisão própria; um campo `sourceCommit` é vínculo de evidência e não comprovação automática de origem Git.

## Contrato operacional

O instalador aceita somente as migrations fixas e seus hashes aprovados, principal/banco nominais e receipt exato da contenção TEMP. Aplica ambos os SQLs na mesma transação Drizzle SERIALIZABLE, registra `logAudit()` com estado anterior/posterior e verifica o readback antes do commit. A alteração de ACL aceita é exatamente a concessão CONNECT prevista na migration; não há LOGIN, criação de senha ou abertura financeira nessa etapa.

O recibo de instalação fica em `public.audit_logs`. Este comando não sincroniza os históricos de migrations do Supabase ou Drizzle; ausência nesses históricos não autoriza reaplicar SQL. A evidência auditada, o catálogo e o estado atual devem ser reconciliados antes de qualquer ação posterior.

A recuperação consulta o receipt em transação somente leitura e distingue o histórico confirmado da correspondência do estado atual. `not_observed` não prova rollback e não autoriza reenviar o escritor.

A CLI recebe apenas o caminho absoluto de um comando JSON privado, canônico, próprio, sem links e com permissões 0600/0400. O comando contém caminhos para os arquivos protegidos, nunca a senha em claro. Cada processo usa uma conexão administrativa nova, admissão explícita de até 15 minutos e saída reduzida, após encerrar a conexão. A janela financeira continua regida pelos helpers existentes; a admissão administrativa não a estende. Abertura exige receipt e geração explícitos da credencial atual.

Fases fixas: `temp`, `install`, `recover-install`, `preflight`, `prepare`, `open`, `deactivate`, `withdraw`. A CLI de credencial continua separada. Resultados incertos exigem reconciliação; não há reenvio automático da fase. `cleanup_pending` continua significando retirada pendente.

```text
node --import tsx scripts/financial-executor-homologation/operation-runner.ts /caminho/privado/comando.json
```

Esse exemplo é somente a forma de invocação. Nenhum comando pode ser executado com dados indefinidos ou a partir desta documentação sem o manifesto nominal revisado, conferência OAuth, administração protegida e demais condições do pacote autorizado.

## Validação

A execução integrada dos quatro arquivos novos passou com **73/73 testes**: 58 testes unitários/processuais e 15 testes físicos em PostgreSQL 17.11 local. Os testes verificam instalação atômica, rollback diante de falha de auditoria/migration, recuperação somente leitura, manifesto estrito, encerramento seguro do processo e o ciclo preparar → conferir → abrir → desativar → retirar. São 73 testes distintos, sem somar novamente suas execuções isoladas.

`pnpm check`, `pnpm check:financial-executor` e `pnpm check:calculator-homologation` concluíram com zero erros. A revisão independente dos sete arquivos de código/testes não encontrou bloqueadores P1/P2; o relatório local vincula os hashes finais. A suíte geral permanece obrigatória no hook de publicação e no CI; seus resultados devem ser conferidos no PR antes da integração.

Os logs RED e tentativas intermediárias ficam preservados. Uma primeira execução integrada foi recusada porque faltavam os opt-ins explícitos do laboratório; a execução final acima os forneceu e passou. Uma tentativa de TypeScript sem acesso de escrita ao cache falhou por permissão; a repetição com acesso autorizado passou. Essas tentativas não são contabilizadas como aprovações. Nenhuma prova local equivale a resultado hospedado ou aceite para projetos reais.

## Pendências externas

Concluir OAuth, confirmar disponibilidade da credencial administrativa existente em canal protegido e então fixar a janela UTC e os manifestos finais. A entrega do segredo ao Preview, deployment manual, provas autenticadas e retirada terminal continuam na sequência autorizada. A aprovação, o versionamento, a exportação e o aceite completo da jornada permanecem necessários para uso em campo.
