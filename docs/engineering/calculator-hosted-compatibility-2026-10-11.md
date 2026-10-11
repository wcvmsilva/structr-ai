# Calculator — compatibilidade hospedada, 11 de outubro de 2026

**Estado: três correções locais implementadas e aprovadas nas revisões por frente e na revisão integrada; publicação condicionada à suíte geral/CI.** O responsável autorizou resolver os três bloqueios locais: permissões Supabase, conexão/infraestrutura e retirada coordenada. A condição da [ADR-003](../adr/ADR-003-pilot-financial-executor.md) continua: confirmar especificamente credenciais e acesso depois do pacote concreto e da revisão. Nenhuma escrita hospedada, credencial, compra, deploy ou abertura foi realizada nesta rodada. Homologação e uso em campo não estão aprovados por este documento.

Base do incremento: `a6e518b4044f339e51fd1e10a80d33eeef820609`, [PR #50](https://github.com/wcvmsilva/structr-ai/pull/50). O ajuste documental sobre Pro é `c98d7eb9`; conexão/TLS revisada é `e7af7390`. Compatibilidade SQL revisada: `1d881b0e`; retirada revisada: `7834ba4a`. A revisão integrada independente aprovou `ba7aa6d3847980ea0edd2ae2fa71d5c85e6cdf6a` sem achados; resultados gerais e CI pertencem ao gate final de publicação. Os 118 testes novos da rodada anterior são baseline, não novos testes desta rodada.

## Observação e limites

A inspeção usou somente metadados e catálogo; não leu credenciais, hashes de senha nem dados de clientes. O inventário completo preservado no diretório privado possui 1.047 objetos, 810 registros de superfície e 80 registros complementares de views, regras, triggers, event triggers e membros de extensões. Identificadores pessoais e destinos reais permanecem fora do Git. Contagens não são prova de segurança: o manifesto e a revisão das definições/caminhos são necessários.

O administrador nominal `postgres` observado é CREATEROLE/BYPASSRLS, não superuser. Já herda `pg_monitor` (que fornece `pg_read_all_stats`) e `pg_signal_backend`; o laboratório reproduz essas capacidades existentes para verificar observação e encerramento de sessões. Esta rodada não propõe concedê-las de novo. As permissões do login financeiro continuam separadas.

A amostra de capacidade de 2026-10-11 22:53:23 UTC encontrou `max_connections=60`, três posições reservadas a superuser, zero `reserved_connections`, cinco conexões de clientes e treze backends totais. Treze backends não equivalem a treze conexões de clientes. A amostra não reserva capacidade nem prova um pico futuro.

## Conexão e infraestrutura

O candidato fornece uma factory administrativa com destino/principal/database fixados independentemente, arquivo secreto privado validado e encerramento determinístico. Não há CLI que a execute, fallback por ambiente ou conexão durante importação. A factory exige proprietário local, modo 0400/0600, arquivo regular, vínculo único, ausência de symlinks e leitura estável; erros/logs não revelam a senha. O pool administrativo tem no máximo uma conexão. A validade da janela controla admissão; não é retirada automática de sessões.

A correção concreta de compatibilidade é confiança explícita no certificado público Supabase, além da verificação normal de cadeia e hostname. O runtime exige `FINANCIAL_EXECUTOR_DATABASE_CA_CERT` e `FINANCIAL_EXECUTOR_EXPECTED_DB_CA_SHA256`; não utiliza fallback de certificado. [Certificado público revisado](../../services/financial-executor/certs/supabase-root-2021.crt), PEM SHA-256 `700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7`, proveniente do link de download do painel e da [orientação oficial SSL](https://supabase.com/docs/guides/platform/ssl-enforcement). Uma negociação TLS nativa Node 24.14.0 confirmou cadeia/hostname/TLS 1.3 sem autenticação nem SQL; não comprova Node 22/Vercel. A imposição global de SSL do servidor foi observada desligada e permaneceu inalterada; o cliente exige TLS verificado.

[Proposta imutável de infraestrutura](../../scripts/financial-executor-homologation/infrastructure.ts): projeto novo `structr-financial-executor-homolog`, Preview/homologation, Node 22, região iad1, publicação manual e Git desabilitado. A credencial nominal será exclusiva do executor Preview; nunca do web, Production ou equipe. ID/origem serão fixados por readback após criação fechada autorizada, antes do segredo. A proposta de Deployment Protection=None afeta somente esse projeto novo e preserva JWT/autoridade de aplicação, web e equipe; não acrescenta segredo de bypass.

O Pro existente está confirmado. O add-on IPv4 proposto é separado, [US$0,0055/hora, aproximadamente US$4/mês](https://supabase.com/docs/guides/platform/manage-your-usage/ipv4), ainda não adquirido. A janela proposta tem no máximo duas horas, 200 chamadas HTTP intencionais e uma verba de uso de US$5, além do IPv4. Uma estimativa de 200 chamadas × 35 s × 2 CPUs/4 GB, pelas [tarifas Fluid iad1](https://vercel.com/docs/functions/usage-and-pricing), resulta em cerca de US$0,581 de processamento/invocações, excluindo build, rede e tráfego inesperado. Não é garantia nem limite rígido de cobrança. Conferir memória/CPU reais antes do segredo e interromper por tráfego inesperado ou desvio de verba/capacidade. Nenhuma mudança de Spend Management da equipe foi feita.

Limite proposto: duas conexões normais do login financeiro e uma administrativa. Antes da abertura e durante a execução, exigir pelo menos dez posições ordinárias livres após projetar essas três conexões, descontando as reservas do PostgreSQL. É condição de admissão/interrupção, não reserva. `CONNECTION LIMIT` é aproximado e não limita instâncias serverless. A prova hospedada ainda deve demonstrar a terceira conexão recusada, identidade real, transação estável, cancelamento, recuperação e retirada.

## Permissões e retirada

O novo catálogo separa os 1.011 objetos aplicativos dos 36 membros exatos de pgcrypto, cuja instalação hospedada ocorre em `extensions`. Não move a extensão nem adota diferenças arbitrárias como baseline. As definições e ACLs geridas são congeladas por identidade/hash, incluindo todos os defaults de criação de objetos. A revisão independente detectou que a primeira versão omitia defaults de outros owners nos schemas aplicativos; a correção passou por dez contraprovas físicas RED/GREEN. O [mapa de revisão SQL](../security/financial-executor/homolog-compatibility-review.md) identifica os artefatos e as provas definitivas.

A instalação admite somente as três edges administrativas automáticas de `postgres`, com ADMIN OPTION e sem INHERIT/SET no estado final. A instalação fechada usa somente as associações temporárias próprias necessárias; a manutenção de retirada usa herança temporária dos dois owners, sem SET ROLE, dentro da transação auditada. O teste de retirada registra três associações antes, cinco durante e três depois; falha na auditoria reverte a alteração inteira. Os principals financeiros não recebem memberships de saída, BYPASSRLS, CREATE, TEMP ou acesso bruto às tabelas.

As duas views geridas de estatísticas com SELECT PUBLIC permanecem apenas como ACL latente: a identidade financeira não possui USAGE no schema nem wrapper autorizado que as alcance. A prova física tenta o SELECT real e demonstra recusa. Qualquer mudança fora do perfil exato é recusada; não existe uma dispensa geral por nome de schema. A proposta separada de contenção TEMP conserva o direito efetivo dos destinatários existentes enumerados e remove a herança genérica de PUBLIC. Essa ACL explícita persiste após a janela; não é revertida automaticamente ao fechar o Calculator.

A coordenação combina dois manifestos distintos, um para RBAC e outro para fixture, sem prometer uma única transação entre ambos. Verifica recibos de operações já confirmadas e compensa preparação parcial comprovada; COMMIT de resposta incerta não dispara repetição cega. A fase W2 desativa o binding antes de NOLOGIN/revogação/encerramento, permitindo comprovar recusa de autorização com o mesmo bearer ainda válido e transporte ainda aberto. Depois retira os quatro EXECUTEs, fecha o login, termina somente sessões com PID e horário de início conferidos e restaura a role anterior de O.

Ausência de evidência não é sucesso: receipt de fixture ausente com vestígios financeiros retorna `cleanup_pending`, sem restaurar RBAC nem afirmar contenção. Recibos pareados corrompidos podem causar recusa antes de retirar autoridade. O helper financeiro independente pode ser usado quando apenas a evidência RBAC está danificada e a evidência financeira continua íntegra; se esta também estiver danificada, um procedimento administrativo adicional precisa de revisão. Este pacote não oferece bypass de auditoria nem promete encerramento financeiro em todos os casos de corrupção.

## Validação e revisão por frente

| Frente | Evidência local atual | Limite |
| --- | --- | --- |
| Conexão/TLS/configuração | 56 casos novos; 154 focais aprovados, zero falhas/skips; dois typechecks e build isolado aprovados. Revisão independente do snapshot exato sem achados. | Metadados SQL positivos do teste TLS são sintéticos; testes negativos usam o driver real. Node 22/Vercel autenticado não executado. |
| Compatibilidade SQL/manifesto | 71 casos novos. Na correção final: 69 testes puros/geridos e 116 regressões físicas passaram; os dois testes TEMP anteriores continuam aplicáveis à fonte inalterada. Revisão independente inicial e da correção concluídas, sem achados restantes. | São 185 aprovações novas de execução mais duas provas TEMP preservadas, não uma suíte única de 187 casos. Aplicação hospedada exige confirmação. |
| Coordenação/retirada | 38 casos novos; 156 focais aprovados, zero falhas/skips. Os dois achados foram corrigidos e a revisão independente da correção aprovou o candidato. | Recibo corrompido ou ausente não comprova fechamento; os limites estão descritos acima. |
| Integração do runtime | 61 casos físicos adicionais da base passaram no candidato: transação, ciclo financeiro, integração e jornada web. Typechecks administrativos/runtime e os dois builds passaram. | São regressões exercitadas, não 61 casos novos. Nenhuma prova hospedada. |
| Verificação conjunta/publicação | Suíte padrão completa, CI e revisão final da branch são gates da publicação. | A revisão integrada aprovou a fonte; resultados completos são registrados na PR de publicação. Os testes físicos opt-in são relatados separadamente. |

As provas locais usam exclusivamente PostgreSQL 17.11 descartável criado pelo harness, sem aceitar conexão externa. Nenhum teste ignorado é contado como aprovado. O [registro de evidência local](../security/financial-executor/homolog-compatibility-local-evidence-2026-10-11.json) fixa hashes dos 41 arquivos de código, testes e dados executáveis alterados, checks e contagens. A rodada adiciona **165 casos distintos: 107 padrão e 58 físicos opt-in**. As reexecuções e os 118 casos da rodada anterior não aumentam esse total. O [pacote de confirmação](calculator-homologation-package-2026-10-10.md) mantém execução hospedada e aceite posterior separados.


## Relatório de conclusão local e limite de entrega

| Requisito | Resultado |
| --- | --- |
| TypeScript | `pnpm check`, `pnpm check:calculator-homologation` e `pnpm check:financial-executor`: sem erros. |
| Testes novos | 165 comportamentos distintos; grupos focais acima aprovados. A suíte padrão completa é obrigatória no pre-push e no CI. |
| Builds | Web hospedado e executor isolado aprovados. O web conserva avisos existentes de configuração opcional de analytics e tamanho de chunks. |
| Arquivos criados/modificados | Fontes, testes, SQL, certificado público e manifestos enumerados com SHA no registro de evidência; pacote/protocolo/plano/README/estado/tarefas atualizados. Nenhum `.env` ou segredo. |
| Tabelas, funções de engine e endpoints de negócio novos | Zero. O incremento modifica a fronteira existente e acrescenta ferramentas administrativas. |
| Helpers novos | Inspeção/classificação de compatibilidade; validação da fronteira; manutenção temporária dos owners; contenção TEMP; conexão administrativa; coordenação de preparação, abertura, desativação e retirada. |
| F1 | Fronteiras autenticadas existentes preservadas; nenhuma nova rota pública de negócio. |
| F2/F5 | Mutações administrativas persistentes usam transações Drizzle reais, `logAudit` e readback; terminação de sessões usa intenção durável e confirmação, sem prometer rollback de um processo encerrado. |
| Regressões | Provas focais aprovadas; suíte padrão/CI e revisão final condicionam integração. |

A publicação de fonte não publica o produto: a branch de trabalho e `main` conservam a ativação automática web desabilitada, e o executor tem Git deployment desabilitado. O ambiente hospedado segue fechado. Antes da abertura faltam os readbacks do destino criado sob confirmação, manifestos privados nominais/horário, procedimento protegido e auditado de provisionamento/rotação da credencial, identidades negativas ativas e mecanismos hospedados de falha controlada. `openCalculatorHomologation` habilita LOGIN/validade/limite; não cria a senha. A primeira confirmação proposta pode cobrir somente a preparação fechada, nunca presumir aprovação de todas essas etapas.


A primeira execução do hook geral impediu o push: **8.460 aprovados, uma falha e 1.765 ignorados**. A falha era a expectativa literal dos hashes antigos de 0020/0021 em `migration-history-reconcile.test.ts`. A correção mantém a verificação literal e atualiza somente os dois digests para os bytes SQL já revisados; não recalcula automaticamente o esperado nem altera produção. A suíte focal passou 42/42 depois do ajuste; a reexecução obrigatória do hook continua sendo requisito de publicação. A evidência final da PR/CI prevalece sobre esse checkpoint RED, que permanece registrado para rastreabilidade.
