# ADR-002 — fronteira autenticada para o primeiro piloto

**Status:** Proposed — decisão humana pendente; API permanece fechada.
**Data:** 6 de outubro de 2026.
**Decisor:** responsável pelo projeto, com revisão técnica independente.
**Base:** `264443a65b3d4efaae3364c7f363ff3d1195895e`.

## Contexto

O usuário autorizou continuar a fundação login → transação → organização. A regra do [AGENTS.md](../../AGENTS.md) é “Do not improvise architecture”. O [contrato G4b](../security/g4b-catalog-ownership/2026-09-17-design.md#L847) exige que o PostgreSQL direto valide o bearer contra JWK aprovado e estabeleça um envelope autenticado por transação. Esse mecanismo não está implementado.

A inspeção somente leitura de `wmspwegbqtzamkhxhusg` encontrou PostgreSQL 17.11, `pgcrypto 1.3` instalado e linguagens SQL/PLpgSQL/internal/C. A extensão não expõe verificador JWS ES256. `pgjwt 0.2.0`, `pgsodium 3.1.8`, `http 1.6` e `pg_tle 1.4.0` estão disponíveis no catálogo, não instalados; PLV8/PLPython/PLRust não foram listados.

Às 20:35:58 UTC, o [JWKS público](https://wmspwegbqtzamkhxhusg.supabase.co/auth/v1/.well-known/jwks.json) publicou chave ES256/P-256, identificador `4fdb5ed2-865e-49bb-8b9a-b0c8baca1576`. Isso não prova qual chave assina novas sessões; não foi criada conta nem obtido JWT real.

O [pgcrypto](https://www.postgresql.org/docs/17/pgcrypto.html) fornece HMAC/hash, não esse verificador JWS. O [pgjwt](https://supabase.com/docs/guides/database/extensions/pgjwt) está depreciado no PG17; ser listado no catálogo não demonstra adequação ao ES256. O Supabase recomenda [chaves assimétricas](https://supabase.com/docs/guides/auth/signing-keys). Não se propõe mudar para HS256 ou implementar ECDSA manualmente.

## Decisão proposta

**Recomendação: delimitar o caminho do piloto pela Data API autenticada do Supabase/PostgREST, com funções de banco nomeadas e autorização dentro da mesma transação.** A assinatura passa a ser verificada pelo serviço de entrada confiável; o banco resolve perfil/tenant protegidos e autoriza cada operação.

Fluxo proposto: usuário com bearer → endpoint existente Structr → Data API verifica assinatura → transação autenticada → mapeamento protegido e autorização da operação.

A função também é uma entrada diretamente acessível a quem possui bearer. Validação de argumentos e claims, autorização e limitação do snapshot precisam resistir a chamadas diretas à Data API, sem depender do Zod ou middleware Node do Structr.

O [PostgREST documenta verificação JWT simétrica e assimétrica](https://docs.postgrest.org/en/stable/references/auth.html). Cada chamada ocorre em uma [transação](https://docs.postgrest.org/en/stable/references/transactions.html); isolamento e privilégios precisam ser configurados e comprovados na versão efetivamente hospedada. Documentação não substitui essa prova.

O processo web habilitado não terá credencial SQL, service role, segredo de assinatura nem acesso a tabelas brutas. Encaminhará bearer e comandos estritos a funções específicas. Não haverá login SQL da aplicação capaz de chamar as mesmas rotinas com claims forjadas. Identidade não virá de actor/tenant enviados como argumentos.

Esta é uma mudança explícita da fronteira do contrato. Aceitar a direção autoriza seu detalhamento e implementação testada; não aprova grants ainda não escritos nem libera o piloto.

## Alternativas consideradas

| Opção | Vantagem | Consequência | Parecer |
| --- | --- | --- | --- |
| Data API autenticada e funções nomeadas | Usa verificador mantido pelo provedor; evita novo protocolo próprio de atestação | Adapta contexto, locks e operações A1; exige retirar credenciais SQL do processo habilitado | Recomendada |
| Verificador independente e atestação autenticada por transação | Pode preservar mais consultas Drizzle | Novo serviço, segredo separado, protocolo contra replay/rebind, expiração, rotação e disponibilidade; chave no processo web é vetada | Alternativa, se escolhida |
| ES256 no banco conforme contrato atual | Mantém a fronteira literal | Nenhuma implementação madura e suportada identificada no ambiente; exige prova do provedor ou mudança de infraestrutura | Bloqueada pela capacidade observada |
| Auth remoto via HTTP no definer | Delega validação ao provedor | Também muda o contrato; exige destino/TLS/configuração HTTP controlados, timeout e manejo seguro do bearer | Não recomendada como atalho |

Não há estimativa validada de prazo/custo adicional. Nenhum recurso novo ou alteração cloud é autorizado por esta proposta isoladamente. A autorização anterior de USD 10/mês cobre o projeto já criado.

## Contrato mínimo do recorte recomendado

1. Modificar o endpoint existente `estimate.getInternalApprovalReview`, sem endpoint paralelo ou fallback administrativo.
2. Resolver subject externo → perfil interno → tenant ativo no canal protegido. Não auto-provisionar perfil, escolher tenant padrão ou aceitar autoridade de metadados editáveis pelo usuário.
3. Exigir assinatura, issuer, audience, expiração e papel previstos. Conferir a configuração real do provedor e validar claims adicionais na rotina; os defaults de PostgREST não bastam para presumir todos esses requisitos.
4. Preservar a ordem project → draft e locks de identidade/RBAC/contexto. A [revisão A1](../../server/internal-estimate-approval-db.ts#L249) usa FOR UPDATE/FOR SHARE; não remover locks nem conceder UPDATE amplo como atalho. Usar RPC via POST, função VOLATILE e transação SERIALIZABLE efetivamente comprovada no serviço hospedado; repetir a operação inteira em serialization failure/deadlock, preservando o limite atual.
5. Adquirir um snapshot autorizado coerente dentro de uma operação transacional nomeada e passá-lo ao motor puro existente. Múltiplas chamadas HTTP não compartilham uma transação; snapshot fornecido pelo cliente não serve como autoridade para futura aprovação.
6. Manter a detecção de linhagem H1 e vínculos contraditórios. RLS não pode ocultar evidência que deveria causar recusa. Preservar o `row_security=off` fail-closed da migração 0010.
7. Funções privilegiadas terão owner dedicado NOLOGIN/NOBYPASSRLS, não proprietário das tabelas, privilégios mínimos, objetos qualificados, search_path fixo e EXECUTE público revogado. Provar a visibilidade necessária sem grants amplos.
8. Testar isolamento por requisição/transação, contexto limpo no pool e retries. Não expor SQL arbitrário, setter de claims ou seleção de tabela/tenant.
9. Aprovar, revogar, versionar e exportar permanecem fechados no caminho novo até integração própria. O wrapper atual é compartilhado com esses consumidores; não substituí-lo globalmente neste recorte.
10. Mutations futuras manterão mudança, readback e audit durável na mesma transação. Não alterar autoridade comercial ou de execução de obra.

## Provas antes da abertura

- Assinaturas reais e inválidas; issuer/audience ausentes/incorretos; token expirado/sem expiração; papel de serviço não aceito como sessão comum.
- Acesso SQL direto, tabelas brutas, RPC indevido, setter de claims e escalada de papel recusados.
- A1 autorizado, A2 sem direitos e B1 de outro tenant; perfil/tenant inativos; mudança concorrente de membership; isolamento entre chamadas e conexões reutilizadas.
- Locks e retry serializável completo; recusa após revogação de membership/permissão; nenhuma tentativa com papel privilegiado. Logout/revogação de sessão Auth é uma garantia diferente: assinatura válida não implica sessão ainda ativa. O detalhamento deve definir e provar essa política; invalidação imediata exige verificação adicional do estado protegido de sessão, não apenas do JWT ([Supabase Sessions](https://supabase.com/docs/guides/auth/sessions)).
- Linhagem H1 e evidência contraditória preservadas com RLS real.
- Snapshot compatível com o motor atual, sem escrita de negócio pela revisão.
- Configuração/versão/roles do próprio ambiente verificadas, com recuperação antes de writes reais.

Contexto colocado manualmente em GUC e verificador simulado não comprovam JWT → banco. Falha ou prova inconclusiva mantém o caminho fechado.

## Trabalho independente

Exigir `exp` no verificador Supabase Node corrige uma ausência de validação sem mudar a fronteira de confiança. O reparo tem testes criptográficos reais e verificação separada; não implementa nem comprova esta proposta.

## Ações

- [ ] Responsável aprova a direção recomendada ou escolhe alternativa.
- [ ] Revisar detalhamento de bootstrap, snapshot/locks, claims, transporte e privilégios.
- [ ] Executar RED físico e de integração antes de migrations/helpers/endpoint.
- [ ] Implementar e provar o recorte escolhido.
- [ ] Reconciliar explicitamente a seção 13 G4b no escopo aprovado, preservando o histórico.
- [ ] Somente após os critérios acima avaliar abertura na homologação.

