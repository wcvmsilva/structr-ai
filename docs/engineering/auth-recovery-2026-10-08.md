# Recuperação de acesso e senha — 8 de outubro de 2026

## Escopo e diagnóstico

O operador relatou novamente a mensagem de conta indisponível após autenticar e solicitou recuperação/troca de senha. A aba de homologação observada pelo integrador chegou ao Dashboard após recarga. O endereço da ocorrência relatada ainda não foi identificado; as correções abaixo foram reproduzidas localmente e não são atribuídas como causa comprovada desse evento hospedado.

O botão **Try again** agora força renovação do bearer antes de consultar o perfil. A renovação automática da mesma identidade também revalida `auth.me`, sem apagar os demais dados em cache. Isso cobre o bearer ainda aparentemente válido no navegador, mas recusado pela política de duração da sessão, e o perfil nulo que antes permanecia em cache.

## Fluxo de senha

- `/forgot-password`: pede o link por e-mail, com resposta neutra para evitar divulgação de existência de contas.
- `Settings → Change password` e `/change-password`: exigem perfil autenticado e exibem senha atual, nova senha e confirmação. O formulário anterior por e-mail foi substituído pelo pedido explícito do operador; a recuperação continua em `/forgot-password`.
- `/reset-password`: permite definir a senha somente após o evento `PASSWORD_RECOVERY` do SDK. O código da URL, a sessão persistida e `INITIAL_SESSION` não habilitam o formulário.
- O SDK Supabase executa o PKCE; o link deve ser aberto no mesmo navegador em que foi pedido. Links inválidos, usados ou expirados permitem pedir outro.
- A credencial de recuperação fica fora do transporte de negócio desde antes da hidratação do SDK. A senha segue diretamente ao Auth com bearer capturado e validade/identidade conferidas; não passa por tRPC, SQL, documentos de evidência ou logs da aplicação.
- Mudanças de identidade, novos links, cancelamento e respostas atrasadas invalidam operações antigas. Voltar o foco à mesma sessão não cancela um link válido. Sair desse fluxo limpa a captura local e mantém o bloqueio de negócio até login explícito; não chama logout global que pudesse afetar outra conta aberta depois.

Não há novo domínio de negócio, tabela, migration, policy, grant, engine financeiro, helper DB ou endpoint tRPC. A fronteira ADR-002 e a allowlist de negócio permanecem iguais. F1/F5/S2–S6 dos domínios de negócio não são ampliadas por esta mudança. Zod valida e-mail, senha e resposta da atualização. Os estados locais da interface não são enums canônicos de negócio.

