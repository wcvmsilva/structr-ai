# Setup do Antigravity — Copie e Cole

Siga na ordem. Cada bloco cinza é um comando.
Copie o bloco inteiro e cole no Terminal (Cmd+V).

---

## ABRIR O TERMINAL

1. No seu Mac, aperte `Cmd + Espaço`
2. Digite: Terminal
3. Aperte Enter

---

## BLOCO 1 — Ir para a pasta do projeto

Copie e cole no Terminal:

```
cd ~/Structr.ai/Structr.ai-clone/structr-ai
```

Se der erro "No such file or directory", tente:

```
cd ~/Structr.ai/Structr.ai-clone/structr-ai || cd ~/Desktop/Structr.ai/Structr.ai-clone/structr-ai || echo "ERRO: Pasta nao encontrada. Digite: find ~ -name structr-ai -type d"
```

---

## BLOCO 2 — Criar o arquivo GEMINI.md

Este é o arquivo que o Antigravity lê automaticamente.
Copie TUDO de uma vez (do cat até o último EOF) e cole no Terminal:

```
cat > GEMINI.md << 'ENDOFFILE'
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
ENDOFFILE
```

Para confirmar que funcionou, copie e cole:

```
head -3 GEMINI.md
```

Deve aparecer: `# Structr.ai — Agent Instructions`

---

## BLOCO 3 — Verificar que os outros arquivos existem

Copie e cole:

```
echo "--- Verificando arquivos ---" && ls -la AGENTS.md && ls -la SPRINT-TEMPLATE.md && ls -la STRUCTR-COS-ROADMAP.md && echo "--- TUDO OK ---"
```

Se aparecer `TUDO OK` no final, todos os arquivos existem.

Se algum der erro "No such file", copie da pasta pai:

```
cp ~/Structr.ai/AGENTS.md . 2>/dev/null; cp ~/Structr.ai/SPRINT-TEMPLATE.md . 2>/dev/null; cp ~/Structr.ai/STRUCTR-COS-ROADMAP.md . 2>/dev/null; echo "Arquivos copiados"
```

---

## BLOCO 4 — Instalar Superpowers (extensão de qualidade)

Copie e cole:

```
curl -fsSL https://raw.githubusercontent.com/earchibald/gemini-superpowers/main/install-superpowers.sh | bash
```

Espere terminar. Depois confirme com:

```
ls ~/.gemini/commands/*.toml 2>/dev/null | wc -l
```

Deve mostrar `14`. Se mostrar `0`, rode o curl de novo.

---

## BLOCO 5 — Instalar Superpowers dentro do projeto (para o Antigravity IDE)

Copie e cole:

```
mkdir -p .agent && git clone https://github.com/anthonylee991/gemini-superpowers-antigravity .agent/superpowers 2>/dev/null && echo "Superpowers instalado no projeto" || echo "Ja existia ou erro - verifique"
```

---

## PRONTO! COMO USAR AGORA

Toda vez que quiser rodar um sprint no Antigravity:

1. Abra o Antigravity
2. Abra a pasta do projeto
3. Cole este texto no chat do Antigravity (troque o numero do sprint):

```
Read GEMINI.md, AGENTS.md, SPRINT-TEMPLATE.md, and STRUCTR-COS-ROADMAP.md.

Execute Sprint 25 — Deal Flow Engine from the COS Roadmap.
Follow SPRINT-TEMPLATE.md exactly.

Requirements:
- /plan first, then /tdd for every function
- Minimum 60 tests
- All endpoints use protectedProcedure
- All mutations call logAudit()
- Phase gates: pnpm check + pnpm test after each phase
- Report results using the completion checklist from AGENTS.md
```

4. Quando terminar, mande os resultados para revisao no Cowork (Claude)

---

## SE DER ERRO

**"command not found: curl"**
Isso nao deveria acontecer no Mac. Tente: `which curl`

**"Permission denied"**
Coloque `sudo` na frente do comando e digite sua senha

**"No such file or directory"**
Voce esta na pasta errada. Volte ao BLOCO 1

**O Antigravity nao le o GEMINI.md**
Feche o Antigravity. Reabra. Abra a pasta do projeto de novo.
