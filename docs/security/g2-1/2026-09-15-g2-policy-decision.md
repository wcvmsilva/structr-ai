<!-- Incorporação histórica G2-1: corpo original preservado, salvo links de anexos externos. -->
> **Registro histórico do desenho de 2026-09-15.** O estado “proposto/não executado” abaixo descreve a rodada de desenho. A autorização posterior de implementação e os resultados pertencem ao [registro de execução](../g2-1-override-crud-evidence.md); os checkboxes do plano continuam históricos. Esta incorporação não reaprova política, não amplia o escopo e não transfere GO entre SHAs.
>
> Fonte externa aprovada: `/private/tmp/structr-g2-design-20260915/2026-09-15-g2-policy-decision.md`. SHA-256 original: `8fb68231f760fa1c6d378029842287917eb28db1c01c414ac20b91290a85c5d6`. Alterações desta cópia: este enquadramento temporal e resolução dos links de anexos externos, quando existentes. Os anexos continuam locais, fora do repositório; sua disponibilidade depende da preservação do dossiê local.

# G2 — decisão humana sobre regras de tenant e legado NULL

## Decisão observada

Após a entrega do dossiê de medição `g2-scope-candidate.md` (SHA-256 `f8001502b12bcdeadefe8637be79cee3008cd504887c786284cc63293103be54`) e sua revisão independente, foi perguntado ao usuário:

> Para G2, recomendo que cada empresa acesse somente suas próprias regras geográficas, inclusive administradores. Regras antigas sem empresa identificada ficariam indisponíveis, preservadas e pendentes de classificação. Aprova essa política para concluirmos o desenho de G2? Essa decisão muda o tratamento do legado previsto no plano anterior; ainda não inicia implementação ou operações no banco.

O usuário respondeu **“Autorizado”** nesta sessão, em 2026-09-15. Registra-se a resposta depois de ocorrida, sem inventar horário de envio ou aprovações adicionais.

## Efeito preciso

- O desenho G2 usa igualdade estrita entre o tenant confiável do chamador e `geographic_overrides.tenantId`, inclusive em operações administrativas.
- Regras B e de tenant NULL não pertencem ao escopo autorizado de A. NULL não vira tenant, domínio global ou GCHI.
- O legado é preservado: nenhum DELETE de dados, reatribuição, migração, seed, backfill ou classificação de linhas está autorizado.
- O parâmetro global `TENANT_STRICT` e a semântica das outras tabelas não mudam por essa decisão.
- Isso substitui, **para a futura fronteira G2 de regras**, a tolerância de NULL que o plano Class G anterior remetia à separação B2/F15 de G1. Os documentos antigos conservam seu valor histórico.
- Esta decisão não resolve automaticamente ownership dos pais do histórico, referências de assemblies, UUIDs do seed/visualização, contratos de auditoria ou conexões de armazenamento com UI/export.

## Trabalho autorizado nesta rodada

Concluir o desenho e a preparação documental do próximo recorte: contratos, arquivos, critérios de aceitação, provas, sequência, exclusões e revisão independente. Não iniciar implementação, testes, aplicação, banco ou publicação. Os documentos de desenho ficam em `/private/tmp/structr-g2-design-20260915/`, fora da linhagem encerrada G3a-3; sua incorporação ao futuro trabalho G2 depende da autorização dessa etapa.

Base local recuperada: `bf9fbb6bd917ceb207d7bf01ad77704e48ca8b2a`, em `/private/tmp/structr-g3a3-20260915`, checkout limpo, código idêntico ao da medição `29c464931184de02556926fed4486ab93024185f`. O documento G3a-3 local continua não publicado. PR #9 permanece NO-GO; B2 global NOT DEFENSIBLE; Phase 3 não iniciada. Não se transfere nenhum GO anterior para G2.

## Autoridade relacionada

- ADR-001, Geographic Overrides e Invariant 7, no SHA de código medido.
- Plano Class G §3 e handoff §17.1, com as correções posteriores do workflow `f60cf9a56679d4d7083b2c11ac4e2727d53d84c3`.
- Registro canônico e manutenção de evidências em main `8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf`, consultados por seus blobs GitHub exatos na medição anterior; nenhuma alteração de status ou cópia de linhagem.
- Revisão da medição: `/private/tmp/structr-g2-measurement-20260915/independent-measurement-review.md`, SHA-256 `52cb8575f1265b984a766055d214318d0b3af054aace6644c7acd0d25eb1dda2`.

Esta é uma decisão de política para concluir o desenho, não um registro de implementação, execução, publicação, segurança GO ou merge.
