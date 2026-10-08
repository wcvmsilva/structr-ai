# Rodada 2: formação do projeto e prontidão de campo

Estado em 8 de outubro de 2026: **uso real não liberado**. Base `8b16d20fa8a916aac570a28ac588b701ce859211`. Esta rodada continua a integração; não reabre a revisão histórica da PR #17 nem o verificador offline V4.

## Responsabilidade e entregas

O operador excluiu Codex no VS Code desta rodada e escolheu Munder-Difflin. Codex integrador é o único responsável por alterações no produto, publicação e ambiente. Nenhum auxiliar recebeu credenciais, dados reais ou permissão para alterar infraestrutura nesta rodada.

| Frente | Responsável exclusivo | Resultado observado / próximo aceite |
| --- | --- | --- |
| Produto, formação cliente/projeto/intake, provas de acesso e integração | Codex integrador + agentes locais por arquivo | Mapa das dependências concluído; correção delimitada da Home implementada e revisada. Contrato de formação ainda em preparação. |
| Contrato executável de gravações financeiras | Munder-Difflin: Michael coordena, Jim autor, Gemini interno revisor | Pedido entregue pelo harness às 22:31:45 UTC; início/ACK ainda não observado no checkpoint. Missão `field-readiness-round2-20261008`; somente documentação até ratificação. Não é trabalho concluído nem implementação autorizada. |
| Aceitação operacional | Manus | Delta da jornada entregue e conferido documentalmente; nenhuma jornada executada. |
| Concorrência, replay e falhas | Kimi | Dez hipóteses de teste recebidas; uso seletivo conforme contrato real, sem afirmar execução ou achados no código. |
| Recuperação de dados, preview e e-mail | Perplexity | Checklist público de 12 itens recebido; é pesquisa para os ensaios, não prova de restauração/configuração. |
| Revisão abstrata da autoridade do cálculo | Google Gemini | Resposta recebida, com errata solicitada e recebida. Não inspecionou código e não decide arquitetura. Separada da revisão interna do Munder. |

Não criar trabalho duplicado no antigo chat VS Code. O seu histórico apresentou falha de recuperação. Foi observada uma mensagem automática antiga nesse chat; esse registro não comprova execução nem substitui a coordenação desta rodada.

## Correção delimitada da tela inicial

Quando consultas de negócio falhavam ou estavam bloqueadas pelo modo Data API, a Home convertia dados ausentes em zero e ainda mostrava estados estáticos de conexão, proteção e exportação pronta. A nova apresentação:

- Só habilita as cinco consultas originais após `auth.session` confirmar `estimateReadOnly: false` em uma resposta atual. Dados antigos durante refetch, pausa ou erro não habilitam consultas.
- Mostra acesso limitado quando o ambiente está em modo parcial, sem KPIs nem ações de criação na própria página.
- Distingue carregamento, erro, resposta incompleta e sucesso com listas vazias/contagens zero no modo completo.
- Remove as afirmações estáticas de prontidão e preserva os destinos de navegação no sucesso completo.

Não modifica a autorização do servidor, o descritor de capacidades, a allowlist ou a barra lateral. Essa correção de apresentação não libera módulos nem gravações. A margem de catálogo já retornava zero literal no backend; esta mudança não implementa seu cálculo financeiro.

TDD: 21 casos comportamentais falharam contra a Home original; os mesmos bytes de teste passaram após a correção. TypeScript e build passaram. Revisão independente estática sem bloqueadores no recorte. Os testes exercitam markup, handlers e opções dos hooks com transporte controlado; não provam cancelamento HTTP, identidade real ou jornada hospedada. Regressão geral e publicação são registradas no PR/recibo de integração, não presumidas por estes resultados focais. Esta entrega é uma correção parcial, não conclusão de sprint ou dos gates de campo.

| Arquivo | SHA-256 do candidato revisado |
| --- | --- |
| `client/src/pages/Home.tsx` | `ea149e1d8f740cf1e09cb7abb205b152711182124bfd75b19321425259261aed` |
| `server/field-readiness-home-state.test.ts` | `7b39c024777ef5c3f045c907061a0db191a854d231c82a5acdeae4b5a046188c` |

A branch `codex/field-readiness-round2` tem deploy automático desativado em `vercel.json`. Publicação eventual deve usar exclusivamente a branch de homologação já configurada; produção permanece fora desta rodada.

## Insumos externos e critérios do integrador

