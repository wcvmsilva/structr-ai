# Acesso sintético e integração do cadastro — rodada 6, 9 de outubro de 2026

Base: `0696f8aaae194356a6d76ab458587479a97f896f` (PR #41). Codex coordena,
implementa/revisa e integra; a autorização do responsável para avançar e integrar
alterações validadas permanece vigente. Esta rodada implementa o próximo recorte
com habilitação fechada por padrão. Não equivale à liberação para projetos reais.

## Entregas e responsabilidades

| Responsável | Entrega delimitada e tratamento |
| --- | --- |
| Codex | Executor administrativo Drizzle, interface real com testes, revisão das contribuições, integração e provas locais. Somente o integrador opera ambientes compartilhados. |
| Claude Code | Alteração do endpoint existente, descritor de sessão e gate nominal, em cópia isolada da base, com testes antes da implementação. Não opera Supabase, Vercel ou GitHub. |
| [Gemini](https://gemini.google.com/app/8c135063b3caad1c) | Proposta dos estados de envio, resultado incerto e recibo. Corrigidos pelo integrador: snapshot profundo, identidade antes do reenvio, opções no hook, retorno nullable, unmount e ausência de metadado inventado de erro pré-commit. Código real implementado/testado por Codex. |
| [Kimi](https://www.kimi.ai/chat/1a0da05b-ad42-85a8-8000-09e763a0acd7) | Oito hipóteses adversariais, sem execução. A matriz original inverteu a compatibilidade RBAC e confundiu formação com acesso a projeto existente; essas premissas foram recusadas e corrigidas, não tratadas como achados. |
| [Manus](https://manus.im/app/78QH93ZwrRaLy9GpVtm8jr) | Recibo de aceitação reutilizando casos existentes. Nenhum novo ZIP ou recontagem de testes. Distinguir beneficiário da revogação e executor autorizado; roteiro sanitizado não proíbe prova técnica com sessões legítimas. |
| [Perplexity](https://www.perplexity.ai/computer/tasks/7590945f-aa05-4b83-a186-f57e7be0e7a2) | Consulta pública pontual sobre conexão e TLS. Não recebeu credenciais nem atestou configuração do projeto. Fontes oficiais conferidas pelo integrador. |

Não se reabre IF-1 nem se amplia sua exceção a provisioning. Sugestões dos
assistentes são confrontadas com código e contrato; parecer não substitui teste.

## Recortes implementados

O executor administrativo usa configuração privada explícita, sem carregar
`.env` ou reaproveitar `DATABASE_URL`. Confere o commit e o estado do grafo local
relevante, restringe o destino ao host direto da homologação, mantém verificação
da cadeia TLS/hostname, cria o handle Drizzle e chama o bootstrap existente.
Esse helper conserva `db.transaction()` SERIALIZABLE e seis chamadas duráveis de
`logAudit()`. O executor não cria usuários Auth, projetos, memberships ou dados
comerciais. O preflight é offline: não comprova conexão, sessão ou vínculo.

A integração do cadastro modifica `intake.create`, sem endpoint paralelo.
`STRUCTR_INTAKE_FORMATION_ENABLED` só permite esse mutation quando é exatamente
`true` junto ao modo autenticado da Data API. O ramo usa contexto protegido,
transporte e decoder existentes e termina antes dos helpers diretos e geocoding.
O descritor `intakeFormationEnabled` é apenas apresentação. O banco continua
responsável por validar a autorização atual, inclusive em chamada RPC direta.
O caminho direto conserva sua transação/auditoria/geocoding. Listas e os demais
writers no modo autenticado continuam fechados.

A interface mantém o comando completo e sua chave após possível envio, bloqueia
edição, não renova a chave em falha e não repete automaticamente. Reenvio explícito
usa o mesmo snapshot; pode executar a primeira criação se ela não ocorreu.
Confere ator, tenant e geração antes de enviar e antes de aplicar respostas.
Troca de identidade/unmount descarta o estado; a recuperação não sobrevive a
reload. Resultado incerto não prova rollback. Recibo não inicia scope, cálculo
ou geocoding e não aprova orçamento.

## Estado hospedado e dependência operacional

Leitura do conector nesta rodada confirmou as três contas sintéticas A1/A2/B1
com e-mail confirmado e não excluídas, mas **zero perfis vinculados**. Não houve
escrita hospedada nesta rodada. A conexão local encontrada pertence a outro
projeto e não foi usada, copiada ou exposta. Foi solicitado ao responsável apenas
o caminho de uma configuração administrativa protegida da homologação; nenhuma
senha, token ou URL com credenciais deve ser enviada no chat.

O endpoint direto retornado pelo inventário do projeto resolve em IPv6 e aceitou
conexão TCP nesta máquina. Isso comprova alcance de rede, não handshake TLS,
autenticação SQL, identidade Auth ou execução do bootstrap. A escolha e os limites
seguem a [documentação de conexão Supabase](https://supabase.com/docs/guides/database/connecting-to-postgres)
e [TLS verificado](https://supabase.com/docs/guides/platform/ssl-enforcement).
Não foi composto um hostname de pooler a partir da região, nem desabilitada a
validação de certificado.

O primeiro marco depende de aplicar o bootstrap revisado, executar a fixture
administrativa já existente por handle verificado e comprovar sessões reais,
leitura positiva, recusa entre organizações e retirada de autoridade. O
`scripts/homolog-read-proof.ts` existente cria fixture separada e sua retirada
desativa os perfis/tenants sintéticos; a nova CLI desta rodada aplica apenas o
bootstrap. Não confundir retirar membership com revogar toda autoridade: owner
ou permissão global podem conservar o acesso. A prova específica de membership
exige beneficiário não-owner sem autoridade alternativa.

O candidato SQL IF-1 permanece fora do journal, com SHA-256
`135c5200dbcc32b0653d54f17721659dbf34ef2f747666640d28c6b8e49db5a0`.
Nenhuma migration/grant ou configuração do writer foi aplicada. A branch desta
rodada tem deploy automático desativado; o código não prova implantação.
Aprovação, versionamento, exportação, comparação independente dos valores e
recuperação da jornada ainda são etapas próprias antes da decisão de campo.

## Evidência e conclusão

Registros locais de prompts/respostas, capturas, RED/GREEN e conferências:
`/private/tmp/structr-field-round6-20261009/`. O checkpoint sanitizado não contém
credenciais nem identificadores de sessão. A entrega acrescenta 214 testes distintos: 118 de backend, 34 de UI e 62 do
executor administrativo (56 offline e seis físicos). Os testes da UI usam markup
e callbacks reais com hooks controlados; não são execução de navegador montado.
Os físicos usam o helper/Drizzle/auditoria reais em laboratório próprio,
substituindo apenas a conexão externa; não provam handshake TLS hospedado.

Claude concluiu em cópia isolada e os seis arquivos integrados foram comparados
por hash com sua entrega final. As suítes que exigiam frontend não puderam
carregar no pacote backend e serão cobertas pelo repositório completo. Sua
entrega não executou verificação de tipos; essa etapa pertence ao integrador.
Uma tentativa de gerar arquivo auxiliar fora do escopo e uma tentativa de
compilar isoladamente foram recusadas pela política restrita da própria CLI;
nenhuma dessas recusas impede a verificação integrada do Codex.

A revisão estática independente não identificou P1/P2 no escopo examinado.
O resultado integrado de tipos, regressão completa, build e CI, com os SHAs
publicados, acompanha a PR e seu recibo final; execuções sobrepostas não são
somadas como testes novos.
Não há declaração de conclusão da jornada hospedada ou autorização de uso real.
