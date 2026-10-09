# Prova hospedada de acesso ao projeto — 9 de outubro de 2026

## Recorte e estado

A PR #42 foi integrada à `main` em `de6b4f3f43f12fb9f59862420037e5c5b02aeba1`.
O bootstrap hospedado criou duas organizações e três perfis sintéticos, com
seis auditorias e replay sem duplicação. As três contas A1/A2/B1 passaram login
real e resolução do perfil protegido; a duração observada dos tokens foi 600
segundos. [Recibo dos três acessos](https://github.com/wcvmsilva/structr-ai/pull/42#issuecomment-6086295890).
Isso encerra a pendência de senha de A2, mas não prova acesso a dados de negócio.

Este incremento conecta a fixture administrativa já revisada ao executor com
TLS e destino fixos. A execução hospedada e a publicação deste incremento estão
pendentes neste checkpoint. Não há novo domínio, endpoint, migration, grant,
motor financeiro ou alteração do candidato IF-1.

## Responsabilidades e sequência

Codex é o único executor das alterações hospedadas e da integração. Um agente
implementa o runner e seus testes; outro revisa o contrato e prepara a prova
pública de acesso em processo separado. Os pacotes de Manus, Kimi, Gemini,
Perplexity e Claude permanecem insumos das rodadas anteriores; nenhuma nova
execução desses serviços é atribuída a esta rodada.

1. Validar os comandos administrativos com RED/GREEN, banco local descartável,
   tipos, regressão, build e revisão independente; congelar o commit executável.
2. Criar C/P/D/M com o manifesto privado fixo e repetir a mesma operação para
   comprovar ausência de duplicação. Comparar as linhas e auditorias hospedadas.
3. Usar apenas configuração pública e senhas sintéticas no processo de leitura;
   autenticar A1/A2/B1 e chamar os transportes e decoders reais do produto.
4. Retirar a autoridade das três contas no processo administrativo separado;
   repetir as chamadas com os mesmos bearers ainda válidos, antes de logout.
5. Preservar fixture e histórico, verificar replay da retirada e registrar os
   resultados sanitizados. A conta humana O permanece fora dos alvos.

## Critérios observáveis

| Conta | Antes da retirada | Depois, com o mesmo bearer válido |
| --- | --- | --- |
| A1, proprietária em A | Sessão válida, leitura de D e aprovação com estado `none` | Sessão e ambas as leituras recusadas com SQLSTATE `42501` |
| A2, `viewer` de P em A | Mesmas leituras permitidas, sem concessão de escrita | Sessão e ambas as leituras recusadas com SQLSTATE `42501` |
| B1, organização B | Sessão válida; draft `FORBIDDEN`; aprovação `NOT_FOUND` | Sessão e ambas as leituras recusadas com SQLSTATE `42501` |

A fixture contém um cliente, um projeto, um draft vazio sem preço e uma
associação de leitura: quatro linhas e cinco auditorias na criação. A retirada
desativa três perfis e duas organizações, registra seis auditorias e preserva as
quatro linhas de negócio. O manifesto externo identifica o novo executor; o
manifesto de identidade aninhado conserva o commit histórico `8e349d472f5b16494350b1dd26ccc039a9580d21`
e o hash `fa679ae71386e7bf28b2bb5f0640bd70f67fef7c5a43e1ec9e67cd4ccd9cfa18`.

Antes e depois da retirada, `Auth.getUser` e a validade temporal são conferidos
separadamente. A prova não pode usar expiração ou logout para explicar a recusa.
As chamadas de negócio pós-retirada são feitas mesmo quando a sessão já foi
recusada. Senhas, bearers e credenciais SQL não entram nos recibos ou no Git.

## Validação do executor

O RED reproduziu as recusas dos comandos ausentes. Após implementação, passaram
77 testes offline e 17 físicos em PostgreSQL local descartável: 94 casos
distintos, dos quais 32 novos (21 offline e 11 físicos). Os físicos exercitam
criação, replay, retirada, preservação histórica, conflito, drift e rollback
após falha tardia da auditoria. Verificam opções TLS, sem atestar TLS hospedado.
O typecheck explícito do script passou; o `tsconfig` geral exclui `scripts`.
O build Vercel passou. Regressão geral, revisão final e publicação estão pendentes.

Este é um incremento operacional do plano existente, sem declaração de novo
sprint/domínio. Não foram acrescentados testes de existência ou casos artificiais
para preencher a meta de um sprint.

## Limites e próximo gate

Esta prova cobre duas projeções de leitura de um draft vinculado a um projeto
conhecido. Não cobre listagem, todos os endpoints ou a jornada completa. O draft
vazio não é orçamento calculado nem referência financeira independente. O
executor administrativo mantém `authVerified:false`; somente a prova pública
separada pode atestar as sessões reais.

O cadastro IF-1 permanece fechado. Depois deste gate, a próxima entrega é sua
integração hospedada restrita, seguida de aprovação, versionamento, exportação,
comparação com a referência financeira e recuperação operacional. A liberação
para projetos reais continua pendente.
