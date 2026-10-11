# Calculator — preparação da homologação T8, 10 de outubro de 2026

**Estado: candidato operacional local; ativação hospedada bloqueada.** Base: `9fb9f6564b44945aa894341b3dea73d929fd3d2b`, após integração da jornada no [PR #49](https://github.com/wcvmsilva/structr-ai/pull/49). A autorização desta rodada permite preparar e testar o pacote. A [ADR-003](../adr/ADR-003-pilot-financial-executor.md) exige confirmação específica antes de credenciais ou ampliação de acesso. Os itens abaixo ainda não constituem um pedido executável de ativação: as incompatibilidades encontradas precisam ser resolvidas primeiro.

Esta é a cópia sanitizada para o repositório público. Valores de destino entre `<...>` são redações, nunca configuração executável. A cópia local protegida em `tmp/calculator-homologation-private-2026-10-10/` está fora do Git, com diretório 0700 e arquivos 0600; contém os identificadores observados, sem credenciais.

## Resultado da inspeção real

O [inventário somente leitura](../security/financial-executor/homolog-readonly-observation-2026-10-10.json) reúne consultas de metadados Supabase e inspeção da conta Vercel autenticada, sem senhas, tokens ou UUIDs pessoais. Nenhuma alteração hospedada foi realizada.

| Item | Observado | Consequência |
| --- | --- | --- |
| Supabase | `structr-ai-homolog`, projeto `<supabase-project-ref>`, organização `<supabase-organization-id>`, us-east-1, Pro, PG17.11 | Destino existente confirmado. Nenhum novo projeto de banco é necessário por este desenho. |
| Executor no banco | Zero roles Calculator, schema financeiro ausente; migrations até 0019 | 0020/0021 continuam locais. A ausência é esperada e não comprova instalação. |
| Catálogo aplicativo | 1.011 objetos comuns idênticos ao manifesto; 36 funções pgcrypto presentes em public no laboratório estão em extensions na hospedagem | Reproduzir a disposição real antes de congelar novos hashes. Comparação usa `search_path=pg_catalog`, como a migration; não tratar diferença de representação como mudança real. |
| Privilégios geridos | PUBLIC TEMPORARY no banco, 96 funções com grants PUBLIC em schemas geridos, 240 entradas de defaultACL para terceiros | As verificações globais de ambas migrations recusam este ambiente. A contagem não significa que todas essas funções sejam alcançáveis ou inseguras. Não revogar permissões de Auth/Storage/Realtime indiscriminadamente. |
| Operador O | Perfil ativo, tenant GCHI ativo, `role=user`, role física correspondente ausente, nenhuma permissão | Não pode calcular/criar draft nesse contrato. Ser proprietário do projeto não substitui `estimate:create`. |
| Vercel | Equipe `<vercel-team-slug>` / `<vercel-team-id>`, plano **Pro Active**, confirmado novamente no painel autenticado em 2026-10-10 22:57 UTC; só projeto Structr `structr-ai` encontrado na inspeção anterior | Contratação do Pro resolvida. Destino separado do executor, rede, capacidade e eventual custo incremental continuam pendentes. |
| Rede/capacidade | DNS do endereço direto do banco resolveu apenas IPv6; máximo 60 conexões, 13 presentes em uma amostra | A amostra não reserva capacidade. TLS, conectividade a partir do runtime, session_user e limite agregado permanecem sem prova. |

Para a próxima análise de compatibilidade, também foi conservado fora do Git um inventário parcial somente leitura: 168 funções (assinaturas, owners, ACLs e hashes, sem corpos), 11 schemas, 34 roles, 28 memberships e 264 entradas de default ACL incluindo o próprio owner. Isso ainda não cobre relações/colunas/sequências nem prova caminhos transitivos; não é o manifesto de permissão aprovado.

A primeira consulta pelo e-mail de profiles não encontrou O; a conferência correta foi Auth e-mail → `profiles.external_open_id`. O artefato não divulga identificadores dessa associação.

## Item A — destino e configuração propostos

Projeto **proposto**, ainda não criado: `structr-financial-executor-homolog`, na equipe Vercel acima. Root directory `services/financial-executor`, Node22, build isolado, publicação manual do artefato revisado, integração Git desabilitada. Usar target **Preview** e `FINANCIAL_EXECUTOR_ENVIRONMENT=homologation`; o loader atual recusa essa combinação com target Production.

O ID e o hostname definitivo não podem ser apresentados como existentes antes da criação. Após autorização de criação fechada, registrar ID/URL e verificar destino antes de inserir qualquer segredo; a alteração posterior de origem exige novo readback. Não adivinhar alias disponível nem promover preview para produção. O projeto web existente é `<vercel-web-project-id>`.

| Configuração | Valor/destino delimitado |
| --- | --- |
| `FINANCIAL_EXECUTOR_DATABASE_URL` | Única credencial SQL de runtime, secreta, exclusiva do executor e do Preview aprovado. Sem Development, Production, compartilhamento de equipe ou projeto web. Ainda não criada. |
| `FINANCIAL_EXECUTOR_EXPECTED_DB_PRINCIPAL` | `structr_calculator_login_v1`, NOBYPASSRLS e sem memberships privilegiados. |
| `FINANCIAL_EXECUTOR_EXPECTED_DB_NAME` | `postgres`. |
| `FINANCIAL_EXECUTOR_EXPECTED_DB_HOST` | Endereço observado direto `db.<supabase-project-ref>.supabase.co` é candidato; rota precisa de prova. Nenhum pooler escolhido por suposição. |
| `FINANCIAL_EXECUTOR_SUPABASE_URL` | `https://<supabase-project-ref>.supabase.co`, issuer/JWKS fixos. |
| `FINANCIAL_EXECUTOR_OPERATOR_SUB`, `...ACTOR_ID`, `...TENANT_ID` | Associação protegida de O/GCHI reconciliada, sem copiar valores para GitHub ou chat. |
| Web, somente após fechamento dos gates | Modo `authenticated-data-api`; origem HTTPS exata do executor e gate Calculator em Preview específico. Nunca copiar SQL/service role para web. |

O loader atual aceita somente o username SQL exato; o sufixo de roteamento usado por poolers Supabase não passa. Se o pooler for a solução escolhida, adaptar e testar o transporte com ref/host fixos mantendo o `session_user` nominal obrigatório; não aceitar `postgres` como substituto. Desabilitar validação TLS não é alternativa.

A documentação oficial do [Supabase sobre compatibilidade IPv4/IPv6](https://supabase.com/docs/guides/troubleshooting/supabase--your-network-ipv4-and-ipv6-compatibility-cHe3BP) lista Vercel entre os hosts IPv4. A rota direta observada não deve ser tratada como utilizável sem mudança de rede. Alternativa que preserva o username atual: add-on IPv4 do Supabase a [US$0,0055/hora, cerca de US$4/mês](https://supabase.com/docs/guides/platform/manage-your-usage/ipv4), não incluído no Spend Cap. Isso exige confirmação própria e avaliação da troca DNS; nada foi contratado. A [documentação de conexão](https://supabase.com/docs/guides/database/connecting-to-postgres) explica que o endpoint passa de AAAA para A. Pooler continua sendo alternativa sujeita à mudança/teste de transporte acima, sem inferir seu host.

A proteção de deployment também precisa de decisão explícita: o transporte atual envia bearer de aplicação, sem cookie SSO Vercel ou segredo de bypass. Não contar uma página SSO/HTTP302 como prova da autorização do executor; não desligar proteção de toda a equipe. Qualquer exceção futura deverá nomear apenas o destino necessário e preservar a verificação JWT da aplicação.

**Plano comercial confirmado:** o responsável informou que o Pro já estava ativo, e a leitura do painel autenticado da mesma equipe confirmou **Pro Plan — Active** em 2026-10-10 22:57 UTC. A contratação/adequação do plano Pro sai das pendências; a observação inicial de Hobby fica preservada no histórico do registro. Nenhum upgrade ou ajuste de cobrança foi realizado pelo agente. Isso não confirma custo incremental zero, capacidade reservada nem autorização para adicionais: o orçamento operacional e o mecanismo de suspensão da janela ainda precisam ser definidos. O eventual add-on IPv4 do Supabase permanece uma decisão separada.

Limites existentes: duas conexões por instância, operação 30s, função 35s, connect 5s, lock 3s, statement 10s, idle 10s e lifetime 300s. Preparar limite agregado verificável — o plano não promete que dois pools locais limitam a escalabilidade Vercel. A proposta a testar é `CONNECTION LIMIT 2` no login nominal, além dos dois slots locais, com recusa da terceira sessão e reconexão conferidas. O [PostgreSQL 17](https://www.postgresql.org/docs/17/sql-createrole.html) documenta esse limite como aproximado, não aplicável a superusers e restrito a conexões normais; não chamar isso de reserva garantida de capacidade. O candidato administrativo atual ainda não define esse limite. Incremento de plano/rede exige custo exato antes de contratação.

## Item B — SQL, autorização, fixture e retirada propostos

Hashes dos candidatos locais preservados nesta rodada, **não aprovados para aplicação no estado hospedado observado**:

| Artefato | SHA-256 |
| --- | --- |
| `drizzle/0020_closed_financial_calculator_boundary.sql` | `e4023b3ca7ceace78acd1b367f3d14d68fb94d6270fffced51e7f8931b44eba0` |
| `drizzle/0021_financial_calculator_lifecycle.sql` | `6c947ba1f081f692f211e76dd15ee11bceb169f1dc371adaf59cf6024dab552a` |
| `docs/security/financial-executor/permission-manifest.json` | `6f7411cf091e254711e80862b442ae8c80b51647da9b76df91bfde9dd501b677` |

**Compatibilidade do administrador também pendente:** `postgres` hospedado é CREATEROLE/BYPASSRLS, mas não superuser; o laboratório inicializa `app_principal_runner` como superuser. 0020:290 e 0021:8/136 recusam qualquer membership envolvendo roles financeiras. O [PostgreSQL 17 exige ADMIN OPTION](https://www.postgresql.org/docs/17/sql-alterrole.html) para um não-superuser alterar atributos de outra role. É necessário reconciliar o contrato de manutenção e provar instalação, abertura, rotação e retirada com o administrador real equivalente; não presumir acesso a `supabase_admin` nem ampliar o login de runtime. A eventual edge administrativa nominal deve ser proposta e revisada explicitamente, sem relaxar memberships de runtime por conveniência.

O manifesto contém as colunas, roles, policies, rotinas e definições exatas. Seu hash detecta alteração; não constitui assinatura digital nem autorização de implantação. O [plano de compatibilidade](../security/financial-executor/homolog-compatibility-plan-2026-10-10.md) delimita o candidato que deverá substituí-los somente depois de novas contraprovas e revisão. Não alterar hash esperado para aceitar indiscriminadamente o estado observado. A revisão também identificou o prefixo SQL legado `NOT LIKE 'pg_%'`, que exclui indevidamente schemas como `pgoutside`; o checker administrativo desta rodada já usa prefixo literal com regressão, mas ambas as migrations ainda precisam da correção e de novas provas antes de aplicação.

Escopo funcional continua nas quatro operações `calculator.context`, `calculator.calculate`, `calculator.create`, `calculator.recover`. Sem aprovação, exportação ou acesso bruto às tabelas pelo login.

**Proposta RBAC para decisão específica futura:** uma role de negócio exclusiva `calculator_pilot_operator_v1`, com apenas `estimate:create`, atribuída somente a O durante a janela; projeto sintético pertencente a O. Isso altera deliberadamente `profiles.role` mediante confirmação, com before/after e retirada para o valor anterior. Não concede admin, `project:write` global, aprovação, exportação ou permissões à role compartilhada `user`. A leitura dos consumidores confirma role textual/string e tratamento especial somente de admin; a prova comportamental da troca e preservação do login ainda é necessária. Ownership já pode conferir autoridade de revisão/approve em helpers genéricos: ausência de grants RBAC approve/export não significa ausência dessa autoridade. A segurança deste recorte depende também da allowlist Data API e das quatro rotinas, mantendo os writers de aprovação/exportação fechados. O candidato separado `scripts/financial-executor-homologation-rbac.ts` prepara essa mudança e a restauração em transações auditadas; nenhuma foi aplicada na hospedagem. Usa um operationId exclusivo, distinto do manifesto de fixture. O preflight de `admin.ts` exige `estimate:create`, mas não atesta sozinho a exclusividade da role: conferir também o readback RBAC nominal.

**Fixture:** cliente/projeto/intake sintéticos e catálogo A/B/C restritos à mesma organização, com origem/hashes e auditoria de cada formação administrativa. Valores unitários USD: A 40/100, B 60/90, C 0,01/0,01. O candidato atual exige exatamente uma linha de settings, overrides Profit Shield/geo iguais a `{}`, USD e timezone `America/New_York`; confere e preserva a linha inteira, sem sobrescrevê-la. A leitura hospedada confirmou esses quatro requisitos nesta rodada; isso não dispensa o readback transacional no momento da preparação. Ausência ou divergência causa recusa. Não usar seed genérico, não fabricar dados de cliente real. A1/A2/B1 e tenants sintéticos seguem inativos até pacote nominal próprio; negativa de identidade inativa não substitui negativa de outro operador ativo.

**Janela proposta:** 30 minutos iniciados somente após preflight e readback positivos e confirmação dos responsáveis/horários UTC exatos. A duração no manifesto e VALID UNTIL não encerram sessões já abertas automaticamente. O fechamento operacional, seu responsável e prova de execução são gates; nenhum watchdog hospedado foi implantado nesta rodada.

**Retirada:** fechar novas solicitações, desativar o binding de forma terminal, pôr login em NOLOGIN, confirmar transação/auditoria, encerrar somente sessões desse principal e comprovar nova recusa com bearer ainda válido. Revogar a credencial no destino protegido e remover sua configuração de runtime conforme pacote final. Não apagar drafts, recibos, fixtures ou auditorias para limpar evidência. Repetir o fechamento quando houver falha no encerramento de sessões; não anunciar sucesso completo enquanto restarem sessões. Restaurar a role de negócio de O usa o candidato RBAC separado, com conferência de identidade/role atual, auditoria e retirada da edge; role/permission definitions permanecem sem grant para preservar evidência. A orquestração hospedada ainda precisa vincular os dois manifestos e conferir ambos os resultados.

**Lacuna específica W2:** o helper atual reúne binding inativo e NOLOGIN no mesmo COMMIT e logo encerra as sessões. Isso prova contenção, mas não garante uma fase observável em que o mesmo bearer válido receba recusa por autorização antes do fechamento do transporte. Preparar uma fase terminal auditada de desativação e sua prova antes de tratar W2 como executável; esta rodada não afirma W2 hospedado aprovado.

A retirada do binding **não é pausa reversível**: schema atual não permite reativação, remoção ou novo vínculo da mesma session_role. Se uma janela for encerrada, próxima ativação exigirá artefato explicitamente desenhado/revisado. Não prometer reabertura por troca de senha ou flag.

## Provas, revisão e próxima execução

Os helpers administrativos em `scripts/financial-executor-homologation/` constituem candidato local testável, sem factory de conexão hospedada. O planner não atesta commit nem prontidão cloud. A conexão administrativa Drizzle hospedada também não foi preparada: antes da execução é necessário nomear seu operador, principal, destino protegido e ciclo de vida, reutilizando acesso administrativo existente somente se aprovado e verificável. O conector SQL de leitura não substitui a transação TypeScript desses helpers; não introduzir credencial administrativa no web ou no executor de runtime. O [protocolo de aceitação](calculator-homologation-acceptance-2026-10-10.md) distingue UI, HTTP direto e evidência física e conserva os gates posteriores de campo.

A sequência autorizada continua: resolver compatibilidade local → fechar proposta nominal RBAC/rede/custo/retirada → revisar o artefato exato → apresentar as duas confirmações completas → preparar destino fechado → instalar/conferir → executar janela → retirar/conferir independentemente. Nenhuma confirmação genérica substitui essas condições.

A [evidência local por hash](../security/financial-executor/homologation-local-evidence-2026-10-10.json) identifica os scripts/testes efetivamente revisados. São **118 casos novos distintos**: contrato 13, runner 16, administração física 36, RBAC unitário 16 e RBAC físico 37. As duas suítes físicas usam PostgreSQL 17.11 descartável, com encerramento/limpeza ao final. Reexecuções independentes não aumentam essa contagem. As 8.309 aprovações da base e as provas do PR49 pertencem à base, não ao pacote novo.

Revisão independente concluída em 2026-10-10 22:26:19 UTC, sem P1/P2 remanescente no candidato novo; correções incluíram integridade de receipts, isolamento de search_path, concorrência entre duas sessões reais, cleanup idempotente e expiração durante espera. Isso não aprova as migrations antigas para hosted nem encerra os bloqueios desta página. Uma falha de preflight protege o ambiente, mas não é sucesso da jornada.

Verificações já concluídas: `pnpm check`, `pnpm check:calculator-homologation`, `pnpm check:financial-executor`, `pnpm build:financial-executor` e `pnpm build:vercel`, todas exit 0. A primeira execução geral registrou timeout de 5s em um teste antigo de import do geo router durante concorrência com builds/provas; sua suíte isolada passou 93/93 sem alteração de código. **A regressão geral final terminou com 8.354 aprovados, 1.707 ignorados e zero falhas (238 arquivos aprovados, 55 ignorados; 281,24s).** Os 73 testes físicos novos foram executados separadamente e passaram; seus skips na suíte padrão não são contados como prova física. O hook obrigatório e o CI deverão validar a fonte publicada antes da integração.

Nenhuma tabela, função financeira de domínio ou endpoint de negócio novo. Helpers administrativos principais: preflight/prepare/open/withdraw Calculator e apply/withdraw RBAC; mudanças persistentes auditadas em transações Drizzle reais. Encerramento de sessões tem intenção auditada durável, readback e estado `cleanup_pending` quando incompleto; não promete rollback de pg_terminate_backend. F1 permanece na fronteira de negócio existente, sem nova rota pública; F2/F5 são exercitados pelas provas físicas. O runner é somente `--plan`, sem factory cloud.

Arquivos novos: oito fontes/configs administrativos, cinco suítes comportamentais, pacote/protocolo, plano de compatibilidade e dois registros sanitizados de observação/evidência. Modificados: README, estado atual, todo, plano T8, package.json e CI (checagem de tipos dos novos scripts administrativos). SQL 0020/0021, manifesto de permissões e runtime permanecem iguais à base. Esta é a entrega local de preparação, não a conclusão T8 ou liberação do sprint de campo.

**Liberação de campo: não.** Aprovação, versionamento, exportação oficial e recuperação operacional ainda dependem de implementação/provas/aceite completos, além desta homologação Calculator.
