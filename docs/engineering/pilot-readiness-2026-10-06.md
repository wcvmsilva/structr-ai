# Structr — homologação do primeiro piloto

Data: 6 de outubro de 2026. Código de referência: `12f443f9472b195d4528989a3e6e362e67ce89cd`.

**Banco de homologação provisionado e fechado para uso da aplicação. O piloto ainda não está liberado.** O usuário escolheu “wcvmsilva's Org” e autorizou expressamente o custo apresentado de **USD 10/mês**. Esta etapa cria infraestrutura isolada e registra evidências; não conclui o isolamento por organização nem autoriza execução de obra.

## Destino e resultado observado

- Projeto: [structr-ai-homolog](https://supabase.com/dashboard/project/wmspwegbqtzamkhxhusg), referência `wmspwegbqtzamkhxhusg`.
- Organização: `cgohzkcndjjwcnfbtelx`; região `us-east-1`; criado às 19:30:14 UTC; estado observado `ACTIVE_HEALTHY`; PostgreSQL 17.11.
- Projeto Supabase de produção preservado; nenhum dado de produção foi copiado. Nenhum deploy ou alteração de variáveis Vercel foi realizado nesta etapa.
- As 15 migrações originais `0000`–`0014` foram aplicadas sem alteração, após conferência dos hashes usados no ensaio local. O ledger Supabase registra cada aplicação e duas operações adicionais de contenção exclusivas deste ambiente.
- O [manifesto de provisionamento](pilot-homolog-provisioning-2026-10-06.json) contém identidades, hashes, versões reais do ledger, verificações e limites.

| Verificação | Resultado | Limite da evidência |
| --- | --- | --- |
| Replay local anterior | 15/15 migrações; PostgreSQL 17.11 descartável; limpeza confirmada | Não equivale a aplicação hospedada |
| Catálogo no Supabase novo | 90 tabelas, 47 funções, 55 triggers de usuário, 0 constraints não validadas | Não é comparação completa com o ORM |
| RLS no Supabase novo | 7 tabelas habilitadas, 0 policies | 83 tabelas sem RLS; não há autorização positiva pronta para runtime restrito |
| Clientes, projetos e estimate drafts | 0 em cada tabela | Existem metadados iniciais de tenant/settings das migrações; não se trata de banco totalmente sem dados |
| Privilégios da API | Acesso ao schema, tabelas/colunas e funções negado; verificação inclui privilégios herdados e papéis assumíveis | Contenção de API, não prova de isolamento positivo entre tenants |
| Leitura física sob quatro papéis da API | 20/20 tentativas negadas em cinco tabelas representativas | Papel alterado somente para provas negativas; não é o principal de uma aplicação implantada |
| HTTP da Data API como anon | 3/3 leituras negadas, HTTP 401, código PostgreSQL `42501`, “permission denied for schema public” | Chave publicável válida; não foram criadas sessões autenticadas |
| Referência financeira sintética | 32 comparações com o motor puro passaram para duas quantidades | Catálogo não provisionado; não prova login, banco, geocode, navegador ou downloads |

Antes das migrações, foi removido o acesso ao schema `public` pelos papéis da API. Depois, foram revogados os privilégios nos objetos criados, preservando owners e triggers exigidos pelas migrações. Os defaults de tabelas, sequências e funções no schema para o criador `postgres` foram restringidos. O default global implícito de EXECUTE de funções para PUBLIC continua existindo: novas funções exigem nova conferência/revogação antes de qualquer abertura. Os schemas gerenciados `auth` e `storage` não foram alterados por estas operações.

O `service_role` conserva o BYPASSRLS gerenciado pelo provedor, mas não possui acesso ao schema público nem aos objetos verificados. Ele não foi configurado como principal da aplicação. Nenhum usuário Auth, principal runtime ou catálogo de negócio foi provisionado.

## Bloqueio técnico atual e próximo trabalho

A próxima entrega é **implementar e validar o vínculo autenticado entre identidade, transação e tenant**. Não basta ligar a API ou acrescentar grants. O contexto atual guarda perfil/tenant, o bootstrap de identidade consulta o pool global e o helper A1 abre uma transação SERIALIZABLE sem estabelecer o binding protegido descrito no contrato de isolamento.

Referências do código-base: [contexto](../../server/_core/context.ts#L13), [bootstrap de identidade](../../server/identity-db.ts#L103), [tipo transacional](../../server/auth-transaction.ts#L13) e [transação A1](../../server/internal-estimate-approval-db.ts#L202). O [design G4b](../security/g4b-catalog-ownership/2026-09-17-design.md#L847) exige bearer validado, mapeamento protegido, envelope assinado por transação e provas contra adulteração/replay. Sua restrição de writers por rotinas nomeadas pertence ao escopo G4b e precisa ser conciliada explicitamente com A1/H1. Isso não autoriza copiar suas policies sem revisar os contratos atuais.

**Atualização às 20:41 UTC:** o JWKS público anuncia ES256/P-256; não foi emitido token de sessão real. A inspeção não encontrou verificador JWS ES256 suportado no PostgreSQL disponível. A [ADR-002](../adr/ADR-002-pilot-authenticated-database-boundary.md) apresenta alternativas e recomenda Data API autenticada com operações transacionais nomeadas, preservando os controles A1/H1. A proposta está pendente de decisão humana porque altera a fronteira do contrato G4b. Nenhuma mudança de privilégio ou abertura da API foi feita.

O [reparo independente de expiração](auth-token-expiry-2026-10-06.md) tem 33 novos testes criptográficos e 94 passes focais; não resolve o binding. O próximo passo dependente é decidir a fronteira e detalhar sua prova física antes da implementação.

O recorte abaixo preserva o plano anterior como histórico: ainda não foi implementado e depende da decisão da ADR; seus mecanismos JWK/HMAC não constituem aprovação da alternativa nova:

1. Documentar a integração A1/H1 com bootstrap protegido, validação/rotação de JWK e HMAC, vínculo transacional e retries, preservando os contratos existentes.
2. Escrever primeiro provas físicas negativas: bearer/contexto ausente ou inválido, tenant adulterado, segundo bind, replay, commit/rollback, reutilização de conexão e tentativa de assumir privilégio elevado.
3. Implementar migração aditiva e contexto/helper transacional; cada retry estabelece novo binding da mesma identidade autenticada, em nova transação.
4. Integrar inicialmente a consulta existente de revisão A1 e provar acesso autorizado, recusa de A2 sem direitos de acesso e recusa de outra organização, usando principal não proprietário, sem BYPASSRLS nem membership administrativo.
5. Integrar os demais consumidores e writers somente com provas específicas de autorização, atomicidade e auditoria; concluir também a revisão de troca de identidade/cache no navegador.

Esse primeiro recorte valida a fundação; sozinho não libera aprovação/export nem conclui a jornada.

O advisor Supabase registrou sete avisos informativos de RLS sem policy e oito avisos de funções sem `search_path` fixo. As funções estão identificadas no manifesto e permanecem pendentes de revisão antes da abertura. Referências de remediação: [RLS sem policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) e [search_path mutável](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable). Não aplicar correção genérica ou habilitar RLS indiscriminadamente.

## Sequência até o Manus

| Etapa | Estado / critério de saída |
| --- | --- |
| Organização, custo e banco isolado | Concluída, com autorização e evidência do destino |
| Fundação de identidade e autorização no banco | ADR-002 proposta; decisão, implementação e provas com principal restrito pendentes |
| Host exclusivo e configuração | Pendente; API permanece fechada até cumprir os gates de ambiente e principal |
| Contas A1/A2/B1 e catálogo sintético | Pendentes; bootstrap auditado, transacional, idempotente e com readback |
| Geocode e recuperação | Pendentes; provedor real, endereço público de teste revisado, contexto geográfico coerente e recuperação ensaiada |
| Aceitação operacional pelo Manus | Pendente; executar S1–S3, controles negativos, sessão/rede e aparelho real, preservando arquivos baixados |

O roteiro de aceitação foi corrigido: referência monetária independente antes do teste; cliente/projeto/Intake/orçamento criados pela interface; A2 sem ownership/membership nem direitos globais; B1 em outra organização; motivo de pelo menos dez caracteres também na nova versão. PDF/JSON/printable constituem o caso positivo e CSV deve recusar taxabilidade desconhecida, sem preencher dados para forçar aprovação. Após provisionar uma zona revisada, repetir o geocode real para obter evidência coerente. O pacote sintético e os registros locais completos permanecem privados e não provisionados.

A configuração planejada usa Supabase Auth sem fallback legado, tenant estrito e credenciais exclusivas. O adaptador geográfico atual depende do proxy Manus Maps; sua credencial de homologação ainda não foi verificada. Variáveis Vercel existentes com escopo conjunto production/preview não constituem um ambiente isolado.

## Limites e continuidade

O ledger operacional é o do Supabase. Não foi fabricado nem preenchido o ledger Drizzle: qualquer futura ferramenta de migração deve primeiro reconciliar esse histórico para evitar reaplicar a base. Recuperação, paridade completa ORM/SQL, principal runtime, isolamento positivo e jornada hospedada continuam sem comprovação. O contrato [H1](../architecture/historical-capture-h1.md#L47) exige API de negócio fechada até a prova do ambiente e do papel efetivo, inclusive para o piloto sintético.

O registro original de provisionamento não alterou código ou migrações versionadas. O seguimento aqui vinculado corrige somente a expiração no verificador Node; a ADR permanece proposta. Nenhuma classificação do registro canônico foi alterada. As provas desta etapa não substituem o [fechamento A1](a1-delivery-closeout-2026-10-06.md) nem convertem seus testes ignorados em aprovações. Publicação, revisão do novo commit e integração são observações separadas.
