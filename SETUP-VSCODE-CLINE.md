# Setup: VS Code + Cline como Executor do Structr.ai

## Passo 1 — Abrir o projeto no VS Code

Se você ainda não tem o VS Code instalado:
- Baixe em https://code.visualstudio.com
- Instale e abra

No terminal do VS Code (ou no Terminal do Mac):
```bash
code ~/Structr.ai/Structr.ai-clone/structr-ai
```

Isso abre o projeto inteiro no VS Code.

---

## Passo 2 — Instalar a extensão Cline

1. No VS Code, clique no ícone de extensões (barra lateral esquerda, parece 4 quadradinhos)
2. Na barra de busca, digite: **Cline**
3. Instale a extensão **"Cline"** (por saoudrizwan)
4. Após instalar, o ícone do Cline aparece na barra lateral esquerda

---

## Passo 3 — Configurar o Cline com API Key

O Cline precisa de uma API key para funcionar. Recomendo usar Claude (Anthropic):

1. Acesse https://console.anthropic.com
2. Crie uma API key (ou use uma existente)
3. No VS Code, clique no ícone do Cline
4. Vá em Settings (engrenagem)
5. Selecione **Anthropic** como provider
6. Cole sua API key
7. Selecione o modelo: **claude-sonnet-4-20250514** (melhor custo-benefício para código)

**Alternativa gratuita:** Se não quiser pagar API, pode usar o GitHub Copilot (gratuito para uso pessoal) — mas o Cline com Claude é muito mais poderoso para nosso workflow de sprints.

---

## Passo 4 — Configurar contexto do projeto

O Cline lê automaticamente os arquivos do projeto. Para garantir que ele sempre siga nossas regras:

1. No VS Code, verifique que estes arquivos existem na raiz do projeto:
   - `AGENTS.md` — regras do projeto
   - `SPRINT-TEMPLATE.md` — estrutura de sprint

2. O Cline vai ler esses arquivos quando você pedir.

---

## Passo 5 — Testar com o micro-prompt

Abra o Cline (ícone na barra lateral) e cole o conteúdo do arquivo `CLINE-FIX-SPRINT26.md` que está na pasta Structr.ai.

Observe como o Cline:
- Lê os arquivos mencionados
- Propõe mudanças (mostra diff)
- Pede sua aprovação antes de salvar
- Roda testes no terminal integrado

Você tem controle total sobre cada mudança.

---

## Dicas de uso

- **Aprovar mudanças:** O Cline mostra cada edit antes de aplicar. Clique "Accept" ou "Reject".
- **Terminal:** O Cline pode rodar comandos (`pnpm test`, `pnpm check`). Ele pede permissão.
- **Contexto:** Se o Cline perder contexto, diga "Read AGENTS.md and SPRINT-TEMPLATE.md first"
- **Custo:** Com claude-sonnet, cada sprint custa aproximadamente $2-5 em API calls
