# Munder e colaboração dos agentes

Registro reconciliado em 18/09/2026. O Munder é a interface local usada para coordenar tarefas; o repositório, o manifesto de cada entrega e os resultados de revisão são a evidência do produto.

## Trabalho realizado

Michael coordenou as missões delimitadas, Dwight implementou correções, e revisores locais e provedores externos participaram de unidades específicas. Gemini e Kimi concluíram a configuração e produziram respostas de apresentação no fluxo local. As revisões são atribuídas individualmente nos registros de cada candidata; o inventário não concede um parecer coletivo. Essa configuração não prova que todas as tarefas futuras executem sem intervenção, nem atribui a esses agentes revisão de código que não examinaram.

As missões de manutenção e piloto produziram candidatos progressivos. Seus arquivos finais foram reconciliados na [entrega acumulada](engineering/progress-reconciliation-2026-09-18.md), sem reaplicar patches que já continham entregas anteriores. O ciclo acompanhado de cinco horas é histórico e não constitui supervisão ativa nesta publicação.

## Fluxo de coordenação

1. Michael recebe uma tarefa com objetivo, limite, responsável e critério de aceite.
2. Um único agente edita cada conjunto de arquivos em uma worktree dedicada. O editor confirma a base e preserva alterações existentes.
3. O editor entrega fontes, testes executados, limitações e manifesto. O revisor examina a mesma candidata.
4. Pausas por permissão, encerramento de terminal, limite do provedor ou decisão de produto são registradas com sua causa. O estado visual `idle` sozinho não distingue conclusão de bloqueio.
5. A revisão e a decisão de integração são registradas separadamente. Uma tarefa encerrada localmente não vira automaticamente código incorporado, ambiente publicado ou autorização de campo.

Permissões são limitadas aos diretórios e ações da tarefa. Uma configuração individual não é uma autorização geral para shell, acesso fora do projeto, publicação, operação de banco ou pagamento. Aprovações de interface e credenciais permanecem fora do Git.

## Situação preservada

A supervisão recorrente previamente usada foi pausada ao encerrar a missão. Não se afirma que a equipe esteja trabalhando continuamente. Novas integrações como Manus ou Abacus não foram implementadas por esta reconciliação. O desenho de horas e pagamentos também está pausado a pedido do usuário.

O guia local anterior continha caminhos pessoais, IDs de agentes e comandos de instalação ligados a uma versão específica. Esses detalhes permanecem no registro local original. Esta versão pública preserva o processo e o resultado, sem publicar configurações pessoais nem apresentar instruções antigas como estado atual.

## Referências

- [Estado atual](engineering/current-state.md)
- [Histórico de decisões](engineering/decision-correction-log.md)
- [Regras do repositório](../AGENTS.md)
- [Desenvolvimento local](runbook-local.md)
