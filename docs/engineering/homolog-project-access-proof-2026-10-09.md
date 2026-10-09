# Prova hospedada de acesso ao projeto — 9 de outubro de 2026

## Recorte e estado

A PR #42 foi integrada à `main` em `de6b4f3f43f12fb9f59862420037e5c5b02aeba1`.
O bootstrap hospedado criou duas organizações e três perfis sintéticos, com
seis auditorias e replay sem duplicação. As três contas A1/A2/B1 passaram login
real e resolução do perfil protegido; a duração observada dos tokens foi 600
segundos. [Recibo dos três acessos](https://github.com/wcvmsilva/structr-ai/pull/42#issuecomment-6086295890).
Isso encerra a pendência de senha de A2, mas não prova acesso a dados de negócio.

Este incremento conectou a fixture administrativa já revisada ao executor com
TLS e destino fixos. A prova hospedada terminou aprovada às **18:13:15 UTC**;
o readback independente das **18:13:37 UTC** confirmou a retirada e a preservação
do operador. [PR #43](https://github.com/wcvmsilva/structr-ai/pull/43) acompanha
publicação e integração. Não há novo domínio, endpoint, migration, grant, motor
financeiro ou alteração do candidato IF-1.

## Responsabilidades e sequência executada

Codex é o único executor das alterações hospedadas e da integração. Um agente
implementa o runner e seus testes; outro revisa o contrato e prepara a prova
pública de acesso em processo separado. Os pacotes de Manus, Kimi, Gemini,
Perplexity e Claude permanecem insumos das rodadas anteriores; nenhuma nova
execução desses serviços é atribuída a esta rodada.

1. Validar os comandos administrativos com RED/GREEN, banco local descartável,
   tipos, regressão, build e revisão independente; congelar o commit executável.
2. Criar C/P/D/M com o manifesto privado fixo e repetir a mesma operação para
   comprovar ausência de duplicação. Comparar as linhas e auditorias hospedadas.
3. Usar apenas configuração pública e senhas sintéticas no processo de leitura;
   autenticar A1/A2/B1 e chamar os transportes e decoders reais do produto.
4. Retirar a autoridade das três contas no processo administrativo separado;
   repetir as chamadas com os mesmos bearers ainda válidos, antes de logout.
5. Preservar fixture e histórico, verificar replay da retirada e registrar os
   resultados sanitizados. A conta humana O permanece fora dos alvos.

## Critérios observáveis

| Conta | Antes da retirada | Depois, com o mesmo bearer válido |
| --- | --- | --- |
| A1, proprietária em A | Sessão válida, leitura de D e aprovação com estado `none` | Sessão e ambas as leituras recusadas com SQLSTATE `42501` |
| A2, `viewer` de P em A | Mesmas leituras permitidas, sem concessão de escrita | Sessão e ambas as leituras recusadas com SQLSTATE `42501` |
| B1, organização B | Sessão válida; draft `FORBIDDEN`; aprovação `NOT_FOUND` | Sessão e ambas as leituras recusadas com SQLSTATE `42501` |

A fixture contém um cliente, um projeto, um draft vazio sem preço e uma
associação de leitura: quatro linhas e cinco auditorias na criação. A retirada
desativa três perfis e duas organizações, registra seis auditorias e preserva as
quatro linhas de negócio. O manifesto externo identifica o novo executor; o
manifesto de identidade aninhado conserva o commit histórico `8e349d472f5b16494350b1dd26ccc039a9580d21`
e o hash `fa679ae71386e7bf28b2bb5f0640bd70f67fef7c5a43e1ec9e67cd4ccd9cfa18`.

Antes e depois da retirada, `Auth.getUser` e a validade temporal são conferidos
separadamente. A prova não pode usar expiração ou logout para explicar a recusa.
As chamadas de negócio pós-retirada são feitas mesmo quando a sessão já foi
recusada. Senhas, bearers e credenciais SQL não entram nos recibos ou no Git.

## Validação do executor

O RED reproduziu as recusas dos comandos ausentes. Após implementação, passaram
77 testes offline e 17 físicos em PostgreSQL local descartável: 94 casos
distintos, dos quais 32 novos (21 offline e 11 físicos). Os físicos exercitam
criação, replay, retirada, preservação histórica, conflito, drift e rollback
após falha tardia da auditoria. Verificam opções TLS, sem atestar TLS hospedado.
O typecheck explícito do script passou; o `tsconfig` geral exclui `scripts`.
Tipos gerais e build Vercel passaram. O hook obrigatório de publicação passou
7.610 testes, com 1.295 ignorados e zero falhas, em 218 arquivos aprovados e 42
ignorados. Os 17 físicos acima são separados dos ignorados desse comando.
A revisão independente do runner não encontrou bloqueadores. O build em sandbox
e a primeira gravação do cache de tipos falharam por permissão de filesystem;
as execuções autorizadas seguintes passaram, sem alterar código para contornar
os checks. Os logs dessas tentativas foram preservados.

O [CI do commit executado](https://github.com/wcvmsilva/structr-ai/actions/runs/37971492403)
também passou. O estado final da PR e o CI de `main` devem ser consultados na
PR #43; esse resultado do executor não antecipa a aprovação de um HEAD posterior.

Este é um incremento operacional do plano existente, sem declaração de novo
sprint/domínio. Não foram acrescentados testes de existência ou casos artificiais
para preencher a meta de um sprint.

## Resultados hospedados e proveniência

Executor administrativo e helpers públicos: commit
`ed64270954cef16b617f29a8c05c74801dea5b2c`, limpo durante toda a execução.
Manifesto da fixture: SHA-256
`6d7562fac404b1fd0f0dbb28548744b39e7fb536116160b133d8123f91690c5d`.
Criação e replay retornaram `created`/`replayed`, com quatro linhas e cinco
auditorias, por conexão direta com TLS verificado. Retirada e replay retornaram
`withdrawn`/`replayed`, com cinco desativações e seis auditorias. Nenhuma migration
foi aplicada nesta rodada.

O processo separado autenticou as três contas, verificou `Auth.getUser`, claims,
perfil/tenant, TTL de 600 segundos e os decoders reais. A1/A2 obtiveram as duas
leituras esperadas. B1 recebeu os códigos previstos na tabela acima. Após a
retirada, todas as nove chamadas retornaram HTTP 403/SQLSTATE `42501`, mantendo
exatamente os mesmos bearers em memória. `getUser` continuou HTTP 200 antes e
depois das recusas; ainda restavam 571 segundos de validade. O logout local das
três sessões ocorreu somente depois dessa prova e retornou HTTP 204.

O readback independente encontrou 24 auditorias: dez históricas, cinco de criação,
seis de retirada e três `estimate_viewed` das leituras positivas. Fingerprints das
linhas completas confirmaram que cliente, projeto, draft, membership, dez audits
anteriores, cinco audits de criação, perfil/tenant de O e configuração do issuer
permaneceram inalterados. As três contas sintéticas perderam autoridade no produto
(três perfis e duas organizações inativos); suas identidades Auth não foram
excluídas. O replay não pode ser usado para reativá-las.

A interface existente foi conferida no deployment
`dpl_3m5n54ZPs5c2JQZsDgqeAZsVkPdx`, fonte
`d13109703f18998cd03a5ab0f4311e398569c9cd`: A2 abriu o draft em consulta limitada,
com valores financeiros indisponíveis; B1 recebeu `Estimate Not Found` na mesma
URL. Ambas as sessões visuais foram encerradas. Os três módulos de transporte e
decoders e o router de estimates coincidem com o executor atual; não se afirma
equivalência da árvore completa. Nenhum novo deployment foi disparado.

[Recibo consolidado sanitizado](homolog-project-access-proof-2026-10-09.json).
O recibo HTTP original tem SHA-256
`51a29605596923f3ff23bd5ccd88e5756046db9ed6cc741d5a31c452eb97fd10`;
o script operacional local tem SHA-256
`dca42281ee4ce5eb894b01312fd662b21a6cd421010ef34899ed23499e0d2ca0`.
Recibos, logs e capturas estão em
`/private/tmp/structr-project-proof-round7-20261009/`; manifestos e credenciais
permanecem no diretório privado fora do Git. Um preflight inicial recusou a
variável de encoding acrescentada pelo macOS, antes de qualquer requisição;
seu recibo foi preservado e apenas essa variável de sistema foi admitida.

## Limites e próximo gate

Esta prova cobre duas projeções de leitura de um draft vinculado a um projeto
conhecido. Não cobre listagem, todos os endpoints ou a jornada completa. O draft
vazio não é orçamento calculado nem referência financeira independente. O
executor administrativo mantém `authVerified:false`; somente a prova pública
separada pode atestar as sessões reais.

O cadastro IF-1 permanece fechado. Seu router, gate e UI já estão implementados;
o próximo incremento é a instalação nominal do SQL congelado e sua prova
hospedada restrita. Isso exige nova preparação auditada das identidades sintéticas
ativas, sem reativação silenciosa nem alteração de O. O grant da RPC direta exige
controle próprio: desligar somente a flag web não revoga `EXECUTE` no banco.
Depois vêm aprovação, versionamento, exportação, comparação com a referência
financeira e recuperação operacional. A liberação para projetos reais continua
pendente.

## Relatório de conclusão do incremento

| Item | Evidência |
| --- | --- |
| TypeScript | `pnpm check`: zero erros; typecheck separado do runner também aprovado |
| Testes | 32 novos distintos; 7.610 passes gerais, 1.295 ignorados; 17 físicos separados, zero falhas |
| Criados | Este registro e `homolog-project-access-proof-2026-10-09.json` |
| Modificados | `scripts/homolog-access-runner.ts`, `scripts/homolog-read-proof.md`, duas suítes `homolog-access-runner`, `vercel.json`, README, todo, plano vigente e três registros de estado/coordenação |
| Tabelas / engines / endpoints | Zero novos; nenhuma alteração de schema ou endpoint de negócio |
| Helper | Conexão privada `withVerifiedDatabase`; criação/retirada reutilizam os helpers existentes |
| F1 | Nenhum endpoint público ou de negócio adicionado |
| F2 / F5 | Helpers mantêm `logAudit(..., tx)` e `db.transaction()`; rollback e readback físicos aprovados |
| Regressões | Zero falhas na suíte geral e na suíte física focal |
| Uso real | Não liberado; gates restantes descritos acima |
