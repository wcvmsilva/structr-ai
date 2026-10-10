# ADR-003 — executor financeiro TypeScript isolado para o piloto

**Status: PROPOSED — ratificação pendente.**
**Data:** 9 de outubro de 2026. **Decisor:** responsável pelo projeto, com revisão técnica independente.
**Escopo:** uma organização e um operador nominal; ramo Calculator até entrega financeira e recuperação.
Enquanto proposta não ratificada, este documento não autoriza criar serviço, credencial, grant, migration ou deploy; não relata prova hospedada nem libera uso de campo.

## Contexto e decisão proposta

ADR-002 mantém o web sem SQL e escolhe PostgREST como entrada autenticada. G4b §13 exige um binding criptográfico por transação para SQL direto, ainda não implementado. IF-1 e SWR-1 não autorizam cálculo nem escrita financeira.

Propõe-se um **executor Node/TypeScript em projeto Vercel separado, na equipe existente**, reutilizando os motores puros canônicos e uma conexão PostgreSQL própria mínima. Nenhum novo fornecedor é o padrão; custo incremental e adequação do runtime permanecem não verificados.

O web continua sem credencial SQL, service role ou segredo de assinatura. Seus endpoints protegidos existentes encaminham bearer e comandos nominais ao executor; não recebem uma nova conexão nem fallback administrativo. O executor valida a própria entrada, inclusive chamadas diretas ao seu endereço.

Esta é uma **mudança nominal de confiança em relação a ADR-002/G4b**, somente para as operações financeiras enumeradas neste ADR: o executor verifica o bearer e produz os valores autoritativos. O banco não verifica independentemente que o motor TS executou corretamente nem que o bearer representa o humano alegado. Um executor comprometido pode agir como o operador do piloto e produzir valores indevidos **dentro dos grants concedidos**. Isolamento de processo e principal restrito reduzem alcance; não eliminam essa confiança.

Não se implementa aqui o envelope JWK/HMAC de G4b, nem se declara GUC validado. O executor não simula `authenticator`, não fabrica claims e não chama IF-1/SWR com contexto manual. Esses fluxos permanecem no canal PostgREST aprovado.

## Principal e fronteira de banco

1. Login dedicado `NOBYPASSRLS`, não proprietário de tabelas, sem `SUPERUSER`, criação de banco/papel/replicação ou membership que permita assumir owner, admin ou service role. A única credencial SQL fica no projeto do executor; ambientes de preview não herdam a de produção.
2. Associação protegida e não editável pelo login vincula seu `session_user` real a **um perfil/subject, um tenant e uma lista exata de operações**. O caller não escolhe essa associação por argumento ou GUC. Bearer diferente do operador fixado é recusado, mesmo pertencendo ao tenant.
3. Login recebe somente `CONNECT`, `USAGE` necessário e `EXECUTE` em rotinas financeiras enumeradas; nenhum SELECT/DML bruto, SQL arbitrário ou setter de contexto. Privilégios transitivos/PUBLIC também entram na prova. Cálculo, formação de draft, revisão/aprovação, revogação, versão, entrega e recuperação têm contratos próprios; a lista não abre automaticamente todos os endpoints.
4. As rotinas resolvem e bloqueiam perfil/tenant ativos, par projeto/intake e autoridade atual; o vínculo fixo não substitui autorização. Owners definer dedicados `NOLOGIN NOBYPASSRLS`, sem ownership de tabelas/membership privilegiado, recebem apenas grants necessários, com objetos qualificados, `search_path` fixo e EXECUTE de primitives revogado. O caller não pode assumir esses owners.
5. O banco limita registros/arestas ao tenant, par, operação e estado autorizados e preserva evidência contraditória. Somente a rotina de persistência privada aceita o resultado **interno** do executor; `anon`/`authenticated` não podem executá-la. Seus checks estruturais não são uma segunda execução do motor financeiro.

**Coexistência com SWR:** a migration 0019 recusa RLS nas oito relações compartilhadas que lê. O piloto escolhe rotinas fixas com autorização explícita, sem ligar RLS genérica nessas relações e sem relaxar esse guard. Grants dos novos owners não alteram os dos owners SWR/IF-1. Uma futura estratégia RLS é decisão separada; testes físicos devem provar SWR/IF-1 inalterados e negação de acesso bruto pelo novo login.

## Comandos, transação e auditoria

