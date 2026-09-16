# G2 — evidência local dos históricos de regras geográficas

Observação: 2026-09-16. Repositório: https://github.com/wcvmsilva/structr-ai.

## Resultado e fronteira

Implementação local **consolidada em commit nesta branch** para o recorte descrito em `g2-override-logs-plan.md`, sob a política de `g2-override-logs-policy.md`. As quatro operações de histórico passaram a exigir autoridade explícita do contexto e o pai autorizado do rascunho; a resolução passou a persistir a regra e a razão realmente aplicadas; gravação e limpeza passaram a verificar o efeito antes de confirmá-lo.

Consolidação: branch `codex/g2-override-logs-20260915`, worktree `/private/tmp/structr-g2-override-logs-20260915`, base `a9c30f143f1fda7f64c2b7454f051011c217e84b`, **sem upstream**. A base é apenas o ponto de partida e **não contém** estas mudanças. Este documento faz parte do próprio commit e por isso não pode conter o identificador dele; o SHA da consolidação fica registrado nos registros locais ignorados (`.superpowers/sdd/g2-override-logs/`), junto das execuções repetidas sobre esse SHA.

**Consolidação local não é fechamento formal da unidade.** Nenhum gate recebe PASS/GO aqui. G2 inteira, segurança global, PR #9 e liberação de campo continuam sem GO. Não houve `fetch`, `pull`, `push`, `merge`, `rebase`, publicação, deploy, Phase 3, Supabase, banco operacional, migração, seed ou backfill.

## Autoridade e linhagem

