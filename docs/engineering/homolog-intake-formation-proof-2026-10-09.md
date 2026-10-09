# Cadastro IF-1 na homologação — 9 de outubro de 2026

**Estado deste checkpoint:** correção nominal revisada e testes focais aprovados;
prova hospedada de criação ainda pendente. Não libera projetos reais.
Base: `afb5a4bf675ac0f94de1e6d9f1ad15526888177b`; branch
`codex/homolog-intake-formation-proof`. Este registro sucede o gate de cadastro
do [ensaio de leitura](homolog-project-access-proof-2026-10-09.md), preservando
os recibos e manifestos anteriores.

## Autorização e artefato nominal

Após apresentação do diff e do alcance de BYPASSRLS, o responsável autorizou
literalmente: “Autorizo especificamente esse ajuste da migração 0018 com
BYPASSRLS, somente na homologação.” A revisão automática havia rejeitado três
tentativas por considerar as respostas anteriores genéricas. Nenhum patch foi
aplicado por outra via; a mesma ferramenta aceitou a alteração depois dessa
autorização específica. Ela não autoriza instalação em produção.

| Artefato | SHA-256 |
| --- | --- |
| Candidato histórico, preservado fora do journal | `135c5200dbcc32b0653d54f17721659dbf34ef2f747666640d28c6b8e49db5a0` |
| `drizzle/0018_authenticated_intake_formation.sql`, nominal | `a54e7a937eec72bf14110f890d4fc379ee414259135f3f070fee1ebc40991b75` |
| Companion operacional `homolog-close.sql` | `156c718c0c27c64c7a95e7f2da4d09d4b241c8b0463276efa7d947d84ba5ca94` |
| Companion operacional `homolog-open.sql` | `fb08db635be439f1f846afdae298ff80d3176eb20de2751b47a82e74e5aa8068` |

Somente o preflight nominal mudou. Os três comentários iniciais são avisos
históricos, superados pela disposição IF-1 e por este registro; o candidato não
foi regravado. Todos os bytes desde `CREATE ROLE structr_intake_create_owner_v1`
até o fim, incluindo runtime, grants e postflight, permanecem idênticos.

O preflight distingue o dispatcher confiável `authenticator`: seus privilégios
próprios e herdados continuam inspecionados, mas seus caminhos SET-only da
plataforma, inclusive `service_role` com BYPASSRLS, não são tratados como
privilégios dos usuários. Todos os caminhos SET/USAGE de `anon`/`authenticated`
continuam inspecionados. Quatro guards explícitos recusam caminhos diretos e
transitivos aos dois owners privados anteriores. As exceções de schema/função
passam a depender da origem `authenticated`, corrigindo a aceitação indevida de
`anon SET authenticated`. A herança desse papel já era recusada; seu teste é
controle de preservação, não outro defeito descoberto.

Isso altera deliberadamente o controle de instalação. A arquitetura continua
dependendo do gateway que verifica JWT e da ausência de SQL arbitrário exposto;
não se remove a membership interna da plataforma nem se coloca service role,
credencial SQL ou segredo de assinatura no processo web.

Revisão local independente confirmou o diff exato e não encontrou novos P1/P2
no reparo. O journal passa a ter 19 migrations; o schema Drizzle espelha o owner
existente e as duas policies de configuração da 0018. Isso não habilita RLS nas
tabelas de negócio nem lhes concede acesso bruto pela API.

## Evidência local e verificação somente leitura do destino

O RED completo teve três falhas esperadas e um controle aprovado: baseline de
dispatcher recusado, caminho anon SET aceito e identidade nominal ainda antiga.
Depois do patch, quatro suítes tiveram **168 aprovados, uma fixture histórica
externa ignorada e zero falhas**: 49 lifecycle, 67 RPC físicos, 11 schema e 41
inventário. São 31 casos novos distintos nessa frente: 29 físicos e dois offline;
os 87 testes físicos anteriores foram preservados e reexecutados. PostgreSQL
17.11/PostgREST 16.4 locais não atestam a versão do serviço hospedado.