O comando público contém operação, requestId, par confirmado, IDs conhecidos de assemblies, quantidades e contexto editável delimitado. **Nunca contém tenant/ator como autoridade, preços, custos, margens, modificadores autoritativos ou totais escolhidos pelo cliente.** Limite inicial: até 25 assemblies ativos únicos, quantidades inteiras 1–100; área do intake não determina quantidade automaticamente. Acesso ao workspace não concede leitura de custos ou permissão financeira.

O executor valida JWT por biblioteca mantida: assinatura/chave aprovada, issuer, audience, expiração e papel; não aceita credencial de serviço como usuário. A política de sessão será explícita: expiração JWT e desativação protegida do operador/tenant são verificadas; logout não será anunciado como invalidação imediata de um bearer ainda válido. Uma garantia adicional de revogação Auth exige mecanismo e prova próprios antes de ser oferecida.

**F5 literal:** cada operação DB de múltiplas etapas usa uma chamada real `db.transaction()` Drizzle, em uma única conexão, `SERIALIZABLE`. Dentro dela, rotinas nominais bloqueiam identidade/autoridade/par e fontes em ordem fixa, o TS calcula e a rotina de lifecycle persiste/readback/audita. Nenhuma chamada HTTP ou outro pool integra esse handle; retry integral limitado a três tentativas para 40001/40P01.

Assemblies, BOM, tipos/unidades, preços elegíveis, data/timezone e políticas vêm desse snapshot protegido. Deve existir exatamente o preço compatível exigido; fontes ausentes/ambíguas/contraditórias recusam. Erro de aquisição não vira preço zero ou multiplicador 1.0. Fontes compartilhadas só entram quando classificação e consumo forem explicitamente permitidos; defaults legítimos têm contrato e proveniência.

Simular e salvar usam o mesmo adaptador e `calculateMultipleAssemblies`/`transformBatchToEstimateDraft`. Salvar recalcula no próprio transaction handle; se divergir do cálculo confirmado, retorna conflito sem gravar e exige nova confirmação. Hash de fontes serve para detectar mudança, nunca para conferir autoridade ao cliente.

**F2 literal, com adaptação real necessária:** cada mutation chama `withAuditLog()` ou `logAudit()`. Hoje `logAudit(params, tx)` faz INSERT direto em `audit_logs`, incompatível com o login EXECUTE-only. A implementação deverá estender nominalmente `withAuditLog(tx, …)` para invocar a rotina de lifecycle que obriga mudança + readback + audit na mesma transação e conferir seu recibo completo. Não basta chamar o helper como decoração, fabricar um handle de INSERT ou engolir falha. `before` é capturado sob lock antes da mudança; audit ausente/divergente causa rollback.

Este piloto mantém o destino atual **`audit_logs`**, com eventos completos e IDs conferidos; o contrato técnico congelará seus shapes antes de SQL. O singular `audit_log` pertence ao desenho futuro G4b e não será declarado implantado. Nenhuma cópia ou migração implícita de histórico. A variante transacional de `withAuditLog` ainda não existe: a atual dispara audit em background. As garantias existentes de formação, aprovação, revogação e versão devem ser preservadas nos adapters; reutilizar motores não dispensa essa revisão.

Draft, identidade do comando, recibo, readback e audit confirmam juntos. RequestId é vinculado a operador/tenant/operação e ao comando canônico: repetição idêntica retorna o resultado persistido, sem segunda criação/audit; mesmo ID com conteúdo diferente recusa. Replay e recuperação reautorizam; retirada de autoridade impede ambos. Revogar/versionar também têm seus próprios comandos idempotentes.

## Pacote único de aceite do piloto

