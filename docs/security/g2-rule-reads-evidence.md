# G2 — evidência local de listagens e agregados

Observação: 2026-09-15, 20:45 UTC. Repositório: https://github.com/wcvmsilva/structr-ai.

## Resultado e fronteira

Implementação local preparada e verificada para o recorte de regras geográficas descrito em `g2-rule-reads-plan.md`. Listagem e contagem agora exigem a empresa do contexto, excluem regras de outra empresa e regras sem empresa e propagam esse contexto aos sete consumidores. Filtros públicos zone/trade passam a funcionar; falha de banco interrompe a operação com erro sanitizado. Não houve publicação, integração com main, alteração da PR9 ou uso do Supabase.

**Ainda não é fechamento formal da unidade:** o diff está não commitado sobre `4534bec201fa22629a4a104b24c039f42faff265`, na branch `codex/g2-rule-reads-20260915`, diretório `/private/tmp/structr-g2-rule-reads-20260915`, sem upstream. O SHA acima é a base, não contém estas mudanças e não deve ser apresentado como SHA do código testado. Identidade do candidato: base + hashes dos arquivos + delta no manifesto local. Resulting post-commit SHA e revisão formal vinculada a esse SHA: pendentes. Nenhum gate formal recebe PASS/GO nesta entrega.

## Fontes, estado e autoridade

- `AGENTS.md` da base: execução delimitada, TDD e evidência de tipos/regressão. O código e o harness usam PostgreSQL/Drizzle; a referência MySQL no manual é histórica, não justificativa para outro banco nesta prova.
- Controlled Engineering Workflow em `f60cf9a56679d4d7083b2c11ac4e2727d53d84c3`: registros de estado, decisões e Security Gate lidos na sua linhagem. Sem cópia ou fusão dos documentos para este ramo.
- Registro canônico main `8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf`, blob `b9e144e5b25b0c9dcfbcc0790b12931bc78713b2`; procedimento de manutenção, blob `6455caef19bbabb293ffd9104c67a5b73f487988`. Conteúdos publicados já preservados no dossiê `/private/tmp/structr-g3a3-sha-review-20260915`; não são documentos novos nesta linhagem.
- Autorização humana “Okay! Autorizado”, após a continuidade proposta de listagens/agregados G2. Contratos, cinco arquivos e exclusões fixados em plano; implementado somente depois de RED comportamental. Consolidação/publicação não estão sendo declaradas como concluídas.
- Task 6 e publicação documental pelas PRs12/13 permanecem encerradas. F5b, G3a-2/G3a-3, G2-1 CRUD e correção de precondição de perfil mantêm seus encerramentos delimitados. Nada foi reaberto.

Refs remotas reconfirmadas por leitura, sem fetch/pull:

| Referência | SHA observado |
|---|---|
| main | `8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf` |
| workflow/controlled-engineering-workflow | `f60cf9a56679d4d7083b2c11ac4e2727d53d84c3` |
| security/tenant-isolation-remediation-20260821 | `b95ea0bf4741646f418fcc99a22d22a42d24be51` |

PR9: OPEN, não draft, `mergedAt=null`, head b95ea0bf, baseRefOid `233569d68c014712ce3d25326bda8823aab1987e`. Essa metadata não é a main atual nem prova integração/merge. O objeto local **main8fa continua ausente**; não foi recuperado. Isso limita a futura integração, mas não impede avaliar este delta local sobre a base aprovada. Não foi detectado conflito novo na base usada; mergeabilidade com main não foi avaliada.

O primeiro acesso remoto falhou por resolução de DNS do sandbox; a repetição autorizada de leitura retornou os SHAs e a metadata acima. Checkout main e checkout lead anterior permaneceram limpos. Consultas Git com `GIT_OPTIONAL_LOCKS=0`; inventário de worktrees e estado completo em `local-state.json`.

## Antes, depois e aceitação

Antes, a consulta filtrava atividade sem ownership; o agregado contava regras externas; zone/trade públicos eram ignorados; `getDb=null` retornava `[]`. Nos testes PG, isso retornou B/NULL e afetou os resultados reais dos engines. Depois:

1. Ambas as consultas aplicam `tenant_id=owner`, inclusive para admin e nos dois modos de TENANT_STRICT; não há exceção para tenant NULL nem assinatura antiga sem tenant.
2. `activeOnly=false` inclui inativas somente da própria empresa. zone/trade presentes, inclusive `""`, são igualdades AND; trade normaliza no router. zoneId interno preserva a semântica anterior. Ordenação por overrideType preservada sem promessa entre empates.
3. Agregado filtra ownership/atividade antes de agrupar por zoneId. Grupo de zoneId NULL de regra própria é legítimo. COUNT convertido pelo driver a number e ordem decrescente mantida.
4. Contexto ausente recusa antes de obter banco. Erro de aquisição/consulta ou banco ausente retorna mensagem constante, sem SQL/cause original; consulta própria vazia continua vazia.
5. Seis rotas recebem tenantProcedure; seedAPI conserva adminTenantProcedure; seed operacional usa SEED_TENANT_ID existente. Guards de pai permanecem. Pai NULL permitido pelo guard não substitui a autoridade do contexto A.
6. Preview, resolve com persistLog:false e remodel foram exercitados com readers PostgreSQL e engines reais: B/NULL não influenciam assemblies nem rulesEvaluated. Falha impede o prosseguimento e evento de sucesso. Em visualização, histórico é lido antes da lista; não se afirma ausência dessa leitura prévia.

## Execuções observadas

Prefixo limpo: `env -i PATH=/usr/local/bin:/usr/bin:/bin NODE_ENV=test CI=1`. Comandos completos no plano e em `execution-results.json`. Logs e manifesto em `.superpowers/sdd/g2-rule-reads/`.

| Execução | Resultado |
|---|---|
| Baseline tipos | 0 erros, exit0 |
| Baseline suíte | 2.882 passaram / 219 ignorados, exit0 |
| RED PG, somente same-api, antes de produção | 27 falhas esperadas / 2 controles passaram / 17 casos diretos candidatos não selecionados, exit1 |
| RED callers | 19 falhas esperadas / 17 controles passaram, exit1 |
| GREEN PG novo | 46 passaram, exit0 |
| GREEN focal: callers + CRUD normal + seed-context | 70 passaram, exit0 |
| Regressão CRUD PG existente | 50 passaram, exit0 |
| Suíte normal final | 2.918 passaram / 265 ignorados, exit0 |
| Tipos aplicação final | 0 erros, exit0 |
| Tipos dos testes, incluindo dois históricos alterados | 0 erros na configuração local final, exit0 |
| Auditor tenant | exit0; 44 avisos e 6 lacunas históricas; medição, não prontidão |

**82 testes novos**, dos quais36 na suíte normal e46 no laboratório opt-in. Os96 casos PG executados separadamente (46 novos+50 regressão) estão entre os265 ignorados pela suíte normal: 3.014 testes distintos passaram nesta rodada;169 permanecem não executados. O focal repete testes já contados. Não somar seus70 ao total. A prova PG de perfil lead de rodada anterior não foi repetida nem contabilizada como resultado atual.

PostgreSQL17.11 local descartável, socket privado, TCP desligado, ambiente de conexão restrito e dados sintéticos. Reutilização byte-idêntica do harness de G2-1; schema sem alteração. DDL do laboratório deriva das colunas reais, sem FKs externas ou RLS; não comprova políticas/integração de produção. Conexões de aplicação/observação separadas; queries reais registradas, snapshots antes/depois iguais em cada caso de leitura; cluster encerrado e diretório removido pelos hooks verificados. Nenhum seed operacional real executado.

## Proveniência e correções explícitas

