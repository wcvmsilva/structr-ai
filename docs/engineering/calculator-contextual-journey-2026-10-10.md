# Calculator: endpoints e jornada contextual — 10 de outubro de 2026

## Escopo

Incremento T5/T6 e provas integradas locais do [plano ADR-003](../superpowers/plans/2026-10-10-adr003-calculator.md), sobre a main `eba4bbe734f7b7d0359869b90de7b5772ec56bbe` (PR #48). O usuário autorizou continuar a integração. Credenciais, permissões, binding, fixture e ativação hospedados continuam sujeitos à confirmação específica prevista na ADR-003; esta rodada não os altera.

O [SQL/executor anterior](calculator-executor-implementation-2026-10-10.md) permanece a fronteira de persistência. Nenhuma migration, role, policy, tabela, manifesto ou motor de preços muda neste incremento. IF-1/SWR-1 conservam seus próprios gates e autorizações.

## Caminho implementado

Os endpoints existentes recebem a variante contextual fechada: `assembly.list({mode:"calculator",projectId,intakeFormId})`, `assembly.calculateBatch(command)` e `estimate.createFromCalculator(command)`. Somente a consulta `estimate.getCalculatorResult(command)` é nova. Comandos legados continuam no modo direto; o modo Data API recusa seus campos e listas globais. A admissão exige `STRUCTR_FINANCIAL_CALCULATOR_ENABLED=true` e modo `authenticated-data-api`; a ausência do flag mantém as quatro entradas fechadas.

O web encaminha o bearer humano e o comando validado ao origin HTTPS configurado em `STRUCTR_FINANCIAL_EXECUTOR_ORIGIN`, exclusivamente em `/api/execute`. Não segue redirects, não repete writes e não usa SQL/fallback administrativo. O guard de ambiente também recusa `FINANCIAL_EXECUTOR_DATABASE_URL` no web. A resposta é limitada, validada e ligada à operação/par/pedido/hashes/seleções esperados; mensagens inesperadas do provedor não atravessam a fronteira.

O executor existente verifica assinatura e autoridade protegida. Aquisição, cálculo, confirmação, draft, auditoria e recibo continuam na mesma transação Drizzle SERIALIZABLE. F2/F5 são satisfeitas nesse executor; o web não adiciona uma transação fictícia em torno do HTTP nem uma auditoria duplicada depois do commit.

A rota existente `/calculator` escolhe a jornada pelo descriptor autenticado. O workspace fornece o link com o par já verificado. O ramo contextual não monta listas globais, não converte área em quantidade e permite salvar um draft de margem baixa com aviso explícito. O usuário calcula, confere os valores e confirma antes de salvar. Uma mudança de fonte exige novo cálculo e confirmação.

A recuperação usa `sessionStorage` por aba, limitado a 16.000 caracteres e 24 horas, guardando apenas identidade local de sessão, par, seleções, hashes e request ID. Recarregar a mesma aba conserva o pedido. Encerrar a aba, sair, mudar a sessão ou mudar o par remove a indicação local; a consulta manual continua disponível com os IDs anotados. Duas abas não apagam a indicação uma da outra. Dois envios explícitos em abas diferentes são pedidos distintos e podem produzir dois drafts; não se promete deduplicação entre ações deliberadamente diferentes. Um timeout não prova rollback: depois de um resultado incerto ou reload, o usuário consulta o mesmo pedido. A consulta `not_found` não dispara criação e não significa que uma operação concorrente jamais confirmará. Recibos mostram a confirmação original e o estado atual separadamente; aprovação e autorização de obra continuam etapas distintas.

## Provas e limites

- Backend T5: RED observado, 71 novos testes focais aprovados; 319 regressões dos routers e gates existentes aprovadas.
- Integração web→executor→PostgreSQL 17.11 descartável: RED de 12 falhas esperadas + uma recusa já existente; GREEN de 13/13 casos. Inclui A/B/C em centavos, audit/recibo persistidos, resposta perdida, nova sessão, preço alterado, retirada de operador, audit suprimido, par divergente, request ID conflitante, assinatura inválida e gate fechado. O cluster foi removido ao final.
- UI T6: 70 novos testes comportamentais (57 de intenção/controller, 8 da página real, 2 do link contextual e 3 do ciclo de autenticação). Preservados 21 testes legados do Calculator; regressões de autenticação/descriptor aprovadas.
- Chrome 154.0.8037.98: **9/9 casos aprovados**, [evidência efetivamente emitida](calculator-browser-evidence-2026-10-10.json). A/B/C exibem centavos exatos; confirmação explícita e clique duplo geram uma escrita por pedido; perda de resposta/reload, expiração/consulta manual, fonte alterada, par ausente, duas abas e logout com resposta tardia passaram. Seis formações confirmadas produziram exatamente seis drafts, seis recibos e seis audits. O banco descartável foi removido.
- Revisão independente corrigiu apresentação de centavos, projeção da identidade no armazenamento estrito, interferência entre abas e limpeza no início com logout já registrado. Cada correção recebeu regressão comportamental. A prova também passou a aguardar o resultado final de cada envio e a usar duas conexões próprias, como os dois slots do executor; uma conexão injetada limita o runner a um slot por desenho. No logout, a prova final exige sucesso de entrega da resposta retida, término daquela requisição no navegador e observação da interface após a atualização do React antes de verificar ausência de dados.

A integração física usa as rotas e adaptadores reais, assinatura ES256 real e conexões reais no banco. O transporte fetch entre web e executor é em memória e o bootstrap web é sintético. O laboratório de navegador usa a tela, hooks de sessão, cache e tRPC reais, substituindo o SDK Supabase e o bootstrap por uma identidade sintética assinada. O laboratório usa CSS mínimo, não certifica aparência responsiva do build hospedado. Não demonstra Auth/PostgREST hospedado, TLS entre serviços, custo/capacidade Vercel ou queda de socket durante COMMIT. Perda de resposta é injetada após commit confirmado. Não há dados de cliente nem credenciais externas.

## Reprodução

```sh
pnpm exec vitest run server/financial-calculator-router.test.ts server/financial-calculator-config.test.ts server/financial-calculator-ui.test.ts server/financial-calculator-page.test.ts
APP_PRINCIPAL_LAB=1 FINANCIAL_CALCULATOR_BOUNDARY_PHYSICAL=1 FINANCIAL_CALCULATOR_WEB_INTEGRATION_PHYSICAL=1 pnpm exec vitest run server/financial-calculator-web-integration.test.ts
NODE_ENV=test APP_PRINCIPAL_LAB=1 FINANCIAL_CALCULATOR_BOUNDARY_PHYSICAL=1 STRUCTR_CALCULATOR_BROWSER_LAB=1 pnpm exec tsx server/test-support/calculator-browser-lab.ts
```

O laboratório requer o PostgreSQL 17.11 local já usado pelos testes físicos, recusa configuração externa herdada e escuta somente em um endereço loopback aleatório. A linha `CALCULATOR_BROWSER_LAB_READY` informa o origin. Em outro terminal, `node scripts/prove-calculator-browser.mjs <origin>` executa as provas usando Playwright/Chrome instalados; `CALCULATOR_BROWSER_PLAYWRIGHT_MODULE` pode apontar para o `package.json` do runtime de testes existente. Não é dependência do produto. Encerrar por SIGTERM ou `POST /_lab/stop` remove o banco descartável.

## Próxima fronteira

Depois de revisão, verificações gerais e publicação desta fonte, preparar T8 com os dois itens concretos de confirmação: projeto/ambiente/destino protegido da credencial/custo e SQL/ACLs/binding/fixture/janela/retirada. A prova hospedada deverá usar as identidades aprovadas, sem promover role, reativar A1/A2/B1 ou ampliar acesso por inferência. A inspeção local dos artefatos T8 encontrou lacunas concretas antes de pedir essa confirmação: projeto/equipe/ambiente/origin do executor, capacidade e custo incremental, IDs protegidos reconciliados de O, preparador administrativo nominal de fixture/binding e comandos auditados de abertura/retirada. A autorização histórica de US$10/mês para o Supabase não autoriza custo novo do executor. O binding atual só admite retirada terminal (`true` → `false`); uma reabertura não pode ser prometida como toggle nem apagar evidência. O preflight hospedado também precisa delimitar a contenção de privilégios ambientais exigida pelo SQL.

O restante da jornada — aprovação, revogação, versionamento, entrega JSON/PDF e recuperação operacional — ainda exige implementação/prova e aceite antes do campo.

## Matriz de impacto canônico

Esta é uma evidência incremental das capacidades existentes, seguindo [a manutenção de evidências](../product/feature-evidence-maintenance.md). As duas vistas do registro e seus totais conservam suas classificações e âncoras históricas: nenhum estado é promovido a CURRENT, validado operacionalmente, aprovado em segurança ou liberado para campo. A prova abaixo cobre somente esta fatia local, não toda a definição de cada capacidade; por isso não há reclassificação nem correção dos totais. O reviewer independente desta rodada é `calculator_journey_review`.

| ID | Impacto | Comportamento, arquivos/consumidores e aceite observado |
| --- | --- | --- |
| C-03 | Indireto | `AuthenticatedScopeWorkspace` fornece o intake já conhecido ao Calculator; testes do link e de par inválido, sem alterar formação IF-1. |
| C-07 | Indireto | O mesmo link preserva o projeto conhecido; integração física recusa par incompatível, sem alterar formação de projeto. |
| C-14 | Direto | `Calculator`, `estimate-router` e o cliente financeiro conectam cálculo, confirmação e draft ao executor; A/B/C, auditoria, stale, resposta perdida e legado passam. |
| C-15 | Indireto | Os motores existentes são consumidos pelo executor intacto; novas provas verificam centavos e mudança de preço físico, sem mudar fórmulas ou price book. |
| C-16 | Direto | `assembly.list`/`calculateBatch` recebem comandos contextuais estritos; opção mínima do par substitui lista global nesse ramo, com recusa de input extra. |
| C-17 | Indireto | `useBundleCalculator` estreita a união da resposta para preservar o ramo legado; regressões da página legada permanecem aprovadas. |
| C-18 | Indireto | A tela mostra a margem/avisos devolvidos pelo executor e permite draft B/C; piso de aprovação e constantes financeiras permanecem inalterados. |
| P-01 | Direto | `auth-token` isola mudança de session ID, logout e hidratação; 3 novas regressões do ciclo real e prova de resposta tardia no browser. |
| P-02 | Direto | Guard de paths em `_core/trpc`, descriptor `auth.session` e cliente exigem admissão e identidade coerentes; gates fechados, JWT corrompido e retirada física recusados. |
| P-03 | Indireto | Par, identidade e resposta permanecem ligados ao tenant protegido do executor; nada autoriza tenant a partir do armazenamento da tela. |
| P-05 | Indireto | A escrita pela tela alcança o audit helper existente; audit suprimido aborta a transação real, e prova de browser confirma um audit por formação. |
| P-06 | Direto | `financial-calculator-client` cria transporte HTTPS fixo e limitado, sem SQL no web; o executor/transações/SQL não mudam. |
| P-08 | Direto | `estimate.getCalculatorResult` consulta o pedido original, reautorizando e sem nova escrita; `not_found`, reload, expiração e consulta manual passam. Recovery legado permanece separado. |
| P-09 | Indireto | Hashes/seleções/par/pedido são validados nas respostas e recibos; prova local não estabelece o substrato completo de proveniência definido no registro. |

Exclusões verificadas pelo diff e pelos guards: C-10/C-11 (geração/revisão de escopo), C-22/C-29/C-33 (autorização de execução, change orders, baselines) e P-10 (exportação) não recebem writers, permissões ou novas alegações nesta rodada. O link de recibo usa a leitura de draft já admitida; não aprova nem exporta. Não há mudança de migrations, schema, manifesto, dependências ou callbacks de recuperação de conta.

## Fechamento da verificação

A rodada acrescenta **170 testes Vitest distintos**: 71 backend + 70 UI/autenticação + 13 integrações físicas + 16 contraprovas do detector de autorização. Os 13 físicos são opt-in e foram executados separadamente com zero skips; não somar novamente suas execuções. Os nove casos do navegador são evidência adicional, não entram nessa contagem. O motor, SQL e auditoria transacional já implementados em T1–T4 permanecem intactos.

- `pnpm check`: zero erros.
- `pnpm test`: a primeira execução geral teve 8.292 aprovados, 1.634 ignorados e uma falha no detector estrutural legado de autorização, que não reconhecia a nova fronteira do executor. O detector foi corrigido com análise de sintaxe restrita aos dois ramos nominais, sem isentar o router inteiro; 21/21 casos focais passaram, incluindo 16 novas contraprovas. O resultado da execução geral final obrigatória do hook, sem bypass, e do CI fica registrado na descrição/checks da PR desta fonte; a primeira execução não é apresentada como aprovação.
- `pnpm build:vercel`: aprovado; permanecem avisos já existentes de variáveis opcionais de analytics e tamanho de chunks.
- `pnpm check:financial-executor` e `pnpm build:financial-executor`: aprovados; bundle isolado de 913.726 bytes, com verificações de dependências e formato de credenciais.
- Revisão independente final: encerrada sem achados pendentes no produto, laboratório, script de prova ou documentação. O revisor executou 218 testes focais distintos e depois os 21 casos do detector de autorização; esses resultados são reexecuções e não acrescem testes novos à contagem.
- Publicação: este registro identifica a fonte local verificada. O SHA publicado, os checks de CI e a integração à `main` ficam registrados na PR desta rodada; integração somente com checks aprovados.

### Inventário de entrega

**Arquivos novos:** `server/financial-calculator-client.ts`, `client/src/lib/calculator-intent.ts`, `server/financial-calculator-{config,router,ui,page,web-integration}.test.ts`, `server/test-support/calculator-browser-lab.ts`, `scripts/prove-calculator-browser.mjs`, este registro e `calculator-browser-evidence-2026-10-10.json`.

**Arquivos modificados:** `.env.example`, `README.md`, `todo.md`, `server/_core/{database-mode,trpc}.ts`, `server/{assembly,estimate,auth}-router.ts`, `client/src/pages/Calculator.tsx`, `client/src/hooks/useBundleCalculator.ts`, `client/src/lib/auth-token.ts`, `client/src/components/scope/AuthenticatedScopeWorkspace.tsx`, os testes existentes `adr002-intake-integration-router`, `adr002-scope-workspace-ui`, `calculator-project-ui` e `homolog-auth-ui-session`, o detector `phase1-route-guard-coverage`, além do estado de engenharia, plano Calculator e inventário de permissões.

**Tabelas novas:** zero. **Funções de motor novas:** zero. **Helpers DB novos:** zero; persistência/auditoria/transação reutilizam T1–T4. **Endpoint novo:** `estimate.getCalculatorResult`; atualizados os três endpoints Calculator existentes. **Segurança:** todos os quatro caminhos financeiros são protegidos, com validação estrita e verificação independente de identidade/autoridade no executor. **Auditoria:** a única escrita financeira usa o helper transacional existente; prova de audit suprimido aborta draft/recibo. **Regressões:** a falha inicial e sua correção estão registradas acima; o relatório final da PR registra o resultado da suíte obrigatória antes da integração. Esta entrega não declara um novo domínio nem completa o aceite operacional.