**Manus:** [delta da jornada](https://manus.im/app/78QH93ZwrRaLy9GpVtm8jr?previewEventId=sAXh1lZ92GKkFMNVBak0jK&previewSandboxPath=%2Fhome%2Fubuntu%2FStructr_Aceitacao_Operacional_Jornada_Delta_2026-10-08.zip), SHA-256 `164213485c2de0136ac679d7353e81b8e3680f50b0e164e869072d5b1d5aeb81`. Checksum externo, CRC e 7/7 hashes internos conferidos; todos os oito arquivos foram lidos, sem execução de código recebido. Reutiliza os 24 casos operacionais e A/B/C sem contá-los novamente. Preserva os hashes da V2 operacional, V2 financeira e V4. Aceite documental com duas orientações: escolher um objeto já preparado não comprova a criação pelo produto; a prova de formação deve efetivamente criar cliente/projeto/intake pelo endpoint suportado. Após versionar, o filho nasce sem aprovação; para exportar o filho é preciso revisá-lo e aprová-lo novamente. A revogação deve identificar explicitamente a aprovação da versão-alvo. O ZIP original fica preservado.

**Kimi:** [matriz de hipóteses](https://www.kimi.ai/chat/1a0da05b-ad42-85a8-8000-09e763a0acd7?chat_enter_method=history). Aproveitar perda de resposta após commit, concorrência do mesmo requestId, payload divergente, falha de auditoria, ordenamento de revogação, expiração entre fases, linhagem contraditória e resposta atrasada após troca de conta. Correções do integrador: `intake.create(newProject)` já exige replay exato e recusa fingerprint divergente; não aceitar duplicata como resultado alternativo nessa operação. Campos extras de autoridade devem ser rejeitados conforme o contrato nominal, não apenas ignorados genericamente. A primeira transação de exportação atual não persiste um artefato pendente; não assumir órfão ou deduplicação universal. Erro tratado e propagado corretamente não precisa ser uma exceção jamais capturada. Nada dessa matriz conta como teste executado.

**Google Gemini:** [revisão e errata](https://gemini.google.com/app/8c135063b3caad1c). A errata retira exigências infundadas de parsing/conexão internos, FORCE RLS universal, fila e requestId de exportação, e reconhece que GUC não autentica seu emissor. Usar como checklist abstrato, sem aplicar prescrições de ownership/grants sem comparar as capacidades reais. Continua pendente como o banco reconhece cálculo TypeScript confiável fora do processo web. A sugestão de executor ou atestação é proposta, não decisão ratificada.

**Perplexity:** [pesquisa operacional](https://www.perplexity.ai/computer/tasks/7590945f-aa05-4b83-a186-f57e7be0e7a2). A pesquisa distingue documentação, inferência e experimentos. Não comprova o plano contratado, SMTP configurado, entrega de e-mail, cópia do Storage, restore ou retorno do preview. Manter os limites já conferidos em [coordenação](homolog-access-coordination-2026-10-08.md): backup SQL não inclui bytes do Storage; Instant Rollback de produção não é o ensaio desta prévia. Nenhum serviço ou gasto foi contratado a partir da pesquisa.

## Próximo incremento de produto

O menor candidato já existente é `intake.create({requestId,newProject,...})`, que cria cliente, projeto e intake, com três audits, em `db.transaction()`. A integração deve modificar o endpoint existente (F6), validar Zod (S2), manter autoridade de usuário/tenant resolvida sob a fronteira ADR-002 e preservar replay/atomicidade. Não basta ampliar a allowlist.

Com navegação atual, o recorte também precisa de `intake.list`, `project.list` e `scopeGeneration.loadWorkspace`; depois da criação a tela vai ao workspace. Um recibo de criação na própria tela é alternativa menor a ratificar explicitamente. A auto-geocodificação posterior é enriquecimento separado e não produz, por si, a evidência A1 da revisão geográfica explícita.

Contrato de writer SQL, se escolhido, precisa reconciliar expressamente F2/F5 com os helpers literais; a disposição anterior da query `estimate_viewed` não é autorização geral para mutations. O fingerprint legado é SHA-256 de `JSON.stringify({...data,userId})`; `jsonb::text` não é equivalente. Formação não possui projeto prévio: B1 pode criar no próprio tenant e ausência de membership não prova recusa. A política RBAC vigente diferencia ausência de configuração de permissão negada; não alterar isso silenciosamente.

A fatia financeira seguinte exige geocode com evidência, catálogo/cálculo com autoridade demonstrada, persistência do draft, aprovação, emissão, versão e revogação com contratos próprios. Permanecem os motores determinísticos existentes, revalidação após locks e por tentativa/fase, readback e auditoria durável na transação. Exportação não ganha replay universal por conveniência do teste.

## Prova de acesso hospedada ainda necessária

O operador humano permanece separado da tríade sintética A1/A2/B1. A proposta mínima usa duas organizações, três perfis user e um cliente/projeto/draft sem decisão mais um membership viewer. A1 e A2 devem ler; B1 deve ser recusado. Viewer não equivale a ausência de leitura; a revisão de aprovação tem outro gate.

Ainda faltam identidades e sessões reais dessas três contas, o provisionamento/retirada administrativa auditada das quatro linhas e o canal transitório de uso dos bearers. O bootstrap atual cria identidades/organizações, não esses dados de negócio. O seed local que fabrica Auth/JWT/geocode não pode ser executado no provedor hospedado. Essa prova mínima não substitui a criação pelo produto nem comprova cálculo/aprovação/exportação.

A liberação continua condicionada à jornada hospedada completa, isolamento entre organizações, comparação financeira independente, recuperação por e-mail/restauração e aceite operacional com escopo definido. Nenhum pacote documental ou teste local isolado concede essa liberação.