1. **Entrada contextual:** atualizar os ramos autenticados dos endpoints existentes `assembly.calculateBatch` e `estimate.createFromCalculator`; UI abre pelo par confirmado, sem `project.list` global. Seleções vêm de uma fixture completa auditada e delimitada, sem abertura global do catálogo.
2. **Cálculo e draft:** fixture USD A custo/preço $40/$100 (60%); B $60/$90 (33⅓%); C $0,01/$0,01 (0%). O preparo e a proveniência da fixture são auditados e incluem contexto protegido de aprovação completo: cliente ativo, canal comercial, tenant settings/piso e geo snapshot coerente com a zona protegida (`geocodedAt`, `geocodeConfidence`, `geocodeSource`, `zoneTenantId`, captura do snapshot, risco/basis e piso). O estado IF-1 `formation_only` não é pronto para finanças; completar essa fixture delimitada não abre geocoding genérico. Calcular e persistir os três, comparando centavos, linhas, política e proveniência. Com contexto resolvido e piso aplicável comprovado, A deve aprovar e B/C devem recusar por `PROFIT_SHIELD_CHANNEL_FLOOR`, nunca contar `POLICY_CONTEXT_UNRESOLVED` como prova do piso. Draft abaixo do piso pode existir; o indicador global do motor não substitui a decisão protegida.
3. **Decisão e lifecycle:** A percorre revisão financeira e aprovação explícita conforme autoridade/política atuais. Revogar mantém história e bloqueia os usos que exigem aprovação vigente. Criar versão não herda decisão anterior; origem suplantada não conserva elegibilidade por cache. Adaptar os helpers atuais de aprovação/revogação/versão, mantendo fechados os caminhos legados.
4. **Entrega real:** JSON e PDF oficiais são gerados pelos renderers existentes a partir do snapshot aprovado, persistidos com integridade e efetivamente baixados; redownload reautoriza e verifica estado/hash. Bytes previamente entregues não podem ser recolhidos. Não substituir PDF por impressão do navegador; CSV permanece fora sem seu contrato de campos.
5. **Recuperação:** resposta perdida mantém o mesmo requestId/comando; replay nominal recupera o recibo/draft após nova autorização, inclusive após reload. Troca de sessão/par cancela resposta tardia e limpa cache. Armazenamento local é delimitado e não guarda bearer; timeout não gera UUID novo. Recuperação de senha/conta é fluxo Auth distinto e não recria grants, reativa perfil ou reenvia mutation automaticamente.

Conclusão exige TDD comportamental e provas físicas como o login efetivo: JWT inválido/outro operador/tenant, permissão insuficiente, fonte/preço divergente, tentativa raw/SET ROLE/GUC, concorrência/revogação, falha de audit com rollback, replay/conflict, resposta perdida/reload, A/B/C e entrega com recusa posterior. Evidência local e hospedada têm registros separados; nenhuma quantidade de testes substitui o aceite do artefato exato.

## Alternativas e consequências

| Alternativa | Motivo para não ser o padrão deste piloto |
| --- | --- |
| Calcular/verificar tudo no PostgreSQL pela Data API | Exige portar o motor TS ou novo runtime e provar paridade; não é apenas aceitar um resultado/hash enviado pelo caller. |
| Executor TS sem SQL + resultado autenticado por chave nova | Acrescenta chave/rotação, canonicalização, nonce/TTL e duas fases com revalidação; exige outro contrato F2/F5. Continua confiando no executor para o cálculo. |

A opção proposta reutiliza o motor e torna a transação única viável, ao custo de uma credencial SQL nominal, novo projeto operacional e confiança explícita no executor. A equipe deve comprovar isolamento de ambiente, TLS com hostname/chain verificados, pool/timeouts e capacidade para cálculo/PDF. Custo incremental não é presumido zero; não se contrata plano ou fornecedor adicional por este ADR.

## O que a equipe resolve e a decisão humana

**Resolvíveis tecnicamente antes do congelamento:** inventário de rotinas/tabelas/colunas e grants mínimos; associação do principal; comandos/recibos e sessão; locks/adapters transacionais e extensão real de auditoria; política de recuperação; limites Node/PDF/conexão e custo existente; testes, rollout fechado e procedimento auditado de retirada. Após ratificação, revisão dos grants concretos e provas locais são gates técnicos para a implantação, sem nova autorização a cada grant ou artefato que respeite este contrato. Bloqueio técnico é tratado pela equipe dentro do escopo; necessidade de ampliar autoridade exige nova decisão.

**Uma decisão humana necessária agora:** ratificar esta mudança nominal ADR-002/G4b — executor TS em projeto Vercel separado da mesma equipe, com principal e credencial SQL mínimos restritos a um operador/uma organização e às operações enumeradas, aceitando que seu comprometimento permite agir dentro desses grants — para **detalhamento, implementação testada e implantação controlada na homologação**, incluindo a criação desse projeto e principal, após revisão dos grants concretos e provas locais. Essa decisão cobre as etapas técnicas dentro do contrato, sem aprovações sucessivas de cada grant ou artefato. Não inclui contratar plano/fornecedor, ampliar autoridade ou liberar produção/campo; tais ampliações exigem decisão nova. Até a resposta humana, permanece **PROPOSED**.

## Referências inspecionadas

- [Dependências Calculator](../engineering/scope-to-field-coordination-2026-10-09.md#preparação-independente-do-calculator).
- [ADR-002](ADR-002-pilot-authenticated-database-boundary.md) e [G4b §§13–14](../security/g4b-catalog-ownership/2026-09-17-design.md#13-rls-e-ambiente).
- [SWR-1](../security/scope-workspace-read/contract-2026-10-09.md) e [auditoria atual](../../server/audit.ts).
