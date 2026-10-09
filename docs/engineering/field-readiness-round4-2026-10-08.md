# Rodada 4: interface coerente e revisão independente

Base: `98b139234a23d147fc41e7d53be4cd857bcc71dc` (PR #39 integrada). Branch
`codex/field-readiness-round4`, com deploy automático desativado. Esta rodada
mantém o cadastro candidato fechado e não libera projetos reais. A autorização
de coordenação inclui Manus, Kimi, Perplexity, Google Gemini e Claude Code.

## Frentes executadas sem sobreposição

Codex é o único integrador/publicador. Os quatro assistentes web receberam
pedidos nas conversas existentes e devolveram análises; Claude Code recebeu um
pacote de sete arquivos rastreados, numerados, da base acima, por sua CLI oficial
já instalada (2.1.241). Sua execução foi somente de análise, sem ferramentas,
MCP, hooks personalizados ou acesso ao navegador. Não foram enviados segredos,
dados reais, arquivos de ambiente ou credenciais aos auxiliares.

| Frente exclusiva | Entrega recebida | Tratamento pelo integrador |
| --- | --- | --- |
| [Manus](https://manus.im/app/78QH93ZwrRaLy9GpVtm8jr) — experiência do operador | Seis mensagens propostas para envio, sucesso, resultado desconhecido, recuperação, saída e troca de conta | Reutiliza os 24 casos anteriores, sem novo ZIP ou execução. Errata distingue saída antes de qualquer envio de possível gravação; descarte de resposta tardia é obrigação da UI. Cache antigo não é bloqueador reaberto desta rodada. |
| [Kimi](https://www.kimi.ai/chat/1a0da05b-ad42-85a8-8000-09e763a0acd7) — estado do formulário | Oito hipóteses com barreiras determinísticas para double-click, edição, troca de identidade, refresh, saída, resposta perdida, replay e reload | Casos futuros, não achados de código. Uma referência pertence a uma tentativa congelada; não se aprova persistência local nova, replay após reload ou garantia de exactly-once sem contrato. |
| [Gemini](https://gemini.google.com/app/8c135063b3caad1c) — integração/autorização | Oito invariantes e errata sobre identidade, fingerprint e momento do decoder | Gate servidor e RBAC prevalecem. Replay exige ator/tenant e bytes exatos; audits legítimos posteriores não invalidam os três audits de criação. Decoder de resposta atua após transporte. Nenhuma aprovação F2/F5 concedida. |
| [Perplexity](https://www.perplexity.ai/computer/tasks/7590945f-aa05-4b83-a186-f57e7be0e7a2) — recuperação | Roteiro documental de oito passos com fontes oficiais e errata | Backup disponível não prova restauração. Abort do cliente não prova commit; ensaio exige barreira controlada e evidência independente. Não presumir endpoint de consulta por chave nem o comportamento do cliente Supabase no transporte real. |
| Claude Code — código do candidato | Revisão estática do encoder, transporte, decoder e três suítes; conclusão bem-sucedida, sem execução de testes | Reprodutores e sugestões são submetidos a triagem contra código, SQL e contrato. Não se altera a semântica de UUID/fingerprint com base em uma hipótese sem SQL. |

Registros locais de prompts, respostas e capturas:
`/private/tmp/structr-field-round4-20261008/`. O resultado original de Claude
Code está em `claude-review/result.json`; `is_error=false`, uma rodada de análise,
sem ferramentas ou permissões negadas. Esses materiais não são aprovação do piloto.

Fontes primárias conferidas diretamente: [backups Supabase](https://supabase.com/docs/guides/platform/backups)
distinguem banco de objetos Storage; [restauração em outro projeto](https://supabase.com/docs/guides/platform/clone-project)
preserva dados Auth, mas exige reconfiguração de serviços e depende do plano/capacidade.
[URLs Vercel](https://vercel.com/docs/deployments/generated-urls) distinguem
implantação específica do alias mutável da branch; [Instant Rollback](https://vercel.com/docs/instant-rollback)
não atende um preview nunca associado a domínio de produção. Nenhum recurso pago,
restauração ou mudança de infraestrutura foi executado a partir da pesquisa.

## Correção concreta da interface

`Intake.tsx` consultava `intake.list` incondicionalmente e mostrava cadastro e
troca de status mesmo quando a homologação recusava essas operações. A tela
passa a usar `auth.session` e o mesmo `currentQueryData` adotado em Home.
Somente um descritor atual explicitamente `estimateReadOnly=false` permite a
lista e os controles. Espera, erro e acesso limitado têm estados visuais próprios;
dados em cache não substituem a confirmação atual.

O backend permanece responsável pela autorização. Esta mudança não abre a
allowlist, não chama o candidato de criação, não altera geocoding nem a jornada
direta existente. A revisão adicional encontrou refetch prematuro por foco e
reconexão, inclusive uma consulta pausada iniciada offline. Somente a listagem
de Intake passa a desativar refetch independente, fila offline e retry automático
(`networkMode: "always"`, `retry: false`). Uma leitura sem conexão falha de forma
visível; a confirmação atual da sessão controla a consulta após reconexão.
Isso não promete cancelar uma requisição já em andamento. Falha na lista não
exibe registros antigos nem afirma que a lista está vazia; o cadastro no modo
direto continua disponível.

## Triagem da revisão Claude Code

A reprodução local confirmou a discrepância entre inspeção por descritores e
acesso posterior ao objeto: um Proxy podia apresentar `notes` benigno na inspeção,
mas entregar NUL ao Zod; outro podia executar `toJSON` durante a serialização.
O alcance demonstrado é um chamador JavaScript no mesmo processo, sem vetor
remoto comprovado. O SQL ainda recusaria NUL antes da escrita. A correção é
produzir um snapshot dos valores inspecionados e utilizá-lo no parse/serialização;
não se promete impedir os próprios traps de reflexão de um Proxy.

O apontamento sobre maiúsculas/minúsculas no UUID foi recusado: o SQL compara
o fingerprint antes do retorno e o transporte classifica a diferença como
`conflict`. UUID em caixa alta com envelope correspondente passa no decoder.
Receber artificialmente o envelope de outro comando deve continuar falhando.
Não se restringe UUID a minúsculas nem se canonicalizam os bytes.

`-0` serializar como `0` reproduz o `JSON.stringify` legado expressamente
preservado no contrato; não foi convertido em nova proibição. A composição futura
entre transporte e decoder deve manter um comando estável durante a tentativa;
essa integração ainda não existe e não foi criada a partir da recomendação.
Nenhuma mudança de assinatura de transporte ou do SQL decorre desta triagem.

Reprodutor isolado: `/private/tmp/structr-round4-claude-triage.ts`, executado
com o engine real. Esse ensaio não é somado à contagem da suíte do produto.

## Evidência focal

| Recorte | RED observado | GREEN final |
| --- | --- | --- |
| Tela limitada | 19 falhas / 6 passes antes da correção | 25/25 na primeira etapa |
| Foco/reconexão de consulta ociosa | 6 falhas novas / 25 passes | 31/31 após a segunda etapa |
| Filtro offline/reconexão e erro de leitura | 4 falhas novas / 32 passes | 36/36 finais |
| Snapshot do comando | 5 falhas novas / 42 passes; dois controles novos já verdes | 90/90 em engine/decoder/transporte, incluindo 7 novos casos |

São **43 novos testes distintos**: 36 de UI/consultas e sete do snapshot. Os
90 casos focais incluem os 83 existentes; os totais intermediários não são somados.
O harness da UI usa markup/callbacks reais e resultados controlados; oito casos
também usam QueryClient/QueryObserver reais, eventos de foco/conectividade e
resposta de sessão retida por uma Promise. Isso não é teste de navegador nem
prova hospedada. SQL/PostgREST não foram alterados ou reexecutados nesta rodada.

## Caminho crítico para liberação

1. **Operador:** concluir as três identidades sintéticas no Auth da homologação.
   A consulta restrita desta rodada retornou zero correspondências para A1/A2/B1.
   A criação/entrada/submissão das novas senhas pertence ao operador, sem compartilhá-las.
2. **Codex:** concluir a via administrativa fora do web para aplicar bootstrap e
   fixture por handle Drizzle verificado. Os helpers já existem, mas o CLI atual
   só oferece `plan`/`validate`; isso é uma lacuna operacional, não evidência de
   aplicação. A via Drizzle usa literalmente `logAudit()`/`db.transaction()` e
   pode avançar independentemente da decisão do cadastro. Um novo renderer SQL
   não herda a exceção histórica do operador/issuer.
3. **Codex + operador:** sessões reais A1/A2/B1, leitura positiva por URL conhecida,
   recusas entre organizações, expiração, troca de identidade e retirada auditada.
   A fixture vazia prova acesso, não cálculo ou formação pelo produto.
4. **Responsável + Codex:** resolver a disposição F2/F5 específica do
   [contrato de cadastro](../security/intake-formation/contract-2026-10-08.md),
   integrar endpoint/UI existentes e comprovar criação/replay hospedados. O SQL
   proposto conserva SHA-256 `135c5200dbcc32b0653d54f17721659dbf34ef2f747666640d28c6b8e49db5a0`.
   A decisão exata continua sem resposta; nenhuma autorização genérica é registrada
   aqui como ratificação desse executor distinto.
5. **Arquitetura + Codex:** contratar e implementar cada operação financeira,
   geocoding, cálculo, aprovação, versão e exportação com sua autoridade e evidência.
   Aprovar a formação não aprova automaticamente os demais writers.
6. **Codex + operador:** jornada completa pelo produto, JSON/PDF comparados com
   a referência independente, inspeção visual, falhas/revogação/recuperação e
   aceite do recorte. Só então decidir uso real.

AGENTS F2 exige **“EVERY mutation calls `withAuditLog()` or `logAudit()`”** e F5
exige **“ALL multi-step DB operations use `db.transaction()`”**. O candidato SQL
autenticado oferece transação/auditoria duráveis, mas não chama esses helpers
TypeScript; essa é a razão concreta da disposição pendente. Não é exigência
adicional inventada pelos auxiliares nem bloqueio para corrigir a interface.

Esta entrega é um incremento de correção e coordenação, não conclusão de sprint
de domínio, de 60 casos novos, nem liberação de campo. Os resultados finais de
verificação local constam abaixo; CI e recibo de publicação acompanham a PR.

## Verificação integrada local

- `pnpm check`: zero erros.
- `pnpm build:vercel`: aprovado; avisos preexistentes de analytics opcional e
  tamanho de chunks permanecem, sem serem descritos como falhas.
- `pnpm test`: **7.380 aprovados, 1.278 opt-in ignorados, zero falhas**;
  214 arquivos aprovados/41 ignorados, 319,34 segundos. Reproduzimos as categorias
  do runner sem somar seu total exibido, que inclui agrupamentos distintos.
- **43 novos testes distintos**, já incluídos na suíte geral; 36 UI e sete engine.
- Revisão independente final dos dois patches: sem P1/P2 restante nesse recorte.
  Revisão estática não é contada como reexecução dos testes.
- Logs: `/private/tmp/structr-field-round4-20261008/{typescript,build,full-suite}.log`;
  RED/GREEN do snapshot em `/private/tmp/structr-round4-proxy-{red,green}.log`.

Arquivos novos: este registro e `server/adr002-intake-limited-ui.test.ts`.
Arquivos modificados: `client/src/pages/Intake.tsx`,
`shared/intake-formation-engine.ts`, `server/adr002-intake-formation-engine.test.ts`,
`vercel.json` e o registro principal de coordenação. Novas tabelas, endpoints,
helpers de banco e migrations: **zero**. Nenhuma mutation de negócio nova;
proteção e auditoria dos endpoints existentes não foram alteradas. O helper
privado `jsonData` agora retorna um snapshot; a assinatura pública não muda.

Os commits separam configuração de publicação, snapshot do comando, interface e
coordenação. O hook obrigatório de envio continua executando tipos e suíte completa.
O envio ao GitHub não ativa produção. A publicação de homologação deve usar a
branch existente `codex/structr-homolog-access-proof`, preservar a proteção e
comprovar o estado visual na URL habitual; READY sozinho não prova acesso ou uso real.
