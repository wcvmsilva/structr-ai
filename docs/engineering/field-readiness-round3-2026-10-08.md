# Rodada 3: cadastro, isolamento e entrega da página

Base: `5dbec8a641cba68b8e56350ead3ce99576ed6d94` (PR #38). Branch `codex/field-readiness-round3`, com deploy automático desativado. **Uso real não liberado.** A rodada não reabre o verificador V4 nem a revisão histórica da PR #17.

## Coordenação executada

Os pedidos a Manus, Kimi, Perplexity e Google Gemini foram enviados nas conversas existentes e as respostas recebidas. Codex mantém implementação, revisão, testes e publicação. Nenhum auxiliar externo recebeu credenciais, dados reais ou autorização para alterar produto/infraestrutura. VS Code continua excluído. Não houve novo despacho ao Munder; o pedido financeiro anterior não é contado como entrega.

| Frente exclusiva | Entrega recebida | Decisão do integrador |
| --- | --- | --- |
| [Manus](https://manus.im/app/78QH93ZwrRaLy9GpVtm8jr) — aceitação operacional | Seis extensões propostas para sucesso, resposta perdida, repetição, cancelamento, reload e troca de conta | Apoio documental, preservando os 24 casos anteriores sem contagem duplicada. Cancelar a tela não desfaz gravação. Auditorias são evidência técnica separada; não se promete mostrá-las no recibo do operador. |
| [Kimi](https://www.kimi.ai/chat/1a0da05b-ad42-85a8-8000-09e763a0acd7) — concorrência/replay | Oito hipóteses e errata solicitada para C02–C05 | A primeira resposta alterava os oráculos de fingerprint/casing. Errata recebida: bytes distintos conflitam, a PK continua global e audits de edição não entram na contagem de criação. |
| [Perplexity](https://www.perplexity.ai/computer/tasks/7590945f-aa05-4b83-a186-f57e7be0e7a2) — HTML antigo/cache | Pesquisa pública com fontes oficiais, distinguindo documentação, inferência e ensaio | Política aplicada a Express local e CDN separadamente. Não identifica a camada culpada nem prova correção hospedada. Sem bypass ou purga global. |
| [Google Gemini](https://gemini.google.com/app/8c135063b3caad1c) — segurança do cadastro | Oito obrigações e errata para RBAC, preimage, rawPayload, lookup e triggers diferidas | Mantida a regra tri-state existente, sem exigir `client:write` universal. Parser e hash não autorizam identidade. Revisão abstrata, sem inspeção do código ou aprovação. |

Uma hipótese externa só conta como prova depois de teste aplicável executado pelo integrador. A paridade de UUID usa o Zod instalado, não generalizações dos auxiliares.

## Correção da entrega do HTML

O middleware estático servia `/` e `/index.html` antes do fallback que já usava `no-store`. O candidato aplica `Cache-Control: no-store` ao HTML estático e às duas rotas no `vercel.json`; JavaScript/CSS mantêm a política anterior. Testes do servidor local cobrem GET/HEAD, query, acesso direto e SPA. Testes de configuração não simulam o CDN.

Fontes conferidas: [Express na Vercel](https://vercel.com/docs/frameworks/backend/express) separa `public/**` do middleware; [`headers.source`](https://vercel.com/docs/project-configuration/vercel-json#headers) corresponde ao pathname sem query; a [chave de cache](https://vercel.com/docs/caching/cdn-cache/purge#cache-keys) inclui o deployment e ignora query de estáticos. [Cache-Control](https://vercel.com/docs/caching/cache-control-headers) distingue navegador e CDN. A mudança é prospectiva. O checkpoint hospedado abaixo registra reload sem parâmetro; não se afirma remoção retroativa de HTML já armazenado nem inspeção dos headers reais do CDN.

## Cadastro candidato, ainda fechado no produto

`shared/intake-formation-engine.ts` extrai o schema existente sem mudar ordem/normalização. O encoder preserva `JSON.stringify({...entradaValidada,tenantId,userId})`, com limites de bytes/profundidade e recusa de JSON que perderia informação. O decoder exige oito colunas, identidade e fingerprint correspondentes; replay retorna o intake atual. O transporte admite até três tentativas integrais apenas para `40001`/`40P01`, sem repetir conflito lógico ou falha de rede ambígua.

A SQL em `docs/security/intake-formation/0018_authenticated_intake_formation.candidate.sql` é **candidata local, fora do journal**. Os testes usam PostgreSQL/PostgREST isolados e tokens sintéticos assinados. Nenhuma migration 0018 foi aplicada na homologação, nenhuma rota nova foi criada e a allowlist continua negando mutations. Esta fatia não integra UI, cálculo financeiro ou geocoding.

Antes da ativação é necessário reconciliar as regras literais do [AGENTS.md](../../AGENTS.md): F2, **“EVERY mutation calls `withAuditLog()` or `logAudit()`”**, e F5, **“ALL multi-step DB operations use `db.transaction()`”**. O candidato SQL propõe três audits e gravação em uma única transação autenticada, mas não chama os helpers TypeScript. Este documento não concede a exceção. O contrato financeiro permanece separado.

## Preparação administrativa das provas de acesso

O candidato `scripts/homolog-read-proof.ts` cria quatro linhas sintéticas: cliente, projeto, draft sem decisão e membership viewer. Vincula-as ao manifesto auditado das identidades A1/A2/B1. A retirada desativa somente os três perfis e duas organizações sintéticas, preservando operador, issuer, objetos e história. Usa literalmente `db.transaction()` e `logAudit()`, verifica readback/audits/replay e recusa drift.

O CLI só aceita `plan`/`validate`, sem conexão ou aplicação. O executor exige handle administrativo verificado separadamente. O conector SQL não transforma este candidato TypeScript em uma via automática de aplicação. Identidades Auth, sessões reais e prova A1/A2 positiva versus B1 negativa ainda não foram produzidas nesta rodada. O seed local não foi executado no provedor hospedado.

## Evidência e sequência de liberação

Validação integrada concluída em 8 de outubro de 2026, antes da publicação:

| Verificação | Resultado e limite |
| --- | --- |
| `pnpm check` | Zero erros. A primeira execução encontrou união de tipos ampliada no mapper de erros da revisão; whitelist nominal corrigida e revisão independente concluída. |
| `pnpm build:vercel` | Aprovado. Avisos de analytics opcional e tamanho de chunks preservados. |
| `pnpm test` | 7.337 aprovados, 1.278 opt-in ignorados, zero falhas; 213 arquivos aprovados e 41 ignorados. |
| Cadastro: encoder, transporte e decoder | 83/83 aprovados; incluídos na suíte padrão. |
| Cadastro: PostgreSQL/PostgREST físicos | 87/87 aprovados (67 comportamento e 20 ciclo da migration candidata); opt-in executado separadamente. |
| Preparação administrativa | 77/77 distintos: 30 offline incluídos na suíte padrão e 47 físicos separados; TypeScript estrito específico também aprovado. |
| Cache e empacotamento | 43/43 focais, com 19 casos novos; incluídos na suíte padrão. |
| Compatibilidade de erros da revisão | 19/19 focais, com três casos novos para códigos de outra operação; incluídos na suíte padrão. Esses três testes protegem comportamento já correto, não são alegados como RED funcional. |

São **269 casos novos distintos**: 135 na suíte padrão e 134 físicos separados. Reexecuções e sobreposições dos grupos focais não são somadas. O total geral exibido pelo runner não é usado para somar essas categorias; os números de aprovados/ignorados acima reproduzem sua saída. Não houve falha final. Logs integrados locais: `/private/tmp/structr-field-round3-20261008/{typescript-final,build,full-suite}.log`. REDs/GREENs físicos estão relacionados nos contratos dos candidatos.

Revisão independente final: sem achados pendentes nos patches de cache, no executor administrativo, no SQL congelado ou na classificação de erros da revisão. Foram corrigidos antes desse parecer: readback/auditorias adulterados por triggers, metadados de recibos, PK diferível, JSON que perderia propriedades e número que produziria Infinity no consumidor.

Artefatos executáveis revisados: SQL candidato SHA-256 `135c5200dbcc32b0653d54f17721659dbf34ef2f747666640d28c6b8e49db5a0`; executor administrativo SHA-256 `7e431d2b8e3647c3fe6e02483dab538bea52bd5fb8c1c5c18024424ef8891da9`. A documentação e os testes não ativam esses artefatos remotamente.

### Relatório do recorte local

- Novas tabelas: zero. Migrações registradas/aplicadas remotamente: zero. Novos endpoints tRPC: zero; o router existente conserva Zod e proteção, e a allowlist hospedada continua fechada para mutations.
- Motor puro: `createIntakeSchema`, `serializeIntakeFormationPreimage` e validação de JSON/identidade. Nenhuma dependência de banco ou cálculo financeiro novo.
- Transporte/decoder: `callAuthenticatedIntakeCreate` e `decodeAuthenticatedIntakeCreate`, ainda sem despacho pelo router.
- Helpers administrativos: parse/planejamento, `provisionHomologReadProof` e `withdrawHomologReadProof`; gravações com `db.transaction()` e `logAudit()` reais. Nenhuma aplicação hospedada.
- SQL candidato: auditoria atômica testada, mas reconciliação literal F2/F5 ainda pendente conforme seção anterior. Portanto **não é conclusão de sprint de escrita ou liberação do piloto**.
- Arquivos criados: `shared/intake-formation-engine.ts`; `server/authenticated-intake-create.ts`; cinco suítes `server/adr002-intake-formation-*.test.ts`; `server/test-support/adr002-intake-formation-fixtures.ts`; `scripts/homolog-read-proof.ts` e `.md`; duas suítes `server/homolog-read-proof*.test.ts`; SQL/contrato em `docs/security/intake-formation/`; este registro.
- Arquivos modificados: `server/_core/hosted-app.ts`; `server/hosted-entrypoint.test.ts`; `server/hosted-packaging.test.ts`; `server/vercel-headers.test.ts`; `vercel.json`; `shared/domain/taxonomy.ts`; `server/authenticated-data-api.ts`; `server/intake-router.ts`; `server/estimate-router.ts`; `server/adr002-review-router.test.ts`; `server/test-support/adr002-postgrest.ts`; registro principal de coordenação.

### Publicação e prova da página

[PR #39](https://github.com/wcvmsilva/structr-ai/pull/39), base `5dbec8a6`, candidato inicial `bc38e584`. Os commits separam cache, contrato de cadastro, fixture administrativa e coordenação. O estado de revisão/integração e os recibos finais de CI ficam vinculados nessa PR; nenhum merge deve ocorrer com CI pendente ou falho.

O primeiro [CI Linux](https://github.com/wcvmsilva/structr-ai/actions/runs/37869656578) aprovou tipos, mas encontrou cinco falhas de preparação em `homolog-read-proof.test.ts`: `/private/tmp` não existe no Ubuntu. O helper do teste passou a usar `join(tmpdir(), ...)`; os mesmos 30 testes passaram localmente após a correção, sem alterar o executor, acrescentar casos ou mudar o produto. O log inicial foi preservado. Os hooks obrigatórios de envio continuam executando tipos e suíte completa. A revisão automática adicional do GitHub informou limite de uso; não se conta esse aviso como revisão ou aprovação.

Publicação de homologação `b36e399372b43975b3e7c383cdc0c0cdcbf587da`, com os dois pais preservados e árvore `752669d092fa3c31c654335e84bdfa1f622ed126`, idêntica ao candidato inicial. [Preview](https://structr-dc9e09xgm-wcvmsilvas-projects.vercel.app) `dpl_HcuibB4gLRcsiteFp48wZqCNy16b` confirmado **READY** pelo provedor, associado ao [alias habitual](https://structr-ai-git-codex-structr-homolog-9f3017-wcvmsilvas-projects.vercel.app/). A correção de portabilidade posterior é somente de teste; os arquivos executáveis do aplicativo desse preview são os revisados.

Na aba preexistente sem query, o DOM inicialmente exibia o painel antigo (`index-C7PUaoTk.js`). **Antes de esta publicação**, um reload normal já trouxe `index-BUxYmMS8.js` e “Limited access”. Após READY, novo reload no mesmo alias sem query terminou com a mesma interface correta e preservou a sessão. Isso comprova renderização normal nesse navegador, sem provar qual cache originou o estado antigo ou atribuir sua correção causal ao novo header. Não foi usado parâmetro de versão, purga, bypass, login administrativo ou nova credencial. Capturas locais: `homolog-root-before.png`, `homolog-root-baseline-reload.png` e `homolog-root-ready.png` em `/private/tmp/structr-field-round3-20261008/`.

Nenhuma operação hospedada de negócio, migration ou Auth foi executada por este checkpoint. As três contas sintéticas ainda dependem da criação de credenciais pelo próprio operador; o formulário foi preparado e entregue a ele. A decisão específica F2/F5 foi solicitada com o contrato e hash SQL acima, sem presumir resposta. Produção e uso real continuam fechados.

1. Preparar identidades sintéticas e executar prova hospedada das leituras mínimas, separada do operador.
2. Resolver F2/F5 para o cadastro, revisar seus bytes finais e integrar endpoint/UI existentes com proteção contra resposta atrasada e resultado desconhecido.
3. Comprovar criação pelo produto; avançar para cálculo com autoridade, aprovação, versão, exportação, recuperação e aceite operacional. Fixture administrativa não substitui a jornada.
