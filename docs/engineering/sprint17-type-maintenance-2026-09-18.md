# Sprint 17 — manutenção delimitada de tipos

## Autorização e base

Unidade A da missão local de 2026-09-18, autorizada separadamente da unidade
UUID já encerrada. Worktree:
`<local-workspace>/munder-workspace/worktrees/structr-maintenance-20260918`.
Branch: `codex/munder-maintenance-20260918`.
HEAD fixo: `fbf7e4cabf8e60ee1d46a13d9d316afee353b451`.
A árvore estava limpa antes da execução, conforme
`tmp/munder-maintenance/baseline-identity.json`.

Fontes: [evidência UUID](../security/workflow-visualization-uuid-round-trip-contract/2026-09-16-evidence.md),
[plano UUID](../security/workflow-visualization-uuid-round-trip-contract/2026-09-16-plan.md)
e [reconciliação G2](../security/g2-family-reconciliation-2026-09-17.md).
A proibição histórica de sanar estes diagnósticos pertencia à unidade UUID;
esta missão autoriza somente sua manutenção separada.

## Plano anterior às alterações do teste

1. Registrar a falha de tipos e executar as quatro suítes focais na base.
2. Adaptar exclusivamente `server/sprint17-workflow-viz.test.ts`: fixtures,
   entradas de helpers, chaves de mapas e expectativas de identidade recebem
   UUIDs estáveis; números de quantidade, ordem e contagem permanecem números.
3. Tipar o mapa auxiliar explicitamente e substituir os dois acessos sem
   tipagem a procedimentos por acesso tipado, exigindo `_def.type === "query"`.
   Remover os casts `as any` existentes e os caminhos alternativos que apenas
   verificavam existência. Preservar os demais testes e asserções.
4. Executar tipos dedicados, tipos da aplicação, quatro suítes focais,
   regressão completa e `git diff --check`, nessa ordem.
5. Capturar patch e hashes SHA-256; encaminhar a Michael para revisão
   independente de Jim neste mesmo worktree. Registrar correções e parecer.

Não há função produtiva nova nem mudança de contrato. O estado vermelho é a
checagem dedicada já falhando antes de qualquer alteração; o Vitest transpila
os testes sem validar seus tipos. Não se exige criar 60 testes para esta
manutenção, que não constitui sprint de domínio novo.

## Ambiente e evidências

Todos os comandos de verificação usam:

```sh
env -i PATH=/usr/local/bin:/usr/bin:/bin NODE_ENV=test CI=1 GIT_OPTIONAL_LOCKS=0 <comando>
```

Logs e metadados de comando, horário e código de saída ficam em
`tmp/munder-maintenance/`, ignorado pelo Git. O `test-tsconfig.json` já preparado
estende o config da aplicação, desativa `incremental`, usa `target: ES2022`,
remove a exclusão de testes e inclui as quatro suítes focais. Não altera o
config versionado, que continua excluindo `**/*.test.ts`.

| Verificação | Resultado observado | Evidência |
|---|---|---|
| Tipos dedicados antes da edição | exit 2; 56 diagnósticos, todos no Sprint 17 | `baseline-test-types.log`, `baseline-test-types.json`, `baseline-diagnostics.json` |
| Quatro suítes focais antes da edição | Inconclusivo: nenhuma saída; execução interrompida, exit 130 | `baseline-focal.log`, `baseline-focal.json` |
| Tipos dedicados após a edição final do teste | exit 0; zero diagnósticos | `final-test-types.log`, `final-test-types.json` |
| Tipos da aplicação | `pnpm check --incremental false`: exit 0; zero diagnósticos | `application-types.log`, `application-types.json` |
| Inventário estático dos testes | 55 declarações antes/depois, mesmos nomes e ordem; nenhum skip ou supressor adicionado | `static-test-inventory.json` |
| Quatro suítes focais após a edição | exit 0; 4 arquivos, 140 testes aprovados via API instalada com `config: false` | `postedit-focal-configfalse.log`, `postedit-focal-configfalse.json` |
| Suíte completa após a edição | exit 0; 75 arquivos aprovados, 9 ignorados; 2.972 testes aprovados, 340 ignorados, zero falhas | `postedit-full-configfalse.log`, `postedit-full-configfalse.json`, `runtime-skips.json` |
| Whitespace do teste rastreado | `git diff --check`: exit 0 | `diff-check.log`, `diff-check.json` |