Logs em `/private/tmp/structr-if1-promotion-20261009-5OPIwg/`:

- `dispatcher-complete-red.log`: `2877c4f96f67192a3fa0afb08ce21fc0f7bb13cc864d39d24852a57bedd90f52`.
- `dispatcher-complete-green.log`: `5684e52230e707ca1b8d3a2b738313f3ee01f3814847ca9b254f58dfe54658fe`.
- `dispatcher-final-source-and-cleanup.json`: `ba57f93b5a72c25f7f31ae84fbc80e8c6cbfa1a8a3eb0122abec4453e27f9f01`.

Os três diretórios de clusters foram confirmados removidos. O teste de schema
gerado compara as 16 policies efetivas e exige os três owners sem privilégios.
As provas de instalação/abertura/fechamento usam migrador não-superuser e o
baseline do dispatcher com SET-only `service_role`.

No projeto `wmspwegbqtzamkhxhusg` (`structr-ai-homolog`), o novo DO de preflight
foi executado em `BEGIN READ ONLY`: retornou `preflight_passed`, principal
`postgres`, `transaction_read_only=on`. Isso comprova compatibilidade do catálogo
naquele instante, não instalação, criação de negócio ou rollback hospedado.

## Incrementos já preparados nesta branch

`6f95dc5b` valida o comando completo antes de congelar UUID/payload na tela,
inclusive limites UTF-8 e NUL. A suíte focal teve 82 aprovados, sete novos.
Um erro local permanece corrigível; não vira resultado incerto de envio.

`096f4432` acrescenta o ciclo administrativo nominal de reativação/retirada,
com manifesto novo ligado aos manifestos históricos imutáveis. Cada transição
usa `db.transaction()` SERIALIZABLE e `logAudit(..., tx)`: cinco linhas de
identidade e seis audits, com replay sem duplicação e readback integral.
A frente teve 318 casos distintos aprovados, 47 novos, sem mudança no Auth.
Esse processo é separado do web; operador O e issuer não são alvos.

As três frentes somam **85 casos novos distintos**, sem transformar repetições
focais ou casos físicos ignorados na suíte padrão em novas aprovações. Tipos,
build, suíte padrão, CI e prova hospedada são gates separados, registrados na
continuação deste documento quando efetivamente executados.

## Sequência operacional delimitada

1. Congelar e publicar o código revisado após as verificações integradas;
   configurar somente o preview desta branch, sem herdar credenciais SQL/serviço.
2. Instalar nominal e companion close **na mesma transação**. Conferir ledger,
   catálogo, owner e ausência efetiva de EXECUTE antes de abrir qualquer janela.
3. Criar manifesto nominal novo com commit executado e IDs novos, preservando
   integralmente o manifesto anterior. Reativar as identidades sintéticas pelo
   runner auditado e verificar replay, histórico e operador O.
4. Abrir janela de homologação pelo companion revisado. Ela abrange todos os
   operadores atualmente elegíveis, inclusive O; não é allowlist só das contas
   sintéticas. Comprovar criação pela tela separadamente do probe tRPC/RPC.
5. Conferir conjuntos completos: cada formação cria um client, um project, um
   intake e três audits íntegros. Replay, conflito, identidade forjada e input
   inválido não criam outro registro. Resultado incerto não comprova rollback.
6. Retirar a autorização das cinco identidades **com a RPC ainda aberta**;
   provar recusa organizacional `42501/FORBIDDEN` com os mesmos bearers ainda
   válidos no Auth. Depois fechar a RPC, conferir ACL e encerrar sessões.

O probe público não é prova visual e declara `uiVerified:false`. Reenvio pela
tela exige resultado incerto da entrega, página preservada e o mesmo comando;
criação visual confirmada não demonstra esse caso. Reload perde o comando local.

Mesmo após IF-1 aprovado na homologação, continuam pendentes a jornada de escopo,
cálculo e referência financeira independente, aprovação, versionamento,
exportação e recuperação aplicável antes de liberar projetos reais.