- Fonte dos callers idêntica entre RED/GREEN: SHA256 `110ca2e20efc38b5055cbe5b121cab5a3b4216020b20773af52920da853c79be`.
- Fonte PG no RED: `7d209cc17b0bfc6b1fc199d78d19e17d354e08097fa104f4399ec6c9f50b37d5`; no GREEN: `cd34d075d71f20a6606e820c7a36ca157211a22182b097ecaf3b89e010ba326f`. Única mudança: `const ctx = context(); ctx.tenantId = undefined;` passou a `const ctx = Object.assign(context(), { tenantId: undefined });`, preservando o mesmo valor inválido em runtime para tipagem. Revisor recompôs em memória o hash RED por reversão somente dessa expressão; não foi reivindicada nova reprodução RED. Manifesto original preservado.
- O primeiro typecheck explícito dos testes encontrou TS2802 num iterador já existente do seed-context, devido ao target ES5 implícito. Configuração temporária recebeu target ES2022 e incluiu também o teste CRUD histórico alterado. Tipos de aplicação não foram relaxados; nenhum teste removido, nenhuma opção de produção alterada. Log inicial de falha e log/exit final preservados.
- Duas expectativas históricas de descoberta de seed receberam o novo argumento tenant depois do baseline e RED, com nota HISTORY. As assertivas de criação continuam presentes; relatórios históricos não foram reescritos.
- IDs, impactos e contratos da matriz foram registrados antes de produção. Suas seis colunas completas (arquivos/evidências/revisores) foram detalhadas após GREEN. Esse aperfeiçoamento documental não é apresentado como uma etapa integralmente concluída antes do patch.

## Revisões e capacidades

Autor de produção/PG: `/root`. Autor dos testes callers e adaptações históricas: `/root/lead_internal_quality`. Revisores preparatórios distintos dos autores: `/root/lead_profile_scope_review` e `/root/field_readiness_audit`, leitura independente de diff, código, testes e logs, sem mutação, execução de testes ou acesso de banco/rede. Nenhum achado BLOCKER/REQUIRED de código dentro do claim. Pareceres e hashes delimitados no registro local de revisão. Não equivalem ao Gate7 formal em SHA resultante ainda inexistente.

Matriz das15 capacidades e seus critérios está no plano. Dimensões implementação, validação operacional, segurança, confiança, verificação, ciclo de vida e roadmap não foram promovidas. Não foram alteradas linhas do registro, totais ou suas duas visões. Evidência deste delta não converte capacidades completas a CURRENT/Validated nem resolve a correspondência canônica de P-09.

## Limites e próximo ponto

- **C-11/UI:** Review.tsx ignora error e ainda pode exibir ausência de overrides diante de falha da API. O claim de erro seguro é dos readers/API.
- **Seed:** leitura isolada pode revelar placeholders inválidos antes ocultados pelo skip global. Sem reparo de UUIDs, transação/auditoria completa, idempotência operacional ou rollback de etapas anteriores.
- **Visualização:** input numérico permanece incompatível com UUIDs reais. Testes comprovam contexto na fronteira controlada, não fluxo funcional completo.
- **G2 ainda aberta:** helpers de logs, sua persistência e demais contratos não foram fechados por este recorte.
- **Outras unidades:** G1 rule-F2/F5, G4a e escritores de identidade/privilégios/contratos físicos de IDs mantêm disposição própria. G3b/G4b e legado/backfill não se tornam bloqueios automáticos de todo recorte.
- **PR9/campo:** integração com main, provas globais de isolamento/autorização, ambiente efetivo, grants/RLS, ensaio do percurso comercial e recuperação continuam pendentes. PR9 NO-GO; sem estimativa de prazo ou percentual de prontidão. Contenção atual do Supabase não foi reconfirmada nesta rodada.

**Uma próxima ação humana:** autorizar a consolidação deste delta revisável em commits locais de código e documentação, para então revisar o SHA resultante. Não inclui push, PR, merge, deploy, banco, nova unidade, automação ou Phase3. A distinção entre implementação, commit, publicação e merge vem do Security Gate publicado (seção Human Gate); não é uma exigência nova de skill.

## Relatório de conclusão do recorte de implementação

- Tipos: zero erros. Testes:82 novos;3.014 distintos executados, zero falhas finais;169 não executados explicitamente preservados.
- Produção modificada: `server/geo-override-db.ts`, `server/geo-override-router.ts`, `server/remodel-router.ts`, `server/workflow-visualization-router.ts`, `server/seed.ts`.
- Criados: dois testes e estes dois documentos. Modificados ainda: duas expectativas em testes históricos.
- Novas tabelas, funções de engine, helpers e endpoints: zero. Contratos de dois readers e seus consumidores ajustados.
- Autenticação/tenant nas rotas do recorte: sim. Nenhuma nova mutation introduzida; auditoria existente preservada, sem alegação de corrigir todas as mutations ou durabilidade global.
- Regressões observadas: nenhuma. Conclusão formal da unidade e publicação: pendentes.