Distribuição inicial: 47 TS2322, 1 TS2367, 3 TS2769, 3 TS2345 e 2 TS7053.
O total inicial coincide com a dívida histórica documentada. O inventário
estático não prova aprovação; o log focal posterior executou e aprovou os
55 testes do Sprint 17. A regressão completa observou novamente os números
históricos, em execução própria desta missão; não se reutilizou um resultado
antigo como evidência atual.

Comandos da checagem dedicada e da tentativa focal:

```sh
pnpm exec tsc --project tmp/munder-maintenance/test-tsconfig.json --pretty false
pnpm exec vitest run server/workflow-visualization-uuid-contract.test.ts server/sprint17-workflow-viz.test.ts server/tenant-g2-rule-read-callers.test.ts server/tenant-g2-override-log-callers.test.ts --pool=forks --maxWorkers=1 --minWorkers=1
```

As execuções efetivas usam o prefixo sanitizado acima; os JSONs guardam os
argumentos completos. O comando de regressão originalmente previsto era
`pnpm test --pool=forks --maxWorkers=4 --minWorkers=1`. Os resultados finais
foram obtidos pelo helper equivalente autorizado abaixo, e não por esse comando
literal ou por um carregamento bem-sucedido do config versionado.

## Correção aplicada

- UUIDs estáveis distintos para assemblies, templates e regras, usados também
  nas chaves dos mapas, listas de etapas, buscas e expectativas de igualdade.
- `makeAssemblyLookup` recebe IDs string e usa mapa explicitamente tipado pelo
  terceiro parâmetro do motor existente. Isso elimina o mapa interno implícito
  que aceitava chaves incompatíveis com o retorno declarado.
- As duas fixtures de nulabilidade usam os tipos de projeto/rascunho da resposta.
- Os dois testes de tipo de procedimento usam o acesso tipado ao router
  existente e exigem `proc._def.type` igual a `query`, sem alternativas que
  passavam somente por existência. Os dois `as any` anteriores foram removidos.
- Nenhum teste novo, removido ou desativado. Nenhuma coerção para entrada
  inválida foi necessária. Ordem, quantidade, confiança e contagens permanecem
  numéricas; nenhuma asserção comportamental foi enfraquecida.

## Impedimento de execução e disposição

A tentativa focal começou antes da edição do teste e ficou aproximadamente
cinco minutos sem stdout/stderr. Foi interrompida pela sessão executora
(exit 130); não houve resultado de teste. O wrapper inicial foi interrompido
antes de salvar horários exatos, limitação registrada em `baseline-focal.json`.

Diagnóstico limitado, sem alterar configuração, dependência ou permissão:

| Sonda | Observação | Artefato JSON |
|---|---|---|
| `vitest --version` | exit 0; 2.1.9, Node 24.14.0 | `vitest-startup-diagnostic.json` |
| esbuild `--version` | exit 0; 0.21.5 | `esbuild-startup-diagnostic.json` |
| Import de Vite e `loadConfigFromFile` | Import passou; carregamento da configuração excedeu 20 s | `config-startup-diagnostic.json` |
| Serviço esbuild `transform` | exit 0; TypeScript convertido | `esbuild-transform-diagnostic.json` |
| Serviço esbuild `build` | Build de stdin passou; build de `vitest.config.ts` excedeu 20 s | `esbuild-build-diagnostic.json` |

