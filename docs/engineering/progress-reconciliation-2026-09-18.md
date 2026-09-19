# Reconciliação das entregas e preparação para uso real

Registro iniciado em 18/09/2026, horário de Charleston. Repositório: [wcvmsilva/structr-ai](https://github.com/wcvmsilva/structr-ai).

## Decisão de entrega

Esta reconciliação reúne trabalho acumulado em uma **branch candidata para revisão**. Ela não libera o sistema para campo. O fluxo de horas e fechamento da equipe foi pausado a pedido do usuário e permanece como desenho e demonstração local, sem integração ao aplicativo.

A branch de trabalho é `codex/agent-progress-reconciliation-20260918`. Sua base principal é `8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf`, consultada no GitHub nesta rodada; a outra linhagem é `fbf7e4cabf8e60ee1d46a13d9d316afee353b451`. A combinação das duas bases não produziu conflitos. Sobre ela foram incorporadas as fontes do candidato de manutenção mais recente, com exemplos públicos fictícios. As pastas originais e suas evidências privadas foram preservadas.

O SHA final, a publicação e a CI devem ser consultados no registro de entrega da PR. Um documento não pode conter seu próprio SHA resultante. Aprovação de uma unidade anterior não equivale a aprovação deste conjunto.

## GitHub observado antes desta reconciliação

| Entrega | Estado verificado | Disposição |
|---|---|---|
| Documentação canônica e revisão de evidências | [PR #12](https://github.com/wcvmsilva/structr-ai/pull/12) e [PR #13](https://github.com/wcvmsilva/structr-ai/pull/13) incorporadas; main `8fa14da3` | Entrega documental publicada; as 48 capacidades não recebem validação operacional automática |
| Roadmap de capacidades dos agentes | [PR #11](https://github.com/wcvmsilva/structr-ai/pull/11) incorporada | Preservado, sem ativar novas integrações |
| Workflow de engenharia, Tasks 1–6 | Branch publicada em `f60cf9a56679d4d7083b2c11ac4e2727d53d84c3`; reconciliação local posterior em `0db4499c` | Encerramentos históricos preservados; estado atual corrigido nesta branch |
| Segurança | [PR #9](https://github.com/wcvmsilva/structr-ai/pull/9) aberta em `b95ea0bf4741646f418fcc99a22d22a42d24be51`, com NO-GO explícito | Continua aberta e não alterada; esta candidata inclui a continuação local, mas não elimina seus bloqueios |
| Padronização PostgreSQL | [PR #1](https://github.com/wcvmsilva/structr-ai/pull/1) aberta em `090da4a0` | README e exemplo de ambiente já descrevem PostgreSQL na base atual; o trecho técnico obsoleto do manual é corrigido aqui. A PR histórica não foi encerrada automaticamente |
| CI de main | [Execução 34517573773](https://github.com/wcvmsilva/structr-ai/actions/runs/34517573773), evento push, sucesso em `8fa14da3` | Evidência da base principal; não certifica a candidata |

Foram inventariadas 26 entradas de worktree, incluindo a criada nesta rodada. Há um registro antigo prunable, não removido. As pastas de reprodução de falhas contêm modificações intencionais de testes; elas não são candidatas de produto e não foram misturadas à entrega. Nenhuma pasta original recebeu reset, limpeza ou substituição.

## Destino do trabalho local

| Origem | Destino na reconciliação |
|---|---|
| Manutenção inicial, 3 fontes | Incorporada pelas entregas seguintes; não reaplicar seu patch |
| Follow-ups C1, 17 fontes | Incorporados por R1–R3; preservados como evidência histórica |
| R1–R3, 27 fontes | Incorporados pelo candidato do piloto; auditoria de exclusão de preset, atomicidade de seed, estado da interface Review e transações de bundle mantidos |
| Piloto P2, 36 fontes | Incorporado pela manutenção de prontidão; preservação de indicadores tributáveis no CSV e laboratório isolado mantidos |
| Manutenção de prontidão, 45 fontes | Fonte mais recente para o conjunto. Manifesto privado SHA-256 `83231805747142eed2453fb5fa64d748b3d931999f918c256a55dbd198f49bce`; publicação usa cópia com fixtures fictícias e validação nova |
| Continuação de segurança até `fbf7e4ca` | História preservada pela combinação das bases; nenhuma revisão histórica foi reatribuída ao conjunto novo |
| Workflow de engenharia | Documentos de governança reconciliados; snapshots antigos continuam históricos |
| C20 / emissão de proposta | Documentos preservados como preparação/proposta; quatro arquivos executáveis preparatórios continuam locais e fora do runtime. Um teste histórico que permitia aprovação genérica foi superado pela recusa atual |
| Playbooks operacionais | Roteiro existente incorporado e apontado por README/todo; implementação futura, depois dos bloqueios |
| Munder | Guia passa a distinguir configuração histórica e missões encerradas; não afirma que agentes ou supervisão estejam ativos |
| Horas e pagamento da equipe | Desenho/demonstração local pausados. Não há domínio integrado, lançamento de horas reais ou pagamento executado |

Os manifests e fontes congeladas anteriores são evidência do que foi testado naquele momento. A anonimização de exemplos modifica hashes; o resultado público é uma nova candidata, não uma alegação de identidade byte a byte com o piloto privado.

## O que pode ser fechado nesta rodada

- Inventário das entregas, identificação da base remota e destino de cada linhagem.
- Reunião do código e da documentação em uma candidata revisável, sem perder as pastas originais.
- Correção das afirmações de estado que ainda diziam não iniciadas unidades já executadas.
- Preservação explícita das decisões pendentes, testes pulados e limites dos laboratórios.

As unidades de manutenção tiveram testes e revisões locais. Isso permite fechar sua preparação e eliminar duplicação de trabalho; não permite marcar como concluída a integração na main ou a validação em campo.

## Bloqueios para uso real

| Prioridade | Bloqueio confirmado nesta candidata | Critério de saída |
|---|---|---|
| 1 | Segurança global e catálogo: G4b continua aberto; Recover de G4b-1 terminou em NO-GO/STOP, inclusive divergência de histórico de migrações | Plano baseado no estado real do ambiente, correções delimitadas e revisão independente. Sem inferir ownership por NULL, nome ou tenant stamp |
| 2 | PDF/JSON: `estimate.exportPdf` e `estimate.exportJson` têm acesso de leitura, mas não repetem a autorização de ciclo de aprovação aplicada na interface | Aplicar e testar a recusa também na API; botão desabilitado não é controle suficiente |
| 3 | Fluxo pelas telas: Review importada mas sem rota `/review`; vínculos cliente/projeto/escopo/orçamento precisam de percurso completo | Demonstrar percurso real com identidade e valores preservados, sem duplicar cliente/projeto |
| 4 | Custos reais: `ProjectActuals.tsx` usa contratos legados `fieldLaunch` e conversão numérica de IDs; domínio `actuals` segue separado | Corrigir o fluxo existente e comprovar UUIDs, autorização, auditoria e conciliação |
| 5 | Política de pais do preview, dependências de catálogo e auditoria durável ainda têm limites documentados | Disposição explícita e provas comportamentais das recusas e falhas; caracterização não conta como correção |
| 6 | Ambiente operacional, recuperação e migrações não foram certificados nesta rodada | Verificar ambiente representativo, backup/restauração, identidade, permissões e migrações antes de dados reais |
| 7 | Candidata ainda requer revisão integrada e decisão de incorporação | Revisão no SHA final e CI; incorporar somente o escopo aprovado; confirmar depois o ambiente efetivamente publicado |

As verificações de Supabase de 17/09 são históricas. Não houve nova inspeção do banco vivo nesta reconciliação, nem migrations, seeds, alteração de permissões ou carga de dados de clientes.

## Evidência e limites

O candidato privado anterior registrou 3.245 testes aprovados, 343 ignorados e zero falhas na execução final, além de TypeScript sem erros. A tentativa anterior teve três timeouts em importações de testes legados; a repetição completa passou com o mesmo código e limites. Esses resultados ficam vinculados ao candidato anterior. Não se transporta esse número para a cópia pública sem executá-la.

O conjunto de 343 testes ignorados inclui laboratórios opt-in e dependências de banco ausente. Uma suíte verde com skips não prova essas integrações. Esta rodada não cria novo domínio ou sprint de funcionalidade, não executa pagamento, não confirma início de obra e não altera escopo comercial.

Nesta cópia pública, a checagem global de tipos e o build passaram; a suíte completa teve **3.246 aprovados, 343 ignorados e zero falhas**, em 83 arquivos aprovados e 10 ignorados. A auditoria estática de tenant terminou com código 0, mas mantém **44 avisos e seis lacunas conhecidas**; seu texto de sucesso não substitui a revisão de segurança. A primeira tentativa de iniciar essa auditoria foi impedida pelo IPC do executor no sandbox; o mesmo script foi executado pelo carregador Node sem esse wrapper. Nenhum achado foi removido.

O registro de validação desta rodada está em [reconciliation-validation-2026-09-18.json](reconciliation-validation-2026-09-18.json). A [situação atual](current-state.md), o [histórico de decisões](decision-correction-log.md) e o [roteiro de playbooks](../planning/PLAYBOOK-EXECUTION-ROADMAP.md) complementam este índice. Conclusão de publicação deve ser confirmada pelo SHA remoto e pela PR, separadamente da prontidão operacional.
