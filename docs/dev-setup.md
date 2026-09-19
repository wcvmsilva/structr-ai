# Dev Setup

## Local URL

- http://localhost:3000

## Status

- Frontend: OK
- Backend: OK
- Auth bypass: ON

## Auth (DEV mode)

- OAuth desativado localmente
- useAuth.ts com bypass
- login redirects desabilitados

## Tenant (DEV mode) — `DEV_TENANT_ID`

Desde a remediação B2 (Codex P1-1), um caller autenticado **sem tenant resolvido não
tem acesso a nenhum dado de negócio**: NULL não é um tenant e não autoriza nada. A
rejeição acontece na fronteira das procedures (`tenantProcedure`), com a mensagem
`No tenant is assigned to this account (10005)`.

O perfil do bypass de DEV é sintético e não carrega tenant próprio. Portanto:

- **Defina `DEV_TENANT_ID`** no `.env` local, apontando para um `tenants.id`
  existente. É um UUID comum, não um segredo.
- Sem ele, toda rota de negócio (clients, deals, leads, pipeline, projects,
  estimates, …) passa a rejeitar em DEV.

**O que deixou de acontecer implicitamente:** antes, `resolveTenantId()` substituía
silenciosamente o tenant ausente pelo tenant padrão (GCHI). O bypass de DEV
"funcionava" porque lia os dados do tenant principal de produção. Essa substituição
foi removida — era exatamente a falha de fronteira de identidade reportada em
Codex P1-1.

Rotas que continuam acessíveis sem tenant (carve-outs explícitos): `auth.*`,
`system.health` e `tenantSettings.provision` — esta última porque *cria* um tenant.

## Observações

- Porta padrão: 3000 (sobe na próxima disponível se ocupada)

## Regras

- Nunca remover lógica de produção
- Sempre usar bypass só em DEV
- Confirmar porta antes de abrir navegador