As sondas com timeout encerraram apenas seus próprios grupos de processos.
Elas localizam a falha na etapa de build da configuração, mas **não provam a
causa**: não se atribui o bloqueio a sandbox, cópia de dependências ou Vite sem
evidência. A consulta de processos por `ps` foi negada pelo sandbox; nenhuma
tentativa de contorno foi feita. Nenhum segundo executor de testes foi iniciado.

Michael orientou em `2026-09-18T14-36-11-659Z-d22004` que, persistindo o bloqueio,
as correções autorizadas e verificações estáticas poderiam avançar, mantendo a
tentativa pré-edição como inconclusiva e sem dispensar os testes exigidos.
Foram realizadas as duas sondas distintas de serviço/build; não se repetiu o
comando focal nem se iniciou a suíte completa para reproduzir a mesma espera.

Naquele estágio, a unidade continuava incompleta: somente a redução de 56
para zero diagnósticos havia sido verificada. A recuperação posterior está
registrada abaixo; a linha de base de execução permanece inconclusiva.

### Diagnóstico adicional autorizado pelo humano

A mensagem `vitest-diagnostic-guidance-feeb9ae4`, de 2026-09-18 14:39 UTC,
autorizou testar uma configuração ESM temporária equivalente e, se necessário,
um build com `tsconfigRaw: {}`. O humano informou que o carregamento original
completava no sandbox supervisor; essa observação externa não foi executada
por este worker e não substitui os testes desta missão.

Config fornecida: `/private/tmp/munder-vite-diag-3llc9xoj/vitest.config.mjs`.
Conteúdo exato também preservado, com SHA-256, em
`tmp/munder-maintenance/temporary-config-evidence.json`:

```js
export default {"root": "<local-workspace>/munder-workspace/worktrees/structr-maintenance-20260918", "resolve": {"alias": {"@": "<local-workspace>/munder-workspace/worktrees/structr-maintenance-20260918/client/src", "@shared": "<local-workspace>/munder-workspace/worktrees/structr-maintenance-20260918/shared", "@assets": "<local-workspace>/munder-workspace/worktrees/structr-maintenance-20260918/attached_assets"}}, "test": {"environment": "node", "include": ["server/**/*.test.ts", "server/**/*.spec.ts"]}};
```

A comparação local confirmou os mesmos valores resolvidos de `root`, dos três
aliases, de `test.environment` e dos dois globs `include` do config versionado.
Esse arquivo elimina os imports de `vitest/config` e `path`, mantendo seus
valores resultantes; não altera `vitest.config.ts` nem dependências.

No ambiente sanitizado original, uma chamada a `loadConfigFromFile` apontando
para o arquivo temporário também excedeu 20 s antes de retornar configuração.
O build direto de `vitest.config.ts` com `tsconfigRaw: {}` igualmente excedeu
20 s. Ambos foram encerrados por SIGTERM de seus próprios grupos de processos.
Comandos completos, duração e stdout/stderr constam em
`temporary-config-diagnostic.json` e `esbuild-tsconfigraw-diagnostic.json`.
Não houve execução de suítes com a configuração temporária, pois a condição
prévia de carregamento não passou. A causa continua indeterminada.

## Execução recuperada por API local equivalente

A autorização humana `vitest-configfalse-guidance-c5dfd1f7`, reiterada por
Michael em `2026-09-18T14-41-46-660Z-4f64ed`, permitiu desativar somente o
carregamento do arquivo de config pela API instalada. Os resultados são
**pós-edição**: não houve restauração do arquivo antigo nem reconstrução de
baseline. A tentativa inicial inconclusiva continua preservada.

O helper `tmp/munder-maintenance/run-vitest-configfalse.mjs` tem este conteúdo
integral, usado nas duas execuções:

