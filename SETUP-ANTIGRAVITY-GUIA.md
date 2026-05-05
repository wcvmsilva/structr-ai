# Como Configurar o Antigravity para o Structr.ai

Guia passo a passo. Se você nunca fez isso antes, siga cada passo na ordem.
Não pule nenhum. Se algo der erro, pare e leia a mensagem de erro antes de continuar.

---

## O QUE VOCE VAI FAZER

1. Instalar o Superpowers (extensão que ensina o Antigravity a trabalhar com disciplina)
2. Colocar 3 arquivos no repositório (regras do projeto, template de sprint, roadmap)
3. Configurar o Antigravity para ler esses arquivos automaticamente
4. Testar se tudo está funcionando

Tempo estimado: 15-20 minutos.

---

## PASSO 1: Abra o Terminal do seu Mac

1. Aperte `Cmd + Espaço` (abre o Spotlight)
2. Digite `Terminal`
3. Aperte `Enter`

Uma janela preta (ou branca) vai abrir. É aqui que você vai digitar os comandos.

---

## PASSO 2: Verifique se o Antigravity está instalado

No Terminal, digite:

```bash
which antigravity
```

Se aparecer algo como `/usr/local/bin/antigravity` → está instalado. Vá para o Passo 3.

Se aparecer "not found" → você precisa instalar. Vá para:
- https://antigravity.google/download
- Baixe a versão para Mac
- Abra o arquivo baixado e siga as instruções de instalação
- Depois volte aqui e tente o comando de novo

---

## PASSO 3: Verifique se o Gemini CLI está instalado

No Terminal, digite:

```bash
gemini --version
```

Se aparecer um número de versão → está instalado. Vá para o Passo 4.

Se aparecer "not found" → instale com:

```bash
npm install -g @google/gemini-cli
```

Se der erro de permissão, tente:

```bash
sudo npm install -g @google/gemini-cli
```

(vai pedir sua senha do Mac — é normal, a senha não aparece enquanto você digita)

---

## PASSO 4: Instale o Superpowers

O Superpowers é uma extensão que adiciona 14 comandos ao Antigravity. Ele ensina o agente
a planejar antes de codar, testar antes de implementar, e revisar antes de avançar.

No Terminal, copie e cole este comando inteiro:

```bash
curl -fsSL https://raw.githubusercontent.com/earchibald/gemini-superpowers/main/install-superpowers.sh | bash
```

Espere terminar. Você deve ver uma mensagem confirmando que os skills foram instalados.

Para verificar que funcionou, digite:

```bash
ls -1 ~/.gemini/commands/*.toml | wc -l
```

Deve mostrar o número `14`. Se mostrar 14, está certo. Se mostrar 0, tente rodar
o instalador de novo.

---

## PASSO 5: Navegue até a pasta do projeto

No Terminal, digite:

```bash
cd ~/Structr.ai/Structr.ai-clone/structr-ai
```

Para confirmar que está na pasta certa, digite:

```bash
ls package.json
```

Deve mostrar `package.json`. Se mostrar "No such file", a pasta está errada.
Tente encontrar onde o projeto está com:

```bash
find ~ -name "structr-ai" -type d 2>/dev/null
```

E use o caminho que aparecer.

---

## PASSO 6: Verifique que os 3 arquivos de configuração existem

Os arquivos que criamos juntos devem estar na pasta do projeto.
Verifique cada um:

```bash
ls -la AGENTS.md SPRINT-TEMPLATE.md STRUCTR-COS-ROADMAP.md
```

Se os 3 aparecerem → ótimo, vá para o Passo 7.

Se algum estiver faltando, você precisa copiar da pasta Structr.ai:

```bash
cp ~/Structr.ai/AGENTS.md ./AGENTS.md
cp ~/Structr.ai/SPRINT-TEMPLATE.md ./SPRINT-TEMPLATE.md
cp ~/Structr.ai/STRUCTR-COS-ROADMAP.md ./STRUCTR-COS-ROADMAP.md
```

---

## PASSO 7: Crie o arquivo de instruções do Antigravity

O Antigravity lê automaticamente um arquivo chamado `GEMINI.md` na raiz do projeto.
É como o "manual de regras" que o agente segue. Vamos criar esse arquivo.

No Terminal, copie e cole este bloco inteiro (do `cat` até o `EOF`):

