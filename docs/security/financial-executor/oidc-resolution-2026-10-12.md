# OIDC do executor — decisão de configuração, 12 de outubro de 2026

A pendência foi resolvida por documentação e fonte oficial: **não depender de `oidcTokenConfig.enabled:false` nem declarar OIDC desativado**. A identidade efêmera da Vercel deve ser considerada disponível quando uma execução for autorizada.

O [provider oficial v3.15.3](https://raw.githubusercontent.com/vercel/terraform-provider-vercel/v3.15.3/vercel/resource_project.go) recusava explicitamente false como opção depreciada. A remoção ocorreu no [PR407](https://github.com/vercel/terraform-provider-vercel/pull/407), integrado em 21 de outubro de 2025. A [documentação atual](https://vercel.com/docs/oidc) oferece issuer Team/Global e descreve emissão automática durante builds, Functions e env pull. O schema REST/conector ainda aceitar o campo antigo não comprova seu efeito.

## Delimitação

- Manter issuer **Team** no projeto separado; nenhum ajuste remoto foi necessário nesta investigação.
- Não solicitar token, executar env pull, exportar, registrar, trocar ou encaminhar OIDC; nenhuma confiança, connector ou grant OIDC é criado.
- OIDC Vercel não é senha PostgreSQL nem identidade humana do Structr.
- O executor exige bearer `Authorization` validado contra issuer/JWKS Supabase, audience `authenticated`, papel e subject nominal. `x-vercel-oidc-token` não satisfaz esse contrato.
- Não descrever OIDC como universalmente sem privilégios: [AI Gateway](https://vercel.com/docs/ai-gateway/authentication-and-byok/oidc) e [Sandbox](https://vercel.com/docs/sandbox/concepts/authentication) aceitam essa identidade. Seu uso e qualquer serviço adicional permanecem fora do escopo.
- A futura confirmação de build/deployment deve reconhecer a emissão automática da plataforma; não prometer ausência global de tokens internos.

## Evidência e limite

A revisão independente inspecionou os guards em `services/financial-executor/src/auth.ts` e `config.ts`, e testes existentes de issuer/audience/role/operador estrangeiros. O readback do projeto fechado manteve `live:false`, `latestDeployment:null` e proteção SSO habilitada. A preparação anterior confirmou zero variáveis/deployments e nenhum connector/integração, com pins privados fora do Git.

Nenhuma prova de emissão em runtime foi executada: não houve build, deployment, env pull ou chamada de geração de token. Essa prova não é necessária para aceitar o comportamento documentado e retirar a falsa condição “OIDC off”; a autenticação financeira própria continua sujeita aos testes hospedados.