```js
import { startVitest } from "vitest/node";

const mode = process.argv[2];
if (mode !== "focal" && mode !== "full") throw new Error("Expected focal or full");
const root = "<local-workspace>/munder-workspace/worktrees/structr-maintenance-20260918";
const filters = mode === "focal" ? [
  "server/workflow-visualization-uuid-contract.test.ts",
  "server/sprint17-workflow-viz.test.ts",
  "server/tenant-g2-rule-read-callers.test.ts",
  "server/tenant-g2-override-log-callers.test.ts",
] : [];

await startVitest("test", filters, {
  config: false,
  root,
  run: true,
  environment: "node",
  include: ["server/**/*.test.ts", "server/**/*.spec.ts"],
  pool: "forks",
  maxWorkers: mode === "focal" ? 1 : 4,
  minWorkers: 1,
}, {
  resolve: {
    alias: {
      "@": `${root}/client/src`,
      "@shared": `${root}/shared`,
      "@assets": `${root}/attached_assets`,
    },
  },
});

```

Fonte instalada consultada, sem alteração: Vitest 2.1.9,
`node_modules/.pnpm/vitest@2.1.9_@types+node@24.7.0_lightningcss@1.30.1/node_modules/vitest/dist/chunks/cli-api.DqsSTaIi.js`.
`createVitest` (linha 11450) converte `options.config === false` em
`configFile: false`; `startVitest` (11811) usa os filtros recebidos e fecha o
contexto quando não há watch; `prepareVitest` (11870) transforma `run: true`
em `watch: false`. Assim, o helper mantém root, três aliases, ambiente node,
dois globs de inclusão, quatro filtros focais, pool forks e os limites de
workers dos comandos originais. O modo full usa todos os arquivos dos mesmos
globs, com quatro workers máximos. Não há filtro de teste adicional.

Comandos realmente executados, cada um precedido pelo ambiente sanitizado:

```sh
node tmp/munder-maintenance/run-vitest-configfalse.mjs focal
node tmp/munder-maintenance/run-vitest-configfalse.mjs full
```

O wrapper local `run-bounded.py` gravou argumentos, cwd, início, fim, código de
saída, stdout/stderr e limite de tempo (120 s focal, 180 s completa), encerrando
somente seu próprio grupo em caso de timeout. Ambos terminaram normalmente:
6,708 s e 37,647 s, respectivamente. Nenhum teste foi executado em paralelo
com outra execução de suíte. Logs `postedit-*-configfalse.*` contêm os dados.

A origem da falha no carregamento original continua sem diagnóstico. Esta prova
valida os testes pelo caminho equivalente autorizado; não prova que o comando
CLI original passou, nem fornece uma comparação runtime antes/depois completa.
Não houve modificação de config, ambiente adicional, dependências ou permissões.

### Testes ignorados

Os 340 skips observados dividem-se em 262 testes de nove arquivos integralmente
ignorados e 78 em oito arquivos parcialmente executados. `runtime-skips.json`
lista cada arquivo e contagem extraída do log desta execução.

- Os oito laboratórios PostgreSQL e `count.test.ts` somam 262 casos e dependem
  de flags opt-in ou `DATABASE_URL`, ausentes no ambiente sanitizado.
- `sprint4.test.ts` (18), `bundle.test.ts` (12) e `catalog.test.ts` (9) também
  condicionam seus 39 testes de banco à presença de `DATABASE_URL`.
- Os outros 39 skips já estão explícitos no código: Sprint 18.5 (24), Sprint 19
  (9) e Sprint 20 (2) registram normalização/índices pendentes ou artefatos
  removidos na migração PostgreSQL; Sprint 24 (3) conserva testes da função
  movida de módulo; Sprint 26 (1) registra qualificação ainda não implementada.

Nenhum skip foi criado pela manutenção. O log de `env.test.ts` confirma
`DATABASE_URL` indefinida. Nenhum caso ignorado é contado como aprovação,
e não se executou banco real. Avisos de OAuth sem configuração e mensagens de
cenários negativos permanecem nos logs; o runner encerrou com zero falhas.