```bash
cat > GEMINI.md << 'EOF'
# Structr.ai — Antigravity Agent Instructions

## BEFORE ANYTHING ELSE
1. Read `AGENTS.md` — contains ALL project rules, architecture patterns, and quality standards
2. Read `SPRINT-TEMPLATE.md` — the exact structure every sprint must follow
3. Read `STRUCTR-COS-ROADMAP.md` — the full roadmap with sprint specs

## MANDATORY WORKFLOW
For every development task, follow this order:

1. `/plan` — Create a detailed implementation plan BEFORE writing any code
2. `/tdd` — Write tests FIRST, then implement (RED → GREEN → REFACTOR)
3. `/execute` — Execute the plan step by step, running tests after each micro-task
4. `/review` — Review the code before declaring the phase complete
5. `/verify` — Run full verification (pnpm check + pnpm test) before advancing

## QUALITY GATES (from AGENTS.md)
- Minimum 60 tests per sprint (20 engine + 20 DB + 15 router + 5 integration)
- NEVER write existence-only tests (testing that a function exists is not a real test)
- ALL endpoints must use protectedProcedure (never publicProcedure)
- ALL mutations must call logAudit()
- ALL enum inputs must be normalized at router boundaries
- Run pnpm check (0 errors) and pnpm test (0 failures) after EVERY phase

## ARCHITECTURE PATTERN
```
shared/[domain]-engine.ts     → Pure functions, zero DB, zero side effects
server/[domain]-db.ts          → DB helpers with audit logging
server/[domain]-router.ts      → tRPC procedures with Zod + RBAC
client/src/pages/[Domain].tsx  → React page with tRPC hooks
```

## COMPLETION CHECKLIST
Before declaring any sprint done, verify ALL items in the checklist at
the bottom of AGENTS.md. Paste evidence (test output, TypeScript check).
EOF
```

Para verificar que o arquivo foi criado, digite:

```bash
head -5 GEMINI.md
```

Deve mostrar as primeiras linhas do arquivo.

---

## PASSO 8: Instale também o Superpowers diretamente no Antigravity (IDE)

Se você usa o Antigravity como IDE (não só Gemini CLI):

1. Abra o Antigravity
2. Abra a pasta do projeto (File → Open Folder → selecione `structr-ai`)
3. No chat do Antigravity, crie a pasta `.agent` se ela não existir:

```bash
mkdir -p .agent
```

4. Depois, clone o framework de superpowers para dentro dela:

```bash
git clone https://github.com/anthonylee991/gemini-superpowers-antigravity .agent/superpowers
```

5. No chat do Antigravity, digite:

```
/superpowers-reload
```

Se aparecer uma mensagem confirmando que workflows e skills foram carregados, está funcionando.

---

## PASSO 9: Teste tudo

Agora vamos testar se o Antigravity está configurado corretamente.

1. Abra o Antigravity na pasta do projeto
2. No chat, digite:

```
Read GEMINI.md, AGENTS.md, and SPRINT-TEMPLATE.md.
Then tell me: how many tests per sprint are required?
What procedure type must ALL router endpoints use?
```

O Antigravity deve responder:
- "Minimum 60 tests per sprint"
- "protectedProcedure"

Se ele responder isso, a configuração está correta.

---

## PASSO 10: Como enviar um Sprint para execução

Agora que está tudo configurado, toda vez que quiser rodar um sprint, o processo é:

1. Abra o Antigravity na pasta do projeto
2. Cole este prompt (adaptando o número do sprint):

```
Read AGENTS.md, SPRINT-TEMPLATE.md, and STRUCTR-COS-ROADMAP.md.

Execute Sprint 25 — Deal Flow Engine, following the spec in the COS Roadmap.
Use SPRINT-TEMPLATE.md as the exact structure for the sprint.

Requirements:
- /plan first, then /tdd for every function
- Minimum 60 tests (20 engine + 20 DB + 15 router + 5 integration)
- All endpoints use protectedProcedure
- All mutations call logAudit()
- Phase gates: pnpm check + pnpm test after each phase
- Report results using the completion checklist from AGENTS.md
```

3. Deixe o Antigravity trabalhar
4. Quando terminar, ele vai reportar os resultados
5. Copie os resultados e mande para revisão no Cowork (eu)

---

## RESUMO DOS ARQUIVOS

| Arquivo | O que faz | Onde fica |
|---------|-----------|----------|
| `GEMINI.md` | Instruções automáticas que o Antigravity lê ao abrir o projeto | Raiz do projeto |
| `AGENTS.md` | Regras completas do projeto (arquitetura, testes, segurança) | Raiz do projeto |
| `SPRINT-TEMPLATE.md` | Template de como cada sprint deve ser executado | Raiz do projeto |
| `STRUCTR-COS-ROADMAP.md` | Roadmap completo com specs de cada sprint (24-34) | Raiz do projeto |
| `.agent/superpowers/` | Framework Superpowers (se usando Antigravity IDE) | Pasta oculta |
| `~/.gemini/commands/` | Comandos do Superpowers (se usando Gemini CLI) | Pasta home |

---

## SE ALGO DER ERRADO

**"Command not found" ao rodar gemini:**
→ Instale o Gemini CLI: `npm install -g @google/gemini-cli`

**Superpowers não aparece após instalar:**
→ Feche e abra o Terminal novamente
→ Rode o instalador de novo

**Antigravity não lê o GEMINI.md:**
→ Verifique que o arquivo está na RAIZ do projeto (mesma pasta do package.json)
→ Feche e reabra o Antigravity

**Testes falham após uma mudança:**
→ NÃO tente adivinhar. Leia a mensagem de erro completa.
→ Se não entender, copie a mensagem e mande para revisão.

**O Antigravity trava ou fica muito lento:**
→ Isso é um problema conhecido do Antigravity em preview.
→ Salve o progresso, feche, reabra, e peça para continuar de onde parou.
