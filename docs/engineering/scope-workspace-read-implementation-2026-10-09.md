# SWR-1 — integração do cadastro ao workspace

**Estado:** SWR-1 comprovado na homologação na fonte `7dd40526`, com CI aprovado, leitura na tela, recusas diretas e retirada auditada com sessões ainda válidas. A nominal 0019 está instalada e fechada; IF-1 permaneceu fechado. [Evidência hospedada e limites](scope-workspace-read-hosted-proof-2026-10-09.md). [PR #45](https://github.com/wcvmsilva/structr-ai/pull/45). Projetos reais não estão liberados; ADR-003 permanece proposta.

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

O check de tipos e `build:vercel` passaram; avisos de analytics opcional e tamanho de chunk permanecem. A primeira suíte geral sobrepôs a fase RED de promoção: 7.800 passes, seis falhas esperadas restritas a schema/inventário e 1.434 skips. Após o GREEN focal, o hook obrigatório passou na fonte congelada `74fe1dcc`: **7.806 testes aprovados, 1.434 ignorados, zero falhas; 224 arquivos aprovados e 44 ignorados**. O [CI correspondente](https://github.com/wcvmsilva/structr-ai/actions/runs/38009018273) passou tipos, testes e build. Não declarar os testes físicos ignorados pela suíte padrão como aprovados nessa execução.

## Verificação do destino e sequência

No projeto `wmspwegbqtzamkhxhusg` (`structr-ai-homolog`, PostgreSQL 17.11), a consulta somente leitura confirmou IF-1 instalado e fechado, SWR-1 ausente e duas linhas de intake em draft. O preflight exato deste candidato passou em `BEGIN READ ONLY`, principal `postgres`. Nenhuma instalação ou abertura decorre desse resultado.

### Instalação e primeira tentativa hospedada

A nominal e o companion close foram aplicados na mesma transação, ledger `20261010002415 / 0019_authenticated_scope_workspace_read_closed`. O catálogo confirmou owner NOLOGIN/NOINHERIT/NOBYPASSRLS/NOSUPERUSER e ambos os EXECUTE da API fechados. O inventário físico completo das 91 tabelas permaneceu idêntico. Os advisors de segurança permaneceram iguais: três tabelas históricas com RLS sem policy e oito funções legadas com search_path mutável; não são achados novos da 0019 ([RLS](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [search_path](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable)).

O preview fechado `dpl_DTY5CfZ5ZcWeWWySyFVdqCMQxWDw` e o preview de prova `dpl_AQJTi5ca12ERhvjesjWD4CX3tGBP` ficaram READY na fonte `74fe1dcc`. As 22 variáveis são específicas da branch preview, com credenciais herdadas SQL/serviço vazias, modo Data API e IF-1 false. Não houve alteração de produção.

Os preflights offline passaram. O observer basal confirmou 91 tabelas, 61 linhas e 42 audits, identidades sintéticas inativas. O runner v1 recusou a reativação com `HOMOLOG_READ_STATE_DRIFT` antes de DML: exige a população original de uma fixture por tabela e o estado da retirada original. Os dois pares IF-1 e o ciclo posterior legítimo não satisfazem esse contrato. Não ocorreu tentativa Auth ou RPC de negócio. Um erro na sequência da automação abriu os grants após a recusa; o companion close os fechou imediatamente. A comparação posterior das 91 tabelas confirmou novamente ausência de DML. A flag da branch foi reposta em false; o preview imutável de prova conserva sua flag true, mas a RPC está fechada no banco. Evidência local: `hosted-attempt-1.md` no diretório da rodada.

### Correção da preparação das identidades

A continuação nominal foi implementada e revisada sob o [contrato restrito](../security/scope-workspace-read/identity-continuation-contract-2026-10-09.md), sem alterar o comportamento v1. Exige o predecessor v1 completo e encerrado, os 42 audits históricos e as duas formações IF-1 completas com hashes físicos de microssegundos e seus seis audits de criação. Cada operação usa Drizzle SERIALIZABLE e `logAudit`, altera apenas os cinco registros de identidade e acrescenta seis audits obrigatórios. Não cria privilégios, contas Auth ou dados de negócio.

Foram acrescentados **49 testes distintos**: 18 de manifesto, 21 físicos do helper, oito CLI e dois físicos do runner. O GREEN do helper passou 152 casos (39 novos e 113 anteriores); o runner passou 115 (dez novos e 105 anteriores), sem falhas/skips em ambos. Esses totais focais sobrepostos não se somam. Tipos gerais e focais passaram. Os REDs reproduziram inclusive auditoria futura espúria, diferença de um microssegundo na criação IF-1 e visibilidade privada filtrada por RLS. A revisão independente final não encontrou P1/P2. Hash do helper: `37aead3e9782fb3bc209165c540869be8840aa4d156dfa096d843620f15717c9`; SQL 0019 e companions conservaram seus hashes.

A rodada totaliza **299 testes novos distintos** (250 SWR-1 + 49 preparação). O hook obrigatório na fonte `7dd40526` passou tipos e suíte geral: **7.832 testes aprovados, 1.457 ignorados, zero falhas; 225 arquivos aprovados e 46 ignorados**. O [CI dessa fonte](https://github.com/wcvmsilva/structr-ai/actions/runs/38010298277) também passou. Os quatro scripts operacionais da segunda tentativa estão separados em `/private/tmp/structr-swr1-attempt2-20261009`, revisados sem P1/P2; oito checks puros locais passaram e não entram na contagem do produto. A execução hospedada posterior está no registro abaixo.

### Segunda tentativa hospedada — concluída

A fonte `7dd40526` foi publicada e mantida limpa durante toda a janela. O manifesto de continuação novo foi preparado por leitura administrativa; A2 conservou a ausência de membership e de `project:read`. A1 acessou os dois pares na UI, atualizou a leitura e recebeu recusa ao combinar projeto/intake incompatíveis. A prova RPC confirmou os dois pares e suas repetições, recusou A2/B1, autoridade extra e acesso bruto, e confirmou IF-1 fechado. Após retirada, os mesmos bearers ainda válidos foram recusados na sessão protegida e nos dois pares; os três signouts locais passaram. O observer independente confirmou **42 → 48 → 54 audits**, sem audit/DML nas leituras, preservando os dois cadastros IF-1, o operador real, a configuração de issuer e todas as demais linhas das 91 tabelas. SWR-1 foi fechado e conferido. [Recibos, hashes e separação UI/RPC/readback](scope-workspace-read-hosted-proof-2026-10-09.md).

O prévio IF-1 permanece encerrado. A jornada financeira requer seu próprio canal confiável, cálculo determinístico, persistência/auditoria, aprovação, versão e exportação. Recuperação de acesso/operação/ambiente e aceite de produção continuam separados. O [plano de coordenação](scope-to-field-coordination-2026-10-09.md) mantém essas dependências.