### Whitespace e vínculo da revisão

O teste rastreado passou em `git diff --check`. Para o documento novo, o
manifesto atualizado registra integralmente este comando, com o mesmo cwd e
ambiente sanitizado:

```sh
git diff --no-index --check -- /dev/null docs/engineering/sprint17-type-maintenance-2026-09-18.md
```

A checagem atual retorna exit 1 por diferença entre o arquivo novo e `/dev/null`,
com stdout vazio: nenhum diagnóstico de whitespace. O stderr contém apenas o
aviso macOS `confstr/DARWIN_USER_TEMP_DIR` do ambiente sanitizado. O manifesto
preserva comando, cwd, exit, stdout/stderr e interpretação, sanando a lacuna de
proveniência sinalizada na revisão A1 sem alterar o registro A1 congelado.

## Limites

Produção, schema, SQL, políticas, dependências e evidências históricas ficam
fora do recorte. Não há banco real, seed, migração, credenciais, commit, push,
merge, deploy ou mudança de outro worktree. O runtime observado no candidato
é PostgreSQL; a descrição MySQL de AGENTS.md é histórica.

Esta manutenção não declara sprint completo, segurança global, funcionamento
em navegador, fechamento de G2 ou autorização de integração/campo. G4b-1
permanece NO-GO/STOP e as decisões comerciais M00 continuam separadas.

## Revisão independente

A revisão estática de A1 por Jim - Review, mensagem
`2026-09-18T14-42-25-708Z-366d56`, não encontrou motivo de reprovação. O parecer
foi explicitamente estático, sem PASS geral enquanto faltavam testes. A única
lacuna registrada foi o comando exato de whitespace do documento, sanada pelo
registro atual descrito acima. Nenhuma correção no teste foi solicitada.

Jim - Review aceitou a Unidade A no candidato A3, mensagem
`2026-09-18T14-48-03-749Z-b6a0ff`, após ler os logs brutos de execução,
o helper, a autorização humana e a equivalência de configuração. Michael
confirmou o aceite limitado em `2026-09-18T14-49-05-331Z-b486cf` e autorizou
prosseguir somente com a preparação documental da Unidade B.

O aceite A3 está vinculado ao teste SHA-256
`28c25f8472da7bb4227ec51bfddfcfcfac5719a6b65c2f219aeff6cc02a5f430`
e ao patch A3 identificado em `candidate-a3-manifest.json`. O teste permanece
idêntico; só este registro de revisão e a documentação da Unidade B evoluem
após aquele parecer. Snapshots e manifestos anteriores são preservados.

O revisor manteve explicitamente: execução somente pós-edição, método
`config: false` autorizado em vez do CLI literal, causa do loader não resolvida,
baseline runtime indisponível, 340 testes não executados e ausência de claims
globais. Conferiu os skips no nível dos logs/manifesto e nomes de arquivos;
não revisou cada motivo no código linha a linha. A análise detalhada de motivos
acima é do implementador e não é atribuída ao revisor.

A Unidade A foi concluída e aceita dentro desses limites. A revisão final dos
documentos é vinculada aos snapshots/manifestos finais; o manifesto externo
em `tmp/munder-maintenance/` evita hash autorreferente no próprio patch.
O documento da Unidade B é
[documented-followups-2026-09-18.md](documented-followups-2026-09-18.md).

Por correção operacional humana, o revisor desta missão passou a ser
`worker-structr-review-20260918` (Jim - Review). A sessão original
`jim-mu714mjg` encerrou; não se depende dela. Michael coordena o encaminhamento.


## Publicação reconciliada

Este registro preserva a evidência e os limites da unidade original. Caminhos de logs e missões marcados como locais não integram o repositório público; os originais e seus hashes permanecem no arquivo privado. O estado de integração posterior é registrado em [reconciliação de 18/09](progress-reconciliation-2026-09-18.md).