**Auditoria:** as operações de credencial são nativas do Supabase Auth, com auditoria do provedor (`user_recovery_requested` / `user_updated_password`), conforme [Auth audit logs](https://supabase.com/docs/guides/auth/audit-logs). Não foram criadas mutações de negócio sem `withAuditLog()`/`logAudit()` e não se alega que o código de frontend chame esses helpers. A observação dos eventos reais de pedido/troca ainda depende da execução pessoal abaixo; documentação do provedor não é evidência de evento ocorrido. Nenhuma exceção administrativa anterior de F2 é estendida a writers do produto.

## Validação local

TDD com logs RED anteriores aos reparos. Revisão independente identificou e reproduziu retorno de foco, mudança de identidade durante pedido de e-mail, saída global sobre outra conta, erro tardio de hidratação e variantes de rota; os reparos passaram por nova revisão.

**172 casos focais passaram, sendo 132 novos e 40 existentes, sem dupla contagem:** 14 de renovação, 58 do controlador de senha, 18 da integração da sessão, 14 de redirecionamento e 28 de telas/rotas/menu são os novos. Os testes existentes preservaram suas assertions; o mock do roteador no teste Login foi atualizado para oferecer o contexto real exigido por `Link`.

`pnpm check` e `pnpm build:vercel` passaram. A build mantém o aviso de tamanho de bundles. A suíte completa passou **6.899 testes, com 1.086 ignorados e zero falhas** (200 arquivos passaram, 36 ignorados). Os 132 novos casos já estão incluídos nos 6.899; os ignorados não são tratados como aprovados. Código registrado em `8f8bdbe8` (renovação) e `27492ac6` (senha). Publicação, hook obrigatório e CI serão registrados após sua conclusão. Os testes de UI são React SSR, roteamento e handlers reais com Auth/HTTP controlados; não substituem e-mail, senha e navegador hospedados.

## Configuração de homologação e limites

Em 8 de outubro, o painel Supabase confirmou a substituição de `http://localhost:3000` pelo origin exato da homologação no Site URL e **um único redirect autorizado**, com caminho `/reset-password`, sem wildcard. O template existente usa `{{ .ConfirmationURL }}`. Nenhuma configuração de produção foi alterada.

O projeto Vercel `structr-ai` continua usando a branch `codex/structr-homolog-access-proof` com 19 variáveis exclusivas de Preview. Auth Supabase, tenant estrito e Data API autenticada permanecem ativos; fallback legado está desativado, SQL e segredos de assinatura continuam vazios. O deploy por Git de `main` permanece desativado.

O envio ainda usa o serviço de e-mail padrão do Supabase, indicado pelo próprio painel como limitado e inadequado para produção. SMTP próprio e prova de entrega operacional continuam pendentes. Este pacote não cria dados reais nem libera o piloto.

## Próxima prova pessoal

Após publicação, o operador pede o link, abre o e-mail no mesmo navegador, define e confirma a própria senha, volta ao login e comprova chegada ao painel. O integrador não coleta a senha nem executa sua entrada/submissão. Depois serão conferidos os eventos sanitizados de Auth e a consulta de perfil.

Separadamente continuam pendentes as identidades negativas, isolamento entre organizações e a jornada completa de criação, aprovação, versão e exportação. A leitura mínima do Munder segue como frente posterior; Manus mantém o roteiro de aceitação documental. Aprovar esta mudança de acesso não libera projetos reais.


## Troca de senha em Settings — complemento de 8 de outubro

Solicitação explícita do operador: três campos dentro de Settings, com atualização da senha sem sair da página. A rota e o menu existentes usam o mesmo formulário. A nova senha deve ter de 8 a 128 caracteres, diferir da atual e coincidir com a confirmação; os bytes das senhas não são aparados. No sucesso os campos são limpos e a sessão corrente é mantida. Troca de identidade e desmontagem descartam campos e mensagens antigas.

A chamada única `PUT /auth/v1/user` envia `password` e `current_password` ao Auth, com bearer capturado antes de qualquer espera. Não reloga o operador nem usa storage mutável do SDK para escolher outra identidade durante a gravação. Zod valida contexto, entradas e resposta; duplicação, timeout, cancelamento, expiração e respostas fora da identidade original são tratados. O filtro local de AMR exige `password` e recusa `otp`, `magiclink` e `recovery`: é uma recusa adicional, não autenticação da assinatura. Assinatura e senha atual são verificadas pelo Auth.

**Pré-requisito hospedado aplicado e relido após recarga:** em `structr-ai-homolog`, `Require current password when updating` passou de desligado para ligado. `Secure password change` continuou desligado; nenhuma outra opção foi alterada. A [documentação oficial](https://supabase.com/docs/guides/auth/passwords#verifying-the-current-password) exige essa configuração; enviar apenas o campo não assegura verificação quando a opção está desligada. O provedor possui exceções para recuperação/OTP/magic link, que este formulário recusa. Captura local: `/private/tmp/structr-settings-password-20261008/current-password-required.png`. Produção não foi alterada.

**Validação desta extensão:** 80 novos testes de comportamento: 43 controlador, 17 integração de sessão e 20 UI. O conjunto focal completo passou **238/238** em 13 arquivos; `pnpm check` e `pnpm build:vercel` passaram. O aviso preexistente de tamanho de bundles continua. RED foi observado antes de cada implementação, incluindo oito falhas específicas do filtro AMR. A revisão independente não encontrou bloqueadores. Suíte geral/hook e publicação serão registrados na conclusão; não são inferidos das provas focais.

Evidências locais: `/private/tmp/structr-settings-bridge-green.log`, `/private/tmp/structr-settings-focal.log`, `/private/tmp/structr-settings-check.log`, `/private/tmp/structr-settings-build.log` e `tmp/auth-homolog-20261008/settings-password-ui-lifetime-green.log`. Tests de transporte usam Auth controlado; não alegam uma troca real da senha do operador. O provedor transaciona persistência e auditoria nativa, mas a comparação da senha ocorre antes da transação e não é apresentada como CAS entre trocas concorrentes.

**Aceitação pessoal pendente:** depois de publicado, o operador abre Settings, entra com as três senhas e envia pessoalmente. Não deve compartilhar senhas com agentes. É uma prova separada da entrega de e-mail e dos gates de isolamento/jornada; projetos reais permanecem fechados.