- Política dos pais aprovada por resposta humana, registrada em `g2-override-logs-policy.md`. A execução local e, em seguida, esta consolidação foram autorizadas por transições explícitas que **não** autorizaram publicação, merge, PR #9 nem campo.
- `AGENTS.md` da base descreve MySQL e `protectedProcedure` universal; o registro de correção do workflow em `f60cf9a56679d4d7083b2c11ac4e2727d53d84c3` supersede ambos. O código e o laboratório usam **PostgreSQL** e as fronteiras `tenantProcedure`/`adminTenantProcedure`.
- Refs remotas foram lidas na preparação (main `8fa14da3…`, workflow `f60cf9a5…`, security `b95ea0bf…`; PR #9 OPEN, não merged). O objeto local de main continua ausente: **não se afirma integração com main** nem mergeabilidade.
- O único banco tocado foi um cluster PostgreSQL descartável criado e encerrado pelo próprio laboratório, em socket privado, recusando URLs e configuração herdada.

## Antes e depois

Antes, pelas rotas tRPC já existentes e com PostgreSQL real: o histórico de um rascunho vinculado a outra empresa era **devolvido**, respondia `true` a `hasOverrides`, era **apagado** por `clearLog` e **recebia novas linhas** por `resolveForDraft`; o mesmo valia para projeto sem empresa identificada com `TENANT_STRICT` desligado; projeto com `deleted_at` preenchido continuava autorizado; a resolução persistia `override_id` e `reason` **nulos**, porque o mapper enviava colunas inexistentes; a limpeza devolvia a contagem do driver como texto; história e regras não eram verificadas entre leitura e gravação, de modo que escritas concorrentes duplicavam ocorrências e uma limpeza intercalada era silenciosamente desfeita por um snapshot velho.

Depois:

1. As quatro operações exigem `{tenantId, userId}` do contexto e recusam identidade ausente **antes de obter banco**. Empresa, usuário ou papel vindos de payload ou snapshot nunca são consultados.
2. O predicado dos pais vale nos dois modos de `TENANT_STRICT`: rascunho A ou sem empresa sob projeto A é permitido e a coluna do rascunho não é reescrita; rascunho B, projeto B, projeto sem empresa e projeto excluído são recusados, inclusive para administrador da própria empresa.
3. Histórico autorizado permanece legível com regra removida, inativa, de outra empresa ou vínculo nulo. Entradas novas exigem regra existente, própria, ativa e válida para o motor.
4. A resolução persiste `override_id` e a razão renderizada, preservando ocorrências idênticas sem deduplicação.
5. Gravação e limpeza rodam em transação com locks na ordem projeto → rascunho → regras → histórico, reafirmam o pai autorizado no predicado final, comparam snapshots por valor e verificam o efeito por releitura em multiconjunto; qualquer divergência reverte todo o lote.
6. Falhas de banco, de verificação ou de releitura produzem erro sanitizado — nunca `[]`, `false`, `0` ou erro comercial de pipeline. Um vazio passou a significar leitura autorizada e vazia.
7. A auditoria registra o estado anterior **real**, capturado sob lock antes da mutação, e as linhas efetivamente confirmadas, com o operador do contexto.
8. O pipeline recebe autoridade obrigatória e autoriza **antes** de carregar, consultar idempotência, precificar ou persistir; `createFromScopeDraft` autoriza antes do bloco que cria rascunho parcial; o retry recusa antes de `markRetrying` e preserva o erro seguro vindo de dentro do pipeline.

## Execuções observadas

Prefixo limpo em todas: `env -i PATH=/usr/local/bin:/usr/bin:/bin NODE_ENV=test CI=1` (mais `G2_LOGS_POSTGRES=1 G2_1_POSTGRES=1` no laboratório). Logs e consolidação numérica em `.superpowers/sdd/g2-override-logs/`, fora do commit.

| Execução | Resultado |
|---|---|
| Baseline de tipos e suíte na base limpa (rodada anterior, mesmo SHA) | exit0; 2.918 passaram / 265 ignorados |
| Sonda de infraestrutura: suíte PG de regras já existente | exit0; 46 passaram; cluster removido |
| RED laboratório PG, antes de produção | exit1; 74 casos: 47 falharam / 27 controles |
| RED callers, antes de produção | exit1; 36 casos: 20 falharam / 16 controles |
| RED pipeline, antes de produção | exit1; 5 casos: 4 falharam / 1 controle |
| RED do estado anterior na auditoria, na revisão de consolidação | exit1; caso novo falha com a forma antiga restaurada temporariamente |
| GREEN laboratório PG | exit0; 75 passaram |
| GREEN callers, pipeline e duas legadas adaptadas | exit0; 125 passaram / 9 ignorados |
| Cinco suítes legadas do plano | exit0; 179 passaram / 9 ignorados |
| Regressão PG opt-in já existente | exit0; 96 passaram |
| Suíte completa | exit0; 2.959 passaram / 340 ignorados |
| Tipos da aplicação | exit0, 0 erros |
| Tipos dos testes (configuração local) | exit2: 0 erros nos arquivos deste recorte; 5 erros **pré-existentes** em `sprint19-pipeline-hardening.test.ts` |
| `git diff --check` | exit0 |
| Auditor de cobertura de tenant | exit0; 44 avisos e 6 lacunas conhecidas, iguais à medição anterior |

**116 testes novos**: 41 rodam na suíte normal e 75 no laboratório opt-in. Considerando as rodadas opt-in, 3.130 testes distintos passaram; 169 permanecem não executados. O foco repetido não é somado.

Os cinco erros de tipo do `sprint19` estão nas linhas 185, 187 e 197 (literal `ContextSnapshot` com ids numéricos) e são **idênticos no HEAD da base**, provados por `git show`. A configuração padrão de tipos exclui testes, por isso nunca apareceram. Corrigi-los seria ampliar o recorte em silêncio; ficam registrados e não corrigidos.

## RED como prova anterior

As recusas de pai, os efeitos de limpeza e gravação, a proveniência, a multiplicidade, o projeto excluído, a contagem real e os seis casos de concorrência foram demonstrados **pelas mesmas rotas tRPC que já existiam**, com PostgreSQL real. Casos que exercitam apenas a assinatura nova (preflight, validação de lote, releitura, rollback, revalidação sob lock) estão no grupo `candidate-contract` e são evidência apenas em GREEN — eles não sustentam sozinhos a afirmação de defeito anterior. Positivos que já passavam na base (leitura do próprio pai, isolamento de rascunho irmão, ordenação, histórico com regra removida, leitor `viewer`, principal só-escrita) estão identificados como **preservação**, não correção.

O caso de revalidação sob lock não tem contraste possível na base, porque a base nunca toma o lock do pai; ele vale apenas como prova posterior e assim está registrado.

## Matriz de impacto

| Capacidade | Impacto | Evidência | Disposição |
|---|---|---|---|
| P-03 Tenancy e escopo por empresa | Direto | A/B/NULL nos dois modos, SQL real | Implementado e consolidado localmente; sem gate |
| P-02 Autorização e RBAC | Direto | Fronteiras e permissões por operação; negativas antes de efeito | Implementado; sem gate |
| P-06 Camada de acesso a dados | Direto | Locks, predicado final, releitura, rollback, concorrência | Implementado; sem gate |
| P-05 Auditoria | Direto delimitado | Antes/depois reais; nulo e exceção pós-commit provados como limite | Sem alegação de durabilidade ou atomicidade |
| P-09 Proveniência | Direto delimitado | `override_id` e razão renderizada persistidos; multiplicidade preservada | Sem alegação de substrato completo |
| C-11 Revisão de escopo | Consumidor | Leitura autorizada | UI não certificada |
| C-19 Remodelação | Consumidor | Histórico correto do rascunho; motor intacto | Sem writer novo |
| C-38 Visualização de workflow | Consumidor | Encaminhamento com contexto | Contrato numérico continua excluído |
| C-14 Estimativa | Direto delimitado | Preflight e autoridade no pipeline | Sem alegação de pipeline completo |
| P-08 Recuperação de rascunho | Direto delimitado | Zero `markRetrying` em negativa inicial; erro seguro preservado | Corrida após o preflight continua limite |
| P-10 Exportação | Indireto | A ponte para o campo superior continua ausente | Fora do recorte |
| P-07 Dados de referência (regras) | Dependência | Snapshot das regras referenciadas | Não torna regra global |
| C-16 Catálogo | Dependência indireta | IDs preservados | G4 fora do recorte |
| C-13 Modelo de escopo | Dependência | A/A e A/NULL positivos; B negado; sem reescrita de coluna | Política aprovada, sem stamp |
| C-07 Formação de projeto | Dependência | B/NULL/excluído negados | Sem mudança global |

## Limitações

- O laboratório reproduz as colunas reais das seis tabelas e **apenas três** chaves estrangeiras locais (rascunho→projeto, histórico→rascunho, histórico→regra). Demais FKs, RLS, triggers operacionais, migrações e seed estão ausentes e não são certificados.
- O snapshot valida o histórico observável e as regras referenciadas; não detecta um ciclo intermediário que restaure exatamente os mesmos valores, regras novas não referenciadas, mudanças de catálogo, nem escritores externos que ignorem o protocolo.
- A auditoria continua com `userId: null` e operador no payload do domínio; retorno nulo é auditoria não confirmada e exceção após o commit não desfaz o negócio.
- O retry marcado antes de uma revogação ocorrida depois do preflight permanece marcado: é limite de recuperação, não rollback.
- O gatilho local usado para forçar falha de releitura descreve exatamente um comportamento, criado e removido no próprio teste; nada se afirma sobre gatilhos operacionais desconhecidos.
- Diferenças que existam apenas na precisão submilissegundo descartada pelo driver não são detectadas pela comparação de snapshots.
- Cinco erros de tipo pré-existentes permanecem em `sprint19-pipeline-hardening.test.ts`, fora do recorte.

## Próxima transição

Revisão humana desta consolidação local. Publicação, PR #9, merge, deploy e liberação de campo não fazem parte desta entrega e continuam sem autorização.
