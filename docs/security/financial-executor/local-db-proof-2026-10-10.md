# ADR-003 — prova física local de pré-requisitos

**10 de outubro de 2026. Escopo: incremento local test-only, T1 parcial.** Base de trabalho `5a5557c7a85f439f4b38f763ec12aaf92eba5a82`; PostgreSQL **17.11** (`170011`), cluster descartável próprio pelo harness `app-principal-postgres`, somente Unix socket (`listen_addresses=''`). Nenhuma URL externa, dado real, credencial reutilizável, mudança hospedada ou implantação. O processo de teste recebeu ambiente explícito limpo, sem configurações de DB/cloud herdadas.

Foram reaplicadas as migrations reais **0000–0014**, com SHA-256 registrado no log. O trigger real `public.a1_draft_final` e os guards/FKs/checks dessas migrations permaneceram ativos e inalterados. **0015–0019 não foram instaladas nesta prova**: coexistência IF-1/SWR, seus owners/ACLs/policies e o guard da 0019 continuam sem prova neste incremento.

## Resultados observados

| Rodada | Passaram | Falharam | Deselecionados | Evidência |
| --- | ---: | ---: | ---: | --- |
| RED de COMMIT | 1 | 1 esperado | 15 | `red-commit.log` / `.json` |
| RED de visibilidade | 0 | 2 esperados | 26 | `red-visibility.log` / `.json` |
| GREEN final físico | **32** | **0** | **0** | `green-final.log` / `.json` |

Diretório de evidência local: `/private/tmp/adr003-calculator-db-proof-gzzbSD/`. `evidence-summary.json` registra contagens, fingerprints e conferência posterior de limpeza. As deseleções RED resultam do filtro nominal; nenhum teste físico foi pulado no GREEN. Os 32 casos são provas físicas/caracterizações, não substituem as quotas de engine/DB/router/integração do sprint. A suíte completa, TypeScript e build pertencem ao registro de integração do responsável; não foram executados por este incremento.

- **Identidade real:** conexão nova com `session_user=current_user=app_runtime`, PID distinto do observador. Login `LOGIN/NOINHERIT/NOSUPERUSER/NOBYPASSRLS/NOCREATEDB/NOCREATEROLE/NOREPLICATION`; owner `financial_probe_owner` com os mesmos limites e `NOLOGIN`. Ambos sem membership; nenhum é proprietário de tabela. Catálogo de ACLs de tabela e coluna, atributos dos papéis e definição do trigger registrados antes das operações. Acesso efetivo bruto do login às tabelas públicas ausente no baseline contido.
- **RED→GREEN de COMMIT:** função definer sem flush devolveu o draft; o COMMIT real como login falhou `42501`; observador confirmou zero draft. A variante corrigida executa `SET CONSTRAINTS public.a1_draft_final DEFERRED`, INSERT, `... IMMEDIATE` sob owner e só então readback. O draft confirmou no COMMIT real. Nenhum `SET ALL` ou grant bruto ao login.
- **Transação real:** `db.transaction()` Drizzle SERIALIZABLE mantém PID/txID da entrada às duas chamadas de writer e saída. Modos iniciais IMMEDIATE/DEFERRED, alternância pelo caller, chamadas sequenciais, rollback de savepoint seguido de commit e falha após receipt com rollback integral passaram.
- **Integridade/visibilidade:** retirar SELECT de uma coluna do draft/evidência, acrescentar coluna de evidência sem grant ou retirar UPDATE(id) necessário ao lock causa `42501` e zero novo draft. Ausência de policy e restrictive false inicialmente deixaram draft passar: RED funcional registrado. Um witness **específico da fixture** agora recusa tais desvios antes da escrita. Evidência real estruturalmente válida, mas sem a decisão correspondente, foi enfileirada no mesmo tx do login: visível ao owner, causou `A1_DECISION_STATE_MISMATCH`; escondida por restrictive policy, contou zero e foi recusada pelo witness. A fixture administrativa temporária foi removida; o tx e a evidência foram revertidos, sem desabilitar guards.
- **Privilégios adversos:** raw SELECT/DML/binding, SET ROLE privilegiado, primitive direta e outro LOGIN com GUCs forjadas recusados. Injeções locais mostraram que PUBLIC EXECUTE, grant de coluna PUBLIC, membership SET-enabled ou explicitamente herdável, default ACL e definer desconhecido com NULL-proacl **podem ampliar acesso de verdade**. Os testes removem cada desvio. São contraprovas da insuficiência de olhar somente ACL de tabela/NOINHERIT, não aprovação de um preflight de produção.

## Limites e implementação ainda necessária

O harness revoga globalmente ACLs no cluster recém-criado para montar o baseline controlado. Isso **não prova contenção de ambiente existente**. Grants de coluna são enumerados dinamicamente para o experimento; o witness conhece somente as três policies da fixture. Não constituem manifesto congelado, verificador completo de privilégios transitivos/defaults, tratamento de colisão de nomes de constraints, ou instalador atômico revisado para deploy.

As funções e o binding em `financial_calculator_probe` são instrumentos de teste: não implementam autorização completa, catálogo protegido, lifecycle, audit transacional F2, receipt/idempotência/recovery, JWT ou serviço executor. O grant temporário da fixture de contradição também não faz parte de uma fronteira de produção. **T1 SQL foundation permanece pendente**, assim como T3–T8 e aceite do piloto. O próximo SQL deverá congelar grants/dependências/objetos/policies, testar instalação atômica com drift hostil, revalidar identidade/par/autoridade, implementar aquisição/audit/lifecycle e provar coexistência 0015–0019 antes de qualquer confirmação específica hospedada.

## Limpeza e fingerprints

Cada rodada verificou `stop()` e `ENOENT` do diretório próprio. A conferência posterior confirmou ausência dos diretórios e de processos PostgreSQL correspondentes; GREEN final: `/private/tmp/structr-app-principal-pg-uFrQWN`. Nenhum cluster próprio permaneceu ativo.

| Artefato final | SHA-256 |
| --- | --- |
| `server/financial-calculator-physical.test.ts` | `469ce892a754a68e51487d66e5d2bf910dcfcb7b3a3fbb1aa08c958933cd73aa` |
| `server/test-support/financial-calculator.ts` | `b8c71940361667e19749233add4eab6413239cebf99c2c006cb0b53344f3d6ef` |
| `server/test-support/financial-calculator/probe.sql` | `eaa4b64f218895ccd04b015974debad54a1501253589c1cf70fa3a45e5b20811` |
| `server/test-support/financial-calculator/contradiction.sql` | `d96472e15ace85924ec8e296222066aa6d2fd60dcc6c917b2a21579d6898e7c3` |

Reprodução nominal: `env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/Users/wsilva LANG=C APP_PRINCIPAL_LAB=1 FINANCIAL_CALCULATOR_PHYSICAL=1 pnpm exec vitest run server/financial-calculator-physical.test.ts`. Requer o binário PG17.11 local já instalado e permissão para iniciar o processo próprio; não aceita URL externa.
