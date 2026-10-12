# Calculator — credencial e OIDC, 12 de outubro de 2026

Prova histórica da implementação local, anterior à correção de portabilidade: **116 testes novos distintos**, **346 testes focais aprovados** e três checks TypeScript aprovados. A suíte padrão final passou **8.552 testes**, com **1.790 ignorados**, zero falhas e sem seção de erro não tratado; Revisão independente completa até `56f6b3131868984879dd7c1d3071d2d6b8d2f832`: **READY TO MERGE para candidato local fechado**, zero bloqueios. Testes explícitos de injeção de falha fsync de arquivo/diretório ficam diferidos como P3; cronologia RED original da Task 2 não certificada. Push inicial passou check/suíte obrigatórios (8.552 aprovados/1.790 ignorados, zero falhas). [PR #52 draft](https://github.com/wcvmsilva/structr-ai/pull/52) publicada; [checks vivos da PR](https://github.com/wcvmsilva/structr-ai/pull/52/checks) são a referência de CI. Este adendo documental é posterior ao head revisado e não afirma revisão própria, CI aprovado, merge ou aceite hospedado. Nenhuma credencial real, grant, compra, build/deploy ou abertura Calculator foi executado neste incremento. A leitura do projeto já existente, em **2026-10-12T23:09:07Z**, confirmou estado fechado: zero deployments/variáveis, `live:false`, `latestDeployment:null` e proteção SSO. IDs e identidades pessoais permanecem no pacote privado.

Fonte corrente mapeada (helper de teste corrigido): `efdc929bbf1e34493f267605d234e2822d0df126`; runtime de produção inalterado desde a fonte revisada `c38e1ec7fb37d890df138758ddde22c769086678`; Task 1: `5952b90a6683503a46982e553779781fc2b48ea6`; baseline: `c3e15a2d634382816d4df94dcf691fceadac58d8`, árvore idêntica à base integrada `050dc954`. O [mapa corrente](../security/financial-executor/credential-local-evidence-2026-10-12.json) fixa 52 arquivos executáveis/SQL/manifestos/testes e `sourcePinsSha256=8eb116952a6ffe5d8e08df6c790ec89bd23f30d6c7be307e31c2f40d8d3d5669`. Os 41 pins de 11/10 são históricos; a união inclui os 17 arquivos alterados desta rodada e exclui a referência histórica a README (prosa). Um futuro commit de documentação/merge pode identificar a execução com bytes executáveis idênticos; sua revisão e comparação continuam obrigatórias. Hashes não são autorização, assinatura ou prova de deployment.

## Correção de portabilidade do CI

O [run Linux inicial](https://github.com/wcvmsilva/structr-ai/actions/runs/38322652216) falhou em 11 casos com ENOENT no `/private/tmp` fixo do helper de testes. O commit `efdc929bbf1e34493f267605d234e2822d0df126` usa o diretório temporário da plataforma resolvido para o caminho canônico; somente `server/test-support/calculator-credential-runner.ts` mudou. Runtime de produção, entrada operacional, guard de proveniência do cluster próprio e permissões 0700/0600 permanecem inalterados.

Validação nova local: 44 casos não físicos e 25 físicos aprovados, `pnpm check` exit 0; os 11 casos de processo passaram novamente com TMPDIR customizado via symlink. Uma prova comportamental separada falhou antes da correção por ignorar esse TMPDIR e passou depois, conferindo caminho canônico, propriedade, modos e limpeza. Não se adicionaram testes à suíte: continuam 116 casos novos distintos na branch. Os 346 focais e 8.552/1.790 da suíte abaixo são históricos; não representam reexecução integral desta correção.

A revisão anterior até `56f6b313` e a revisão documental até `d0078bd8` conservam seu escopo. A correção exige revisão própria, hook integral e CI Linux do head final; os [checks vivos](https://github.com/wcvmsilva/structr-ai/pull/52/checks) são a referência, sem sucesso antecipado. RED Linux, RED/GREEN local e resultados estão retidos no novo `ci-portability-report.md` e no mapa; os 28 hashes de evidência anteriores permanecem intactos.

## Verificação e limites

| Evidência observada | Resultado |
| --- | --- |
| `pnpm check`, `pnpm check:financial-executor`, `pnpm check:calculator-homologation` | Três exit 0; zero diagnósticos TypeScript. |
| Focal não físico (8 arquivos) | 232 aprovados, zero falhas/skips. |
| Focal físico em PostgreSQL descartável próprio (4 arquivos) | 114 aprovados, zero falhas/skips. |
| Novos casos distintos | Task 1: 47; Task 2: 69 (44 padrão + 25 físicos); total 116 (91 padrão + 25 opt-in). |
| Suíte padrão final `pnpm test` | Exit 0: 8.552 aprovados, 1.790 ignorados; 243 arquivos aprovados/59 ignorados; zero falhas, sem seção de erro não tratado; 318,75s. |
| Revisão independente | Task 1 limpa; Task 2 SPEC PASS / QUALITY APPROVE; revisão documental corrigida e de toda a branch completas em `56f6b3131868984879dd7c1d3071d2d6b8d2f832`: READY TO MERGE para candidato fechado, zero bloqueios; P3 fsync diferido. |
| Publicação inicial e CI | Check/suíte do hook obrigatórios exit 0: 8.552 aprovados/1.790 ignorados, zero falhas, 251,26s. [PR #52 draft](https://github.com/wcvmsilva/structr-ai/pull/52); CI corrente nos [checks vivos](https://github.com/wcvmsilva/structr-ai/pull/52/checks), sem atestado antecipado de sucesso/merge. |
| TDD | RED/GREEN Task 1 retidos; RED/GREEN da emenda de recuperação retidos. RED original Task 2 indisponível: ordem histórica não certificada. |

A base teve 8.461 aprovados/1.765 ignorados; os deltas atuais de +91 padrão/+25 opt-in correspondem aos 116 novos casos. Vitest imprimiu total declarado 10.414, divergente da soma das duas classes; este registro conserva as contagens rotuladas observadas sem reinterpretar o total. Nenhuma fonte foi alterada durante a suíte final.

Os grupos focais incluem regressões da base; execuções repetidas não aumentam a contagem. Todos os passwords gerados são sintéticos, em diretórios/cluster descartáveis próprios. O primeiro focal físico teve 110 aprovações e quatro falhas: um timeout herdado de 5s em prova com novo processo causou três falhas dependentes. Somente os budgets de testes foram ampliados (15/20/30s); a execução final conjunta aprovou 114. O log falho está preservado. Nenhuma aprovação local é um caso hospedado aprovado, nem certificação irrestrita de sprint/TDD.

As evidências brutas e os reports Task 1/2/revisão ficam em `.superpowers/sdd/2026-10-12-calculator-credential/`, ignorado; o JSON público identifica os logs, resultados e lista exata de arquivos. Não se apagam receipts, drafts sintéticos nem auditorias para repetir a execução.

## Decisões preservadas do ledger

| Decisão | Consequência operacional |
| --- | --- |
| OIDC automático, sem depender de OFF depreciado | Issuer Team; build/runtime futuro reconhece identidade automática. Não pedir/exportar token, criar trust ou usar AI Gateway/Sandbox. OIDC não substitui JWT Supabase nominal. Se a premissa mudar, verificar antes da ativação. |
| Verifier SCRAM pode aparecer no contexto CSV nativo de locks/FATAL | Preservar logging e privilégios. Aceite informado dos leitores identificados mais inventário OAuth OU atestado explícito antes de geração/instalação/entrega. Se recusado, manter fechado e buscar infraestrutura revisada. Senha em claro continua fora de SQL/audit/logs da aplicação. |
| Lifecycle mínimo: provision/replace antes da primeira abertura, recover sem reenvio | NOLOGIN/zero sessões e receipt atual exigidos; após abertura, incidentes exigem retirada terminal. Não há retomada/revival. Custo é encerrar o piloto em lugar de rotação ao vivo. |
| Contenção em processo único antes do import do driver | Falha postgres-js 3.4.8 fora do catch exige handlers fatais prévios, saída fixa `uncertain`/70 e recuperação por novo processo/conexão, sem repetir escritor ou reutilizar pool falho. Driver não atualizado; custo é startup. |
| Admissão read-only de recuperação independente da janela financeira | `admissionExpiresAt` UTC explícita, futura e <=15min, somente recover; consulta receipt após expiração sem alterar credential/binding/janela. Provision/replace rejeitam o campo. Não transforma incerteza em rollback. |
| Auditoria/retirada e três sistemas distintos | Arquivo preservado antes da DB mutation; logAudit/readback substantivos na transação real. Banco, filesystem e entrega Vercel não têm atomicidade distribuída. Intenção durável, efeitos e completion da retirada são fases separadas. |
| Revisão P2 da audiência pública | Publicar categorias observadas (um Owner, token legado de terceiro full-scope não expirável, conector de agente com logs e OAuth não enumerado); preservar identidades exatas somente em privado. Sem condição cumprida, nenhuma geração/instalação/entrega. |
| Export limpo e inspeção de upload | Fonte rastreada exata revisada, comparação de pins; segredo administrativo/artefato/comando/evidência privada fora da raiz enviada. Git ignore não basta. Nenhum deployment agora. |
| Cobertura adicional diferida de fsync — P3 não bloqueante | Revisão final confirmou que a implementação aguarda fsync de arquivo/diretório, recusa falhas e conserva o artefato sem overwrite/deletion. Faltam testes explícitos de injeção dessas falhas; não afirmar prova executada nem garantia de durabilidade contra perda de energia. |

## Contrato implementado e inventário

Nenhuma tabela, migration, função de engine de domínio ou endpoint de negócio novo. Não há `publicProcedure` novo. Os endpoints protegidos existentes mantêm seus guards; o gate existente `openCalculatorHomologation` agora exige referência/geração corrente e cadeia íntegra. Provision/replace usam `db.transaction()` SERIALIZABLE, lock compartilhado, adapter substantivo `logAudit` e readback de audit/chain antes do COMMIT: nenhuma exceção F2/F5 foi criada.

Interfaces novas ou agora exportadas: `planCalculatorCredentialArtifact`, `stageCalculatorCredentialArtifact`, `readCalculatorCredentialArtifact`, `parseCalculatorCredentialMetadata`, `parseCalculatorCredentialManifest`, `credentialReference`, `credentialChain`, `requireCurrentCalculatorCredential`, `assertCalculatorCredentialLoggingProfile`, `provisionCalculatorCredential`, `replaceClosedCalculatorCredential`, `recoverCalculatorCredential`, `runCalculatorCredentialProcess`. Helpers administrativos privados existentes foram movidos ao módulo compartilhado, sem duplicar arquitetura.

Arquivos criados na fonte desta rodada:

- `scripts/financial-executor-homologation/admin-internal.ts`
- `scripts/financial-executor-homologation/credential-artifact.ts`
- `scripts/financial-executor-homologation/credential-receipt.ts`
- `scripts/financial-executor-homologation/credential-runner.ts`
- `scripts/financial-executor-homologation/credential.ts`
- `server/financial-executor-credential-artifact.test.ts`
- `server/financial-executor-credential-physical.test.ts`
- `server/financial-executor-credential.test.ts`
- `server/test-support/calculator-credential-process.ts`
- `server/test-support/calculator-credential-runner.ts`
- `server/test-support/calculator-credential.ts`

Arquivos modificados na fonte desta rodada:

- `scripts/financial-executor-homologation/admin.ts`
- `scripts/financial-executor-homologation/orchestration.ts`
- `server/financial-executor-homologation-orchestration-physical.test.ts`
- `server/financial-executor-homologation-physical.test.ts`
- `server/test-support/app-principal-postgres.ts`
- `server/test-support/financial-calculator-boundary.ts`

## Próxima execução exige confirmação específica

Seguir o [procedimento de credencial](../security/financial-executor/credential-procedure-2026-10-12.md), a [decisão OIDC](../security/financial-executor/oidc-resolution-2026-10-12.md), o [pacote de homologação](calculator-homologation-package-2026-10-10.md) e o [protocolo de aceite](calculator-homologation-acceptance-2026-10-10.md). O pacote privado preserva os IDs nominais já conhecidos; disponibilidade do segredo administrativo existente é pré-requisito, nunca autorização para reset.

A futura confirmação especifica até 2h, 200 chamadas HTTP intencionais, US$5 de uso Vercel além do IPv4 (preço a reconfirmar), dois slots financeiros mais um administrativo e >=10 slots livres após projeção; não é teto automático de cobrança. Fixar e ler de volta início/fim UTC antes de preparar RBAC/fixture, mantendo a mesma janela em todas as fases. TEMP e grants enumerados persistem após retirada; nunca prometer restaurar PUBLIC TEMP. Deployment Protection=None somente no executor separado exige autorização nominal; autenticação financeira permanece obrigatória.

Operador e observador presentes durante a janela, sem watchdog hospedado comprovado. Falha/deriva/incerteza impede abertura ou inicia retirada: binding inativo, negativas com bearer ainda válido, NOLOGIN/PASSWORD NULL/REVOKE/zero sessões, restauração RBAC de O, gate web fechado e remoção do segredo runtime/IPv4 conforme autorização. `cleanup_pending` não é êxito. Casos com identidades negativas adicionais, falhas provocadas, perda hospedada de resposta e a jornada completa de aprovação/versionamento/exportação/recuperação continuam gates separados. Uso em campo permanece fechado.

## Adendo documental de publicação

A revisão independente cobre a faixa `c3e15a2d634382816d4df94dcf691fceadac58d8..56f6b3131868984879dd7c1d3071d2d6b8d2f832`. Este adendo registra sua conclusão e o push inicial, sem ampliar a faixa revisada para incluir automaticamente seus próprios bytes. No adendo documental `d0078bd8`, o código executável e sourcePinsSha256 permaneceram iguais; seus novos hashes de evidência incluíram o verdict final e o log do push inicial. A correção posterior do helper, descrita acima, atualiza o mapa corrente e acrescenta evidências sem alterar esses registros históricos. O resultado real dos checks/head final e eventual integração é registrado nos checks da PR e nas evidências finais do coordenador.

Limites da revisão: sem certificação hospedada de TLS/SCRAM, permissions, entrega/deployment/runtime, custo/capacidade/retirada ou exclusividade de leitores/OAuth. Receipt não exclui mudança posterior da senha por administrador externo; same-UID, apagamento de strings JS e perda de energia não recebem garantias superiores. A admissão de recuperação limita admissão à conexão, não duração/encerramento da sessão, e não estende autoridade financeira. Documentos OIDC não foram revalidados online pelo revisor; JWT Supabase nominal continua obrigatório. Aprovação/versionamento/exportação/jornada completa não foram certificados.
