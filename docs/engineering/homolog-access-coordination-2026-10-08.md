# Homologação: acesso e jornada do primeiro operador

> **Complemento de Settings — 8 de outubro:** Codex implementou a troca por senha atual/nova/confirmação e ativou a exigência nativa na homologação; 80 novos testes e 238 focais aprovados. [Evidências e aceite pessoal pendente](auth-recovery-2026-10-08.md#troca-de-senha-em-settings--complemento-de-8-de-outubro). Munder e Manus mantêm as frentes já atribuídas; não duplicar esta implementação.

**Atualização de acesso — 8 de outubro:** o novo relato de conta indisponível levou aos reparos de renovação e revalidação do perfil e à implementação de recuperação/troca de senha. [Evidências, configuração e próxima prova pessoal](auth-recovery-2026-10-08.md). Não se atribui o relato hospedado a uma causa não comprovada. O recorte de leituras do Munder permanece posterior a este reparo; aprovação, versões, exportação e uso real ainda não estão liberados.

**Estado vigente — 8 de outubro de 2026, 18:20 UTC:** login real e perfil `user` comprovados na homologação após a correção de permissão do schema. Isolamento entre organizações e jornada completa continuam pendentes; writers de negócio e uso com projetos reais permanecem fechados. O [checkpoint de sessão](#checkpoint-sessão-real-resolvida--8-de-outubro-1820-utc) separa esse resultado das provas que faltam.

Estado inicial preservado em 8 de outubro de 2026. Base: `f08a7f0f028d11fe4433beb4340ba57e851a6a7d` (PR #29 integrada). Os checkpoints anteriores abaixo registram os estados observados naquele momento; suas pendências de provisionamento, Vercel e primeiro login são superadas pelos checkpoints posteriores de execução e sessão.

O responsável autorizou configurar contas de teste, comprovar acessos na homologação e integrar aprovação, versionamento e exportação à jornada completa. A autorização anterior cobre correções, testes, publicação e integração validada à main. Há somente um operador humano inicial; identidades sintéticas separadas exercitam recusas de autorização. Identificadores de login, senhas, tokens e recibos com dados pessoais ficam fora deste registro público.

## Coordenação e responsabilidade exclusiva

| Frente | Responsável | Entrega e limite | Estado |
| --- | --- | --- | --- |
| Contas, configuração Auth, bootstrap protegido e provas hospedadas | Codex integrador | Conta do operador vinculada ao tenant existente; identidades negativas sintéticas e provas de sessão/organização separadas; nenhuma credencial administrativa no processo web | Perfil/issuer e quatro audits preservados; correção 0016 aplicada, nove RPCs de sessão com HTTP 200 e Dashboard com role `user`. Cinco negativos repetidos após DDL e recusados; isolamento multiorganização, revisão com dados e jornada ainda pendentes. |
| Sessão e interface | Agente Codex de interface, integrado por root | Espera pelo perfil, conta indisponível, isolamento de cache e respostas atrasadas na troca de identidade; TDD focal | Commits `5e0953b8` e `3d184265`; 40 testes focais verdes; revisão independente sem bloqueadores restantes |
| Bootstrap administrativo | Agente Codex de banco, integrado por root | Helper/CLI sintéticos da PR #30 e dois artefatos mínimos separados para o operador/issuer; cada executor conserva seu contrato de transação e auditoria | PR #30: 100 casos distintos, sem aplicação do bootstrap sintético; artefatos mínimos separados: 64 casos privados e aplicação hospedada conferida no checkpoint abaixo |
| Contrato de aprovação, versão e exportação autenticadas | Michael/Munder: Jim autor, Gemini revisor | Matriz de comandos/RPCs, autoridade, transações, locks, auditoria, concorrência e fatias; primeiro proposta ratificável | Leitura mínima V3.1 ratificada com nota F2 do evento `estimate_viewed` na query e pareceres sobre os mesmos hashes: contrato `239bf7987ab2fc4f5262975ef3d4d1a028bdecc6485ab6289a64c7536bce928c`; nota `6e346d87a3baa7b55584dd26c5afb932b16bfc7365b3e4db53fe55b204803bdd`. Cópias privadas em `tmp/adr002-minimum-read-v31/`. Fatia por URL conhecida: portar `estimate.getById` e `estimate.getInternalApproval` ao modo autenticado, junto da revisão já existente `estimate.getInternalApprovalReview`. As duas leituras ainda não foram implementadas; listagem e jornada completa ficam fora dessa fatia. Writers continuam fechados; adendo de escrita V2 não ratificado. |
| Aceitação operacional | Manus | Complemento ao pacote existente, casos e evidências inicialmente não executados; sem alterar V4/produto/banco/serviços | V2 recebida e aceita documentalmente com orientação de ordem; casos continuam não executados |
| Documentação pública de Auth/PostgREST | Perplexity | Pesquisa genérica com fontes primárias e limites; sem detalhes internos, acesso privado ou coordenação paralela | Pesquisa recebida; fontes primárias conferidas pelo integrador |

Root é o único integrador/publicador e dono das mudanças hospedadas desta fase. Michael mantém a board Munder; cada autor edita somente sua frente. Nenhuma proposta concede autorização para dois implementadores alterarem o mesmo endpoint ou migração. Testes focais isolados podem correr nas frentes; verificação integrada, publicação e mudanças de ambiente são serializadas por root.

A missão Munder é `adr002-write-transition-20261008`. O ACK confirmou a base atual e os donos; a proposta e o parecer ainda não são entrega implementada. A antiga automação de cinco minutos, que instruía trabalho de setembro em um chat com falha de compactação, foi pausada. Seus registros históricos foram preservados.

## Evidência inicial hospedada

Consulta somente leitura em `structr-ai-homolog`, às **14:40:52 UTC**:

- Projeto `wmspwegbqtzamkhxhusg`, ativo e saudável, PostgreSQL `17.11.0.003`.
- Auth: zero usuários; aplicação: zero perfis e projetos, um tenant herdado da migração.
- Configuração privada de issuer: zero linhas; fronteira ainda fechada.
- Migração mais recente: `20261007224847`, `structr_0015_authenticated_review_boundary`.
- As duas RPCs existentes declaram `default_transaction_isolation=serializable`. Catálogo não comprova sozinho a transação efetiva de uma chamada hospedada autenticada.

O painel Auth foi aberto pelo operador. O cadastro do primeiro usuário foi preparado; criação da senha e confirmação pertencem ao usuário. Nenhum resultado positivo de sessão hospedada é afirmado por essa preparação.

### Mudanças de configuração e observação posterior

- Expiração do access token alterada de 3.600 para **600 segundos**, salva no painel Auth da homologação.
- Cadastro público desativado. Login anônimo continua desativado; confirmação de e-mail e proteção contra reuso de refresh token preservadas.
- Nova consulta às **15:06:07 UTC**: Auth ainda sem usuários, zero perfis e conta do operador ainda não criada. A autorização recebida não substitui a entrada/submissão da senha pelo próprio usuário.
- Capturas locais: `/private/tmp/structr-homolog-access-20261008/session-ttl-600.jpg` e `admin-only-signups.jpg`. Nenhuma mudança em produção.

O bootstrap em revisão cria somente identidades/organizações sintéticas A1/A2/B1; não converte automaticamente o operador humano em uma dessas identidades. O vínculo operacional definitivo exige registro próprio, sem atribuir ao beneficiário a autoria de um ato administrativo.

### Recebimentos externos

**Manus:** [tarefa e pacote](https://manus.im/app/78QH93ZwrRaLy9GpVtm8jr?previewEventId=M92HkUQqqfgAtHW0VrUyhq&previewSandboxPath=%2Fhome%2Fubuntu%2FStructr_Aceitacao_Operacional_Delta_2026-10-08.zip). Arquivo `Structr_Aceitacao_Operacional_Delta_2026-10-08.zip`, SHA-256 local conferido `093173c7957f8558aed9033294f1fb45a4acf65b3e1a62fd29a0aea5d4308492`. A entrega declara 23 casos não executados e 15 linhas de evidência. Roteiro documental não é prova de execução.

**Perplexity:** [pesquisa pública entregue](https://www.perplexity.ai/computer/tasks/7590945f-aa05-4b83-a186-f57e7be0e7a2). Pontos conferidos em fontes primárias: [sessões Supabase](https://supabase.com/docs/guides/auth/sessions), [eventos do SDK](https://supabase.com/docs/reference/javascript/auth-onauthstatechange) e [transações PostgREST](https://docs.postgrest.org/en/v14/references/transactions.html). A documentação não prova o isolamento efetivo da instância hospedada.

**Munder:** proposta V1 de Jim, SHA-256 `874d75b09aa72f206a2386f76ed94e04dc1f2b3a84d3eb4698abc0dc53db8ca6`, recusada pelo integrador e por Gemini. Comparar timestamps devolvidos pelo cliente não autentica o resultado financeiro calculado fora do banco. O conjunto de política/contexto também precisa ser revalidado; não basta o timestamp do draft. Michael registrou a reconciliação e solicitou revisão documental. Nenhuma implementação de writers foi autorizada a partir dessa V1.

A V2 (`9edf76964354480986e7089f49daf80126f6b818fc304800aa6d937083bba539`) reconheceu o impedimento de aprovação/primeira emissão, mas ainda tratava versionamento sem validação equivalente do hash e redownload como resolvidos. Codex não ratificou essas reduções do contrato nem a alternativa de devolver credenciais SQL ao processo web. Foi solicitada uma proposta revisada de componente confiável separado, com implantação/custo/protocolo explícitos, sem autorizar infraestrutura. Leituras mínimas devem incluir adapter, RPC, ACL e provas próprias antes de alteração da allowlist. Não há abertura antecipada do gate.

O adendo V2 posterior (`e238529939290b2e120d0de63659af2ab0ce24d7cee74702b35a4bff9de37f6a`) continua não ratificado. Michael consolidou três lacunas confirmadas por leitura do código: exportação não possui replay universal por requestId; expiração precisa ser revalidada após espera por locks, além do início da tentativa; campos e privilégios das leituras ainda precisam de contrato nominal. O canal privado proposto também não tem implantação/custo demonstrados na hospedagem atual. Jim ficou responsável pelo contrato mínimo de leitura; nenhuma nova autorização genérica foi solicitada ao operador.

Revisão Codex do pacote Manus: 19/19 hashes internos válidos, 23 IDs de casos únicos e 15 linhas de evidência. Foram devolvidos seis ajustes documentais: dependências circulares; separação das rodadas de acesso e cálculo; refresh versus expiração de token; prova negativa de módulos mantidos fechados; referência externa completa do V4 e hash fora do próprio arquivo; reconciliação CSV/Markdown e distinção entre conta privada de homologação e dados de produção. V2 documental solicitada na mesma tarefa, sem repetir o verificador.

**V2 documental recebida e aceita com orientação operacional:** `Structr_Aceitacao_Operacional_Delta_V2_2026-10-08.zip`, SHA-256 `e45760addd086a8576b891a60d7a32221241e64999744580f36cd704c97c877d`, [entrega original](https://manus.im/app/78QH93ZwrRaLy9GpVtm8jr?previewEventId=rBupV4lCCi8DoHu47qltvK&previewSandboxPath=%2Fhome%2Fubuntu%2FStructr_Aceitacao_Operacional_Delta_V2_2026-10-08.zip). Codex conferiu checksum externo, 24/24 hashes internos, 24 casos únicos `NAO_EXECUTADO`, 16 evidências únicas `MISSING`, grafo acíclico e três documentos históricos V4 preservados. A divisão SES-02A/B explica o caso adicional. Nenhum executável incluído nem teste do verificador refeito.

Para execução, prevalece a ordem canônica de `CASOS_ACEITACAO_OPERACIONAL.md`: **SES-05 antes de SES-02A/B; exportação/PDF antes de criar versão e revogar a aprovação**. Os resumos do README/roteiro têm inversões nessa ordem; esta orientação as resolve sem alterar os bytes do ZIP aceito. A aceitação é documental, não operacional.

## Validação técnica da PR #30 — registro anterior ao provisionamento mínimo

O bootstrap administrativo passou **100 casos distintos**: 24 de manifesto/CLI offline e 76 físicos (37 Drizzle e 39 SQL). Os 28 casos físicos adicionados após a revisão da PR #30 reproduziram a adulteração de metadados antes da correção. O primeiro run final ficou em 99/100 por um timeout offline sob carga concorrente; esse log foi preservado. Os 24 offline passaram depois na regressão geral, com os mesmos hashes de fonte e sem aumentar limites. A consolidação de 24 offline + 76 físicos não conta repetições. Dois clusters PostgreSQL próprios foram encerrados e removidos, com verificação independente da remoção.

Foram comprovados criação/replay exato, colisões entre identificadores, falha real de auditoria e readback, preservação de microssegundos, concorrência de duas conexões, replay entre executores e autoria administrativa sem impersonar A1. `pnpm check` não inclui scripts por padrão; a verificação TypeScript específica dos dois scripts passou separadamente.

O helper Drizzle chama `db.transaction()` e aguarda `logAudit(..., tx)` em cada mudança. O gerador SQL é um artefato administrativo offline separado, com transação e audit explícitos, sem afirmar chamadas aos helpers TypeScript de F2/F5. Sua execução remota não ocorreu e continua condicionada à ratificação do artefato operacional concreto e vínculo comprovado ao destino. Nenhum endpoint, tabela, migração, grant ou credencial foi criado por esse pacote.

A revisão de sessão reproduziu duas falhas adicionais: ressurreição do login após reload durante logout pendente, e interferência de eventos Supabase no modo legado. Ambas foram corrigidas, assim como o evento de saída de outra aba sob marcador persistente. A revisão automática da PR #30 também revelou que o logout Supabase deixava o cookie legado válido no modo de compatibilidade. A correção limpa a identidade local imediatamente, envia a limpeza do cookie na nova geração de sessão e aguarda cookie/provedor antes de permitir outro login. **40 testes focais** passaram; quatro regressões novas reproduziram a falha antes da correção. Revisão estática independente final sem bloqueadores. Os testes usam QueryClient/tRPC reais, SDK real com transporte/armazenamento controlados em casos de logout, e SSR/efeitos para hooks/Login. Não equivalem a aceitação visual hospedada.

O recibo SQL agora confere ID/hash exatos calculados pelo renderer aprovado e manifesto; o SQL captura a expectativa antes de qualquer trigger, e o helper Drizzle também a valida. Ambos os campos ausentes continuam sendo o formato Drizzle permitido no replay, sem atestar a origem histórica. Esses metadados não são assinatura nem autenticação do executor.

`pnpm check` e `pnpm build:vercel` passaram após as correções finais. O build mantém avisos de configuração opcional de analytics/chunks, sem erro de geração. A suíte geral passou **6.767 testes, zero falhas**, com **1.057 casos opt-in ignorados** no comando padrão. Os 76 físicos novos deste pacote foram executados separadamente e passaram. São **140 casos novos distintos** nesta etapa: 64 na suíte padrão (40 cliente + 24 manifesto/CLI) e 76 físicos; execuções sobrepostas não são contadas novamente.

### Relatório de fechamento local do recorte

| Item | Evidência |
| --- | --- |
| TypeScript | `pnpm check`: zero erros; checagem específica dos scripts também sem erros |
| Testes | `pnpm test`: 6.767 aprovados, zero falhas; 76 físicos novos aprovados em execução separada |
| Build | `pnpm build:vercel`: concluído |
| Arquivos novos | `client/src/lib/auth-session-cache.ts`; quatro `server/homolog-auth-ui-*.test.ts`; `scripts/homolog-access-bootstrap.ts`, `scripts/homolog-access-bootstrap-sql.ts`, `scripts/homolog-access-bootstrap.md`; `server/homolog-access-bootstrap.test.ts`; este registro |
| Arquivos modificados | `client/src/_core/hooks/useAuth.ts`, `useSupabaseAuth.ts`; `client/src/lib/auth-token.ts`; `client/src/main.tsx`; `client/src/pages/Login.tsx`; `server/audit.ts`; README, current-state, current-sprint e todo |
| Tabelas / migrações novas | Zero |
| Funções novas de motor | Nenhuma; motores financeiros preservados |
| Helpers administrativos | `parseHomologAccessManifest`, `planHomologAccess`, `buildHomologIdentityState`, `bootstrapHomologAccess`, `renderHomologAccessSql` |
| Endpoints novos / abertura de acesso | Nenhum; gate do backend preservado |
| Segurança | Nenhum endpoint de negócio público introduzido; nenhum segredo no pacote |
| Auditoria | Inserções do helper Drizzle chamam `logAudit(..., tx)`; gerador SQL distinto é offline e sua execução remota permanece pendente |
| Regressões | Nenhum teste existente quebrou na suíte executada |
| Limites | Sem aceitação visual hospedada, conta/perfil do operador comprovados ou fluxo financeiro completo; não é fechamento do sprint nem liberação de uso real |

Logs locais estão em `tmp/auth-homolog-20261008/` (ignorado no Git); evidência física inicial em `/private/tmp/structr-homolog-bootstrap-evidence-7pw_c1q8/` e consolidação pós-revisão em `/private/tmp/structr-pr30-bootstrap-metadata-1h_h66ow/`. A checagem TypeScript específica foi repetida com fontes estáveis após uma primeira leitura coincidir com a formatação. Commits de implementação: `235e5bc3`, `5e0953b8`, `3d184265` e `0e00f762`. A publicação desta candidata usa a branch `codex/structr-homolog-access-proof`; CI e merge são gates adicionais à validação local. Publicar o código não ativa issuer, contas, grants nem o caminho financeiro na homologação. A [PR #30](https://github.com/wcvmsilva/structr-ai/pull/30) registra os checks hospedados de cada candidata. A primeira prévia do commit `d614548` foi gerada, mas respondeu 503 à API: `STRUCTR_HOSTED_API_ENABLED` está ausente e o guard existente recusa a chamada antes de carregar a aplicação, como na PR #29. A configuração herdada da hospedagem ainda precisa ser convertida em runtime aprovado da homologação; valores de ambiente não foram descriptografados nem modificados. Deploy automático da main permanece desativado.

## Checkpoint após a PR #30 — 8 de outubro, 16:13 UTC

A [PR #30](https://github.com/wcvmsilva/structr-ai/pull/30) foi integrada às **15:58:28 UTC** em `10ea3261a96814072f672ecb41655108f206b3ea`. O [CI da candidata final](https://github.com/wcvmsilva/structr-ai/actions/runs/37804401375) e o [CI da main](https://github.com/wcvmsilva/structr-ai/actions/runs/37805107145) passaram. A pasta principal local foi atualizada por fast-forward e estava limpa nesse commit. Os resultados de 6.767 testes padrão e 76 físicos acima pertencem ao código dessa entrega; não são novos testes hospedados.

O operador criou a conta Auth às **15:33:57 UTC**. A leitura administrativa confirmou e-mail verificado, sem primeiro login registrado; UID e e-mail ficam somente no plano privado. A consulta posterior ainda encontrou **zero perfis e zero linhas de issuer**. O vínculo mínimo será um perfil `user` no tenant existente GCHI, distinto das fixtures A1/A2/B1. Não se atribui papel de administrador por ser o primeiro usuário.

A prévia `dpl_6BZXsM3d7zzqZNugzKqpq3suUj4X`, fonte `2cd4a699050313702e7f06cffb0bc46dc8ad30a9`, ficou **READY** com `target=null`. Seus 19 valores de ambiente são específicos da branch `codex/structr-homolog-access-proof`: provedor Supabase da homologação, Data API autenticada, tenant estrito, fallback legado desligado, chave publicável e substituições vazias para credenciais/configurações incompatíveis herdadas. O guard de inicialização foi habilitado somente após conferência desses valores. Não foram alterados os ambientes globais ou de produção, nem configurada credencial SQL/service role no processo web.

Provas HTTP do novo deploy:

| Chamada | Resultado | Alcance da evidência |
| --- | --- | --- |
| `auth.session`, sem bearer | HTTP 200, `provider=supabase`, `authenticated=false`, `Cache-Control: no-store` | Aplicação inicia e anuncia o provedor correto; não comprova login |
| `estimate.getById`, sem bearer | HTTP 403, procedimento indisponível no modo Data API | Gate fechado para capacidade ainda não integrada |
| `estimate.getInternalApprovalReview` pelo fetch protegido | Ferramenta não atravessou a proteção Vercel | Sem resultado da aplicação; não contar como prova de recusa do Structr |

No navegador, o acesso à prévia parou na verificação em duas etapas da Vercel; a conclusão foi solicitada diretamente ao operador, sem pedir código no chat. A disponibilidade da chave pública ES256/P-256 da homologação foi novamente conferida; isso não atesta um token real nem sua duração. Configurar o issuer conhecido não exige um positivo de sessão anterior: a prova de sessão ocorre depois de existirem issuer e perfil, e a rotina continua recusando claims incompatíveis.

Uma primeira tentativa de deploy com `target=staging` foi cancelada antes de atribuir aliases; a listagem final mostrou zero aliases nesse deploy. A criação correta omitiu `target`, resultando em Preview. O alias compartilhado principal continuou no deployment anterior `dpl_Hwp7P2kvQXNW1Q4HWhXZBDUAciae`. Deploy automático da main permanece desativado, e o banco de produção não participou da operação.

Os artefatos administrativos mínimos de perfil e issuer estão sendo preparados e testados separadamente, sem nova infraestrutura ou endpoints. Nenhuma execução remota deles é afirmada neste checkpoint. A evidência operacional sanitizada permanece em `/private/tmp/structr-homolog-access-20261008/post-merge-checkpoint.json`. O contrato Munder de leitura V2 ainda requer matriz transitiva de privilégios/policies e baseline `TENANT_STRICT=true`; Jim recebeu pedido de V3 e Gemini deve revisar esse mesmo hash. Writers e uso com projetos reais continuam fechados.

### Provisionamento mínimo preparado — registro histórico anterior à aplicação

Este estado de preparação preserva a decisão pendente e a contagem de testes observadas antes da execução. A autorização, a aplicação e a contagem final de 64 casos constam do checkpoint seguinte.

Dois artefatos privados foram preparados para o único operador: **um perfil `user` no tenant existente**, seguido de **uma configuração privada do issuer da homologação**. Cada operação usa sua própria transação SERIALIZABLE, auditoria da linha e recibo; total planejado: um perfil, uma configuração e quatro auditorias. Não há DML em Auth/tenant, grants, DDL, projetos ou permissões. Se a segunda transação falhar, a primeira conserva somente o perfil e o issuer permanece fechado.

- Perfil: SQL SHA-256 `32dbf99c7134ec9d0e319d119313a6616d0ec8c164cb7b013f8a928a69b2ddb3`; **32 testes passaram**, sendo oito offline e 24 físicos, com TypeScript strict aprovado.
- Issuer: SQL SHA-256 `048a7fa5ef0b3f0f835171cf97c66e49eb183041280b6b36d000585e5f09bef8`; **31 testes passaram**, com migração 0015 real no laboratório PostgreSQL.
- Os 63 casos são distintos dos testes da PR #30. RED das correções preservado, clusters locais encerrados/removidos e hashes finais conferidos. Revisão independente sem P1/P2 restante nesses dois artefatos.
- O conector hospedado comprovou SERIALIZABLE em um batch somente leitura encerrado com ROLLBACK; isso não é aplicação do provisionamento. Os próprios artefatos conferem isolamento e modo gravável antes de qualquer mudança.

**Aplicação remota pendente de decisão específica**, solicitada ao operador: aceitar estes dois artefatos administrativos SQL, com atomicidade e audit durável, como exceção delimitada às chamadas literais dos helpers em F2/F5. A autorização geral para configurar a conta já existe; falta decidir a via distinta. Nenhum `db.transaction()`/`logAudit()` TypeScript é invocado por esse SQL, e não há handle administrativo Drizzle disponível. Isso não altera os contratos de mutations do produto nem habilita writers. O [guia de bootstrap](../../scripts/homolog-access-bootstrap.md) mantém a distinção entre executores.

O pacote para revisão está em `/private/tmp/structr-homolog-access-20261008/administrative-provisioning-review.md`; manifestos, IDs e SQL ficam privados. O perfil do operador e a configuração ainda não foram inseridos na homologação. Login real e isolamento organizacional permanecem pendentes; a aba da Vercel aguarda a verificação em duas etapas do próprio operador.

## Checkpoint: provisionamento administrativo aplicado — 8 de outubro, 17:57 UTC

Registro histórico anterior ao primeiro login; a pendência de sessão aqui descrita foi superada pelo checkpoint das 18:20 UTC.

O responsável respondeu **“feito versel conectado pode assumir daqui”** após os dois passos pendentes terem sido apresentados. A autorização cobriu somente os dois artefatos administrativos exatos revisados e a distinção delimitada de executor F2/F5. O integrador selecionou `structr-ai-homolog` (`wmspwegbqtzamkhxhusg`) no conector e aplicou os lotes completos em duas transações SERIALIZABLE separadas, **sem retries**. Esses lotes usam SQL com audit durável; não invocam literalmente `db.transaction()`/`logAudit()` TypeScript e não alteram o contrato dos writers do produto.

| Lote aplicado | SHA-256 do SQL completo | Estado confirmado |
| --- | --- | --- |
| Perfil do operador | `32dbf99c7134ec9d0e319d119313a6616d0ec8c164cb7b013f8a928a69b2ddb3` | `created`; um perfil ativo, role `user`, no tenant existente; duas auditorias |
| Issuer da homologação | `048a7fa5ef0b3f0f835171cf97c66e49eb183041280b6b36d000585e5f09bef8` | `created`; uma configuração privada do emissor e audience `authenticated`; duas auditorias |

O perfil foi registrado às **17:48:56.781256 UTC**. O conector retornou apenas o último SELECT do readback original com múltiplas consultas; antes da ativação do issuer, um SELECT combinado separado confirmou `profileCount=1`, `auditCount=2`, `receiptCount=1`, `eventMatches=true` e `receiptMatches=true`, com estado, manifesto, hash do executor e autoria administrativa exatos. Nesse instante, `issuerCount=0`. O readback separado do issuer retornou `valid=true` e seus sete checks verdadeiros: `audit_count`, `receipt_exact`, `tenant_context`, `profile_context`, `row_audit_exact`, `configuration_count` e `configuration_intent`.

Às **17:51:00.312546 UTC**, a leitura final confirmou **um perfil, um issuer e quatro novas auditorias**, com **zero clientes, projetos e drafts de orçamento**. Não houve DML em Auth ou tenant, alteração de grants/permissões, DDL ou abertura de writers de negócio. O operador não recebeu papel de administrador. Os readbacks comprovam estado/manifesto/auditoria persistidos; não são assinaturas de recibos. `authVerified=false` e `databaseTargetVerified=false` permanecem nos resultados: o SQL não prova sessão JWT nem identidade criptográfica do endpoint; o destino foi selecionado no conector.

Depois do provisionamento, cinco sondas negativas da Data API foram recusadas, sem token real do operador e sem retorno de arrays de dados:

| Sonda | Horário UTC | Resultado |
| --- | --- | --- |
| RPC de sessão anônima | 17:51:46 | HTTP 401, `42501` |
| RPC de sessão com JWT forjado e `kid` inexistente | 17:51:46 | HTTP 401, `PGRST301` |
| Leitura anônima da tabela bruta `profiles` | 17:51:46 | HTTP 401, `42501` |
| Leitura anônima da tabela bruta `projects` | 17:51:46 | HTTP 401, `42501` |
| RPC de sessão com JWT forjado ES256, `kid` publicado no JWKS e assinatura fictícia | 17:57:11 | HTTP 401, `PGRST301` |

A recusa dos dois tokens forjados não identifica qual ramo criptográfico interno foi percorrido e não comprova aceitação de um JWT válido. Os negativos acima também não substituem as provas positivas e de isolamento por organização.

A autenticação da Vercel foi concluída pelo operador e a prévia alcançou a tela de login do Structr. **O primeiro login no Structr e a prova de sessão real continuam pendentes**; nenhuma senha/token/identificador pessoal é publicado neste registro. Aprovação, versionamento, exportação e uso com projetos reais permanecem fechados.

Os dois artefatos administrativos privados têm **64 casos distintos aprovados: 32 do perfil e 32 do issuer**, incluindo a execução local dos bytes exatos do issuer e de seu readback. Esses 64 casos privados não foram repetidos e permanecem separados da regressão do produto: **6.767 testes** e 76 físicos registrados na PR #30, cujos resultados de publicação têm atribuição própria. Não somar esses totais como uma nova suíte. As revisões finais não encontraram P1/P2 restante no escopo dos dois artefatos, e os laboratórios foram removidos.

Evidência privada retida em `tmp/auth-homolog-20261008/administrative-provisioning/`: recibos em `hosted-execution-receipts.json`, sondas em `post-provision-negative-probes.json` e `post-provision-published-kid-negative-probe.json`, captura da tela de login e `hosted-execution-checksums.json`. Manifestos, IDs, recibos completos, captura e SQL permanecem fora dos documentos públicos.

## Checkpoint: sessão real resolvida — 8 de outubro, 18:20 UTC

A migração `structr_0016_authenticated_public_schema_usage`, versão `20261008182017`, foi aplicada pelo integrador na homologação com o SQL exato testado. O readback confirmou USAGE em `public` somente para `authenticated` entre os três papéis API, mantendo CREATE, schema privado e leitura bruta de `profiles` fechados. EXECUTE de `authenticated` no schema `public` continua limitado às duas RPCs; funções, policies e contagens permanecem iguais: um perfil, quatro auditorias e zero clientes, projetos ou drafts.

O navegador alcançou o Dashboard com role `user`. Entre 18:20:41 e 18:20:50 UTC, nove chamadas à RPC de sessão responderam HTTP 200; os metadados observados registraram ES256, papel `authenticated`, correspondência do subject e TTL original de 600 segundos. Nenhum bearer foi coletado. Esse positivo comprova o acesso do operador; não comprova isolamento multiorganização ou a jornada financeira. Rótulos legados do Dashboard, inclusive MySQL/CSV ready, não são evidência do banco ou de exportações ativas: valem a allowlist e os gates do contrato.

Os advisors antes/depois conservaram os mesmos três grupos: três INFO de RLS sem policies, oito WARN de search_path e um WARN de proteção contra senhas vazadas desativada. Não há declaração de zero alertas. A correção não ampliou funções nem tabelas. [Diagnóstico, hashes e provas locais](homolog-session-schema-usage-2026-10-08.md) e evidência privada `hosted-schema-usage-execution.json` preservam o escopo. O inventário de 17 migrations passou por RED com três falhas/37 passes e GREEN focal com 40 passes; `pnpm check` passou. Regressão global do produto ainda pendente no pre-push.

Às **18:23:03 UTC**, as cinco sondas negativas foram repetidas após a 0016 e recusadas com HTTP 401: sessão anônima e tabelas brutas `profiles`/`projects` com `42501`; JWTs forjados com kid inexistente e publicado com `PGRST301`. Não retornaram arrays e não usaram JWT real. O registro privado `post-schema-usage-negative-probes.json` comprova a preservação desses mesmos cinco controles; não são dez controles distintos. A fase de login/perfil está comprovada, enquanto isolamento multiorganização, revisão com dados e jornada completa permanecem pendentes.

## Ordem de liberação

1. **Identidade:** conta do único operador, perfil no tenant existente e issuer provisionados; primeiro login e perfil resolvido comprovados, com TTL observado de 600 segundos. As identidades negativas A1/A2/B1 e seus contextos sintéticos permanecem uma prova separada. Nenhuma escrita direta em `auth.users` ou `auth.sessions`.
2. **Sessão:** comprovar A1/A2/B1 por tokens reais, anon/assinatura inválida/tabelas brutas recusados, perfil inativo, expiração, troca de identidade e ausência de dados anteriores. Validar isolamento SERIALIZABLE no serviço real.
3. **Leituras mínimas:** integrar os endpoints existentes de lista, detalhe e decisão. `getInternalApprovalReview` sozinho não torna a tela utilizável: ela primeiro consulta `getById`. Cada entrada exige adapter autenticado, autorização própria e prova antes de sair do bloqueio global.
4. **Formação:** cliente/projeto, Intake e Calculator pelo produto, com geocoding real e política vigente. Bootstrap de projeto/draft pode servir a teste técnico isolado, mas não substitui essa prova da jornada.
5. **Decisão:** aprovar/revogar, versionar e exportar por operações autenticadas próprias, preservando contratos A1/V2, auditoria, replay, imutabilidade e motores financeiros aceitos. RPC diretamente chamável não pode confiar em snapshot/hash/cálculo do cliente como autoridade.
6. **Aceitação:** baixar JSON/PDF reais, comparar com controle independente, conferir PDF visualmente e testar revogação, repetição, falhas e recuperação. Publicação/CI não substituem esses resultados.

A1 pode ser owner de um projeto criado pelo produto; retirar sua membership não revoga a autoridade de owner. A prova da aresta membership usa um ator não-owner com concessão/retirada auditada de permissão, restaurando o estado de teste.

## Critérios para o primeiro projeto real

Permanecem pendentes: jornada hospedada positiva completa; separação por organização e demais acessos negativos; cálculos e documentos conferidos de forma independente; auditoria e imutabilidade das operações de negócio sob falhas/repetição; recuperação operacional comprovada; revisão independente do recorte de uso sem P1/P2 pendente; resultado do operador registrado. O provisionamento, as cinco recusas anteriores e o primeiro login positivo não encerram esses critérios. Aprovação interna, emissão, aceite comercial e autorização de obra são atos diferentes. A liberação deve nomear exatamente as capacidades comprovadas e o ambiente correspondente.

## Limites de evidência

As provas da PR #29 continuam válidas no escopo registrado em [ADR-002 implementado](adr002-review-access-2026-10-07.md). Não são testes das alterações desta fase. O verificador offline V4 permanece ferramenta auxiliar; seu resultado não aprova o piloto. Manus/Perplexity não recebem credenciais, dados reais nem autoridade sobre o ambiente. O resumo interno inicialmente destinado ao Perplexity foi bloqueado pela revisão automática; a consulta efetivamente enviada contém apenas perguntas genéricas sobre documentação pública.
