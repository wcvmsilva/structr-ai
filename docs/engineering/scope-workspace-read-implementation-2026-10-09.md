# SWR-1 — integração do cadastro ao workspace

**Estado:** implementação e promoção local da nominal 0019 revisadas; verificação geral final em fechamento. A instalação e a prova hospedadas ainda não foram executadas. Projetos reais não estão liberados.

Base `17f276322c7a97972404d034e672a4d216e67cd4`, branch `codex/scope-workspace-contract`. O responsável ratificou a substituição nominal F5 em SWR-1; AGENTS/ADR-002 foram reconciliados em `2940f7af`. A decisão não amplia IF-1 nem autoriza resultados financeiros enviados pelo cliente.

## Comportamento entregue

O endpoint protegido existente `scopeGeneration.loadWorkspace` passa a admitir, exclusivamente no modo autenticado e com sua própria flag, um par obrigatório `projectId/intakeFormId`. A RPC autoriza e lê esse par numa única transação SERIALIZABLE, com locks e revalidação de claims. O retorno é estrito, limitado e versionado. Projeto e intake não aparecem parcialmente; escopos e catálogo ficam explicitamente não consultados.

A tela navega pelo recibo confirmado do cadastro ou pelo par conhecido na URL. As consultas usam identidade, sessão e par como chave; troca de sessão cancela a leitura, remove cache e descarta respostas atrasadas. A tela não dispara listas, catálogo ou writers. O caminho direto anterior permanece separado. A capacidade de leitura independe da flag de criação de cadastro.

Não foram criadas tabelas nem operações financeiras. Nenhuma mudança/auditoria de negócio pertence a esta leitura. O wrapper público é SECURITY INVOKER, a implementação privada é SECURITY DEFINER de um owner dedicado sem LOGIN, INHERIT ou BYPASSRLS. A configuração privada recebe apenas as policies nominais de leitura/lock; a migração não habilita RLS nas tabelas de negócio nem lhes concede acesso bruto à API.

## Artefatos congelados e revisão

| Artefato | SHA-256 |
| --- | --- |
| `docs/security/scope-workspace-read/candidate.sql` | `de4272f63d94fc330b68108a7abc78f11a94a7a2b43521e2d1fbad65796df7c9` |
| `homolog-open.sql` no mesmo diretório | `6536416bb6b6ddeaf799bf768a303cb45de509b9d25c4aa7252ea15413a59faf` |
| `homolog-close.sql` no mesmo diretório | `878a4bb082cc08283c4779c976ac45e7b0b768c6a38faa8efdbb18c7af1c02a9` |

A revisão independente final não encontrou P1/P2 no recorte. As contraprovas levaram à recusa de datas BC/nulos obrigatórios, preservação de membership existente do migrador e recusa de ACLs PUBLIC privadas, inclusive EXECUTE implícito. A projeção usa datas em milissegundos; a prova de ausência de escrita compara o estado físico integral, incluindo microssegundos. Concorrência com DDL arbitrária de administrador não foi comprovada.

## Evidência local

Logs em `/private/tmp/structr-swr1-20261009/`; repetições não aumentam a contagem de casos novos.

| Frente | Casos novos distintos | Evidência |
| --- | ---: | --- |
| Contrato/decoder e transporte | 79 | 49 contrato + 30 transporte; GREEN focal 273/273 com quatro suítes anteriores |
| Gate e router | 47 | 24 gate + 23 router; GREEN focal 165/165 com duas suítes IF-1 anteriores |
| Interface e navegação | 34 | GREEN final 116/116 com 82 casos anteriores |
| PostgreSQL/PostgREST reais | 88 | `physical-green-final.log`: 88/88, zero skips; clusters removidos |
| Identidade de migration e paridade ORM | 2 | `promotion-green.log`: 54 passes/1 fixture histórica externa ignorada, incluindo dois casos físicos de schema gerado |

Total novo: **250 casos distintos**, dos quais 88 físicos exigem execução opt-in. A promoção acrescenta a entrada 20 do journal e espelha as duas policies no ORM (18 policies no schema gerado). A nominal é byte a byte igual ao candidato; migrations anteriores permanecem intactas. ORM não substitui os grants e corpos das RPCs verificados pela prova física.

Os REDs registram RPC ausente, contrato/gate fechados, getter observado antes da validação, erros de sessão, isolamento de sessão/par, integridade, grants e companions ausentes. A suíte física cobre JWT real no gateway local, A1/A2/B1, owner/admin/RBAC, tenant/metadata contraditórios, isolamento/expiração, revogação concorrente, preservação de todas as linhas/audits e ciclo instalação/close/open/close com migrador não-superuser. Essa prova local não atesta o gateway hospedado.

O check de tipos e `build:vercel` passaram; avisos de analytics opcional e tamanho de chunk permanecem. A primeira suíte geral sobrepôs a fase RED de promoção: 7.800 passes, seis falhas esperadas restritas a schema/inventário e 1.434 skips. O GREEN focal posterior confirmou as correções; o hook obrigatório executará novamente a suíte geral na fonte congelada antes de publicar. Não declarar os testes físicos ignorados pela suíte padrão como aprovados nessa execução.

## Verificação do destino e sequência

No projeto `wmspwegbqtzamkhxhusg` (`structr-ai-homolog`, PostgreSQL 17.11), a consulta somente leitura confirmou IF-1 instalado e fechado, SWR-1 ausente e duas linhas de intake em draft. O preflight exato deste candidato passou em `BEGIN READ ONLY`, principal `postgres`. Nenhuma instalação ou abertura decorre desse resultado.

Próximo: publicar a fonte revisada; instalar a nominal e o companion close na mesma transação; conferir ACL/ledger/ausência de DML; usar novo manifesto para reativar as identidades sintéticas sem regravar os manifestos anteriores; provar leitura UI/RPC e recusas; retirar autorização mantendo os bearers válidos; conferir estado e fechar a operação. A2 não tem membership nos projetos IF-1 e o papel `user` não tem `project:read` no catálogo observado, portanto seu esperado é recusa nesses pares. Não elevar sua autoridade para obter um positivo artificial.

O prévio IF-1 permanece encerrado. A jornada financeira requer seu próprio canal confiável, cálculo determinístico, persistência/auditoria, aprovação, versão e exportação. Recuperação de acesso/operação/ambiente e aceite de produção continuam separados. O [plano de coordenação](scope-to-field-coordination-2026-10-09.md) mantém essas dependências.
