# Testes PostgreSQL da preparação

> **Reconciliação 18/09/2026 — PROPOSTA / EVIDÊNCIA HISTÓRICA.** Documento local task5 incorporado como planejamento atribuído, não como novo aceite de arquitetura, implementação ou liberação. O código de preparação citado não está incluído nesta integração; os comandos abaixo são instruções históricas para o pacote task5, não comandos executáveis/validados nesta árvore. O [estado atual](../engineering/current-state.md) prevalece sobre próximas ações e status antigos. Resultados e linhas de código preservam sua base temporal.


Esta fixture atende M02 da [preparação C-20/P-09](proposal-issuance-implementation-plan.md). Exercita transações e concorrência em um PostgreSQL real descartável. As tabelas de teste são experimentais: os resultados não validam o schema comercial futuro, os helpers da aplicação, F5b ou isolamento global do STRUCTR.

## Execução

Requer as dependências locais do projeto e os executáveis `initdb`, `pg_ctl` e `postgres` da mesma instalação. A descoberta usa PATH e locais convencionais do PostgreSQL 17. Para outra instalação, informar seu diretório em `STRUCTR_TEST_POSTGRES_BIN`. O comando não instala pacotes nem aceita uma URL de banco externo.

Na raiz do worktree:

```sh
pnpm exec vitest run --config vitest.postgres.config.ts
```

Com caminho explícito, por exemplo:

```sh
STRUCTR_TEST_POSTGRES_BIN=/usr/local/opt/postgresql@17/bin pnpm exec vitest run --config vitest.postgres.config.ts
```

A suíte dedicada falha explicitamente se os executáveis não existem. Ela não é coletada pelo `pnpm test` padrão; sua execução precisa constar separadamente da evidência de entrega. A configuração atual de CI permanece intacta. Rodar os dois comandos antes de concluir uma alteração nessa infraestrutura:

```sh
pnpm check
pnpm test
pnpm exec vitest run --config vitest.postgres.config.ts
```

## Isolamento e descarte

- Cada chamada cria um cluster novo em diretório temporário privado. Nenhum cluster existente é reutilizado.
- Há duas conexões de trabalho independentes e uma observadora, todas pelo socket Unix privado. TCP permanece desabilitado.
- A fixture não importa configuração do aplicativo, não lê `.env` e não usa `DATABASE_URL`. Os subprocessos recebem ambiente explícito sem credenciais da aplicação; host, porta, usuário e banco dos clientes são definidos pela fixture.
- Os testes criam suas próprias tabelas mínimas; não executam migrações, seeds ou operações de produção.
- O encerramento fecha clientes, para o processo e remove o diretório, inclusive após erro no callback. Falha ao parar o processo é reportada e o diretório é preservado para diagnóstico, em vez de apagar um cluster ainda ativo.
- Cancelamento forçado do processo executor ou encerramento do sistema não é uma garantia de `finally`; se ocorrer, conferir apenas os diretórios temporários `str-pg-*` criados por esta execução e o processo indicado neles antes de qualquer limpeza manual.

## Evidência comportamental

Os casos verificam isolamento da configuração, conexões distintas, rollback real, espera por bloqueio de linha, inserção concorrente com `ON CONFLICT` e leitura do vencedor, rollback conjunto de negócio/auditoria experimental, recusa de tenant nulo, falha explícita ao não observar um bloqueador, descarte após exceção e erro por binários ausentes.

Concorrência é sincronizada por promessas e pelo grafo de bloqueios observado com `pg_blocking_pids`, não por um tempo de espera presumido. Timeouts são limites de falha. O resultado final dos dados é verificado depois das duas transações.

O teste de falha de auditoria usa uma tabela experimental com CHECK. Ele demonstra semântica transacional do PostgreSQL; não afirma que `server/audit.ts` já participa da mesma transação do negócio.

## Diagnóstico

Se o ambiente impedir memória compartilhada ou inicialização do processo local, a execução falha com o erro de startup. Usar um ambiente de teste local que permita esses recursos; não redirecionar para o banco da aplicação, não ativar TCP e não ignorar o teste para obter resultado verde. Nenhum skip automático representa execução bem-sucedida.

Os resultados observados, contagens e limitações desta retomada ficam no [registro de execução](proposal-issuance-implementation-plan.md). Os testes de infraestrutura não contam entre os 60 testes comportamentais mínimos da futura sprint comercial.
