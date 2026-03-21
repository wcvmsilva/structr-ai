# Structr.ai — Agent Instructions

## BEFORE ANYTHING ELSE
1. Read AGENTS.md — contains ALL project rules
2. Read SPRINT-TEMPLATE.md — the structure every sprint must follow
3. Read STRUCTR-COS-ROADMAP.md — the full roadmap with sprint specs

## WORKFLOW OBRIGATORIO
1. /plan — planejar ANTES de codar
2. /tdd — teste ANTES de implementar
3. /execute — executar passo a passo
4. /review — revisar antes de declarar pronto
5. /verify — rodar pnpm check + pnpm test

## REGRAS DE QUALIDADE
- Minimo 60 testes por sprint
- NUNCA usar publicProcedure em dados sensiveis
- TODA mutacao deve chamar logAudit()
- TODOS enums normalizados na boundary do router
- pnpm check (0 erros) + pnpm test (0 falhas) apos CADA fase

## PADRAO DE ARQUITETURA
shared/[domain]-engine.ts    = Funcoes puras, zero DB
server/[domain]-db.ts        = DB helpers com audit logging
server/[domain]-router.ts    = tRPC com protectedProcedure + Zod
client/src/pages/[Domain].tsx = React page com tRPC hooks

## ANTES DE DECLARAR SPRINT COMPLETO
Verificar TODOS os itens do checklist no final do AGENTS.md
