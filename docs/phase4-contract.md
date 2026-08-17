# Structr AI — Fase 4: Aprendizado Controlado e Produto Replicável

> **Status:** implementado sobre o baseline da Fase 3.  
> **Objetivo:** fechar o ciclo entre estimate e execução real sem permitir que dados pontuais, ruído ou automação alterem o price book sem revisão humana.

## 1. Princípio operacional

A Fase 4 transforma o closeout em evidência de melhoria. O fluxo governado é:

```text
Estimate aprovado → Actuals comprometidos → Closeout → Calibração → Proposta
→ Aprovação humana → Aplicação no price book → Snapshot de rollback → Auditoria
```

Nenhum motor puro escreve no banco. Nenhuma calibração altera preços. O único caminho de mudança de preço é uma entidade `price_adjustments` aprovada por pessoa identificada e aplicada explicitamente.

| Regra | Decisão |
|---|---|
| Verdade de custo | O snapshot de variância da Fase 3 continua sendo a fonte para actuals vs. budget aprovado. |
| Dinheiro | Valores operacionais usam **centavos inteiros**. |
| Sinal | Viés é definido pela **mediana**, não pela média; um job catastrófico não reprifica um cost code. |
| Segurança | Ajustes são amortecidos em 60%, têm piso de ruído de 2% e cap absoluto de ±25%. |
| Autoridade | Evidência sugere; um humano aprova; outro call explícito aplica. |
| Multi-tenant | Todo dado novo com `tenant_id` é consultado via `tenantWhere()`; routers derivam tenant de `ctx.tenantId`, nunca do cliente. |

## 2. Learning layer e calibração

### 2.1 Entidades

| Entidade | Papel | Chave/controle |
|---|---|---|
| `calibration_events` | Finding por cost code, assembly, trade ou zona geo. | Única por `(tenant_id, finding_key)`; scope `project` ou `tenant`. |
| `calibration_reports` | Snapshot agregado de precisão de um projeto ou período. | Uma chave determinística por relatório/período. |
| `scope_completeness_scores` | Medida money-weighted de escopo aprovado versus execução. | Única por projeto. |
| `scope_checklist_patterns` | Memória institucional dos itens frequentemente omitidos. | Única por `(tenant, project_type, cost_code)`. |

### 2.2 Tipos de evento

| Tipo | Mede | Resultado esperado |
|---|---|---|
| `price_accuracy` | Estimate x actual por cost code e assembly. | Identificar sub/super-estimativa consistente. |
| `scope_completeness` | Trabalho executado fora do escopo aprovado. | Detectar omissões recorrentes e alimentar checklist. |
| `duration_accuracy` | Duração planejada x real por trade/task type. | Corrigir fatores de cronograma, não dinheiro diretamente. |
| `geo_factor_validation` | Piso geo configurado x margem realizada. | Sugerir **subir** piso quando não protege a margem. |

### 2.3 Invariantes CL-001 a CL-006

| ID | Invariante implementado |
|---|---|
| CL-001 | Calibração recebe actuals pós-closeout e gera findings, não alterações de preço. |
| CL-002 | Evento transiciona `open → acknowledged → actioned`; pode ser `dismissed` com motivo ou `superseded`. |
| CL-003 | Evento de projeto exige `project_id`; agregado de tenant não carrega projeto. |
| CL-004 | Confiança combina volume, consistência direcional e dispersão; menos de 3 jobs é `insufficient`. |
| CL-005 | `finding_key` idempotente atualiza a evidência em vez de duplicar a fila. |
| CL-006 | Evento `actioned` é preservado como evidência; nova medição cria substituto e supersede o anterior. |

### 2.4 Política geo costeira

> Um piso protetivo **não baixa automaticamente** porque alguns jobs entregaram margem acima da meta.

Para uma zona costeira configurada em 42% que realiza 38% de margem de forma consistente, o motor sugere elevar para 46% (42% + mediana do shortfall). Se a zona realiza 49%, o piso permanece 42%. O sistema pode sugerir elevação baseada em evidência; redução exige decisão humana fora da automação.

## 3. Price adjustments

### 3.1 Máquina de estados

```text
proposed → approved → applied → rolled_back
     └────→ rejected
     └────→ expired
```

| ID | Controle |
|---|---|
| PA-001 | Cap absoluto de ±25%; ajuste abaixo de 2% é ruído e não deve churnar o book. |
| PA-002 | `approved` e `applied` exigem autor identificado. Aplicação automática é proibida. |
| PA-003 | Transições fechadas; terminal não reabre. |
| PA-004 | Aplicação captura `rollback_snapshot` antes da mutação e reverte valores exatos em centavos. |
| PA-005 | No máximo um ajuste live por target; correções não podem compor silenciosamente. |

A procedure pública de aplicação chama-se `priceAdjustment.applyToPriceBook`. O nome `apply` não é usado porque é reservado pelo proxy do tRPC v11.

## 4. Scope completeness

O score começa em 100 e desconta a proporção de dinheiro executado sem linha aprovada. Custo coberto por change order aprovado é reportado, mas não penaliza o score: foi escopo capturado e vendido, não absorvido.

| Resultado | Regra |
|---|---|
| Linha planejada, nunca executada | Reportada como `unexecuted`; não reduz score, pois não gastar orçamento não é falha de estimate. |
| Linha executada sem scope | `missingItem` e custo não planejado; reduz score salvo se change order cobriu. |
| Checklist reutilizável | Só promove após pelo menos 2 ocorrências e frequência de 40% no mesmo tipo de projeto. |

## 5. Multi-tenant readiness

### 5.1 Configuração por tenant

`tenant_settings` concentra canal padrão, região geo, branding, feature flags, overrides de Profit Shield, tolerâncias de variância/calibração, onboarding e integrações.

| Controle | Implementação |
|---|---|
| Feature flags | Vocabulário fechado, flags mandatórias e fechamento transitivo de dependências. |
| Profit Shield | Piso efetivo é `MAX(plataforma, canal, geo, override tenant)`. Override só pode tornar a operação mais conservadora. |
| Onboarding | Sem price book, cost codes e pisos confirmados, `assertTenantOperational()` bloqueia ciclo comercial. |
| Auto-apply | `autoApplyAdjustments` é sempre falso; tentativa de ativar retorna erro explícito. |
| Cobertura | `pnpm audit:tenant` inspeciona os módulos e bloqueia nova persistência tenant-scoped sem o guard estrutural. |

### 5.2 Fixture demonstrativo

`pnpm seed:demo` cria de forma idempotente o tenant `demo-coastal-gc`:

- região `charleston_sc`, risco `coastal`, canal `premium`;
- flags governadas por default/dependências;
- onboarding propositalmente incompleto;
- sem price book falso, sem actuals fabricados e sem qualquer ajuste auto-aplicado.

## 6. Analytics e audit trail

| Domínio | Agregação |
|---|---|
| Pipeline | Leads e estimates ativos por estágio, valor e idade. Leads sem estimate contam como volume, não como receita inventada. |
| Forecast | Backlog de projetos ativos + pipeline ponderado por estágio. |
| Profit health | Margem estimada/real versus piso efetivo por canal e risco geo. |
| Field progress | Tasks concluídas, bloqueadas, atrasadas e forecast de término. |
| Subcontractors | Custo, prazo e variância por trade partner. |

`analytics_snapshots` congela períodos para que um mês fechado não mude quando novos dados entram. O payload é calculado no servidor; o cliente não pode gravar números arbitrários como evidência.

`audit_log` é append-only e tenant-scoped. A migration impede update/delete. Atos financeiros e de permissão guardam snapshots antes/depois e diff de campos.

## 7. Superfície de routers

| Namespace | Operações críticas |
|---|---|
| `calibration` | run por projeto/tenant, findings, acknowledgements, dismiss, reports e summary. |
| `priceAdjustment` | proposta, impacto, approve, reject, `applyToPriceBook`, rollback e summary. |
| `scopeCompleteness` | score, preview, checklist e refresh de patterns. |
| `tenantSettings` | settings, flags, pisos, onboarding, provision e coverage audit. |
| `analytics` | dashboard e snapshots governados. |
| `auditTrail` | leitura de histórico, projeto e estatísticas; sem endpoint de escrita. |

## 8. Operação e validação

| Comando | Finalidade |
|---|---|
| `pnpm check` | Type-check sem emissão. |
| `pnpm test` | Suíte completa, incluindo `server/phase4-engines.test.ts`. |
| `pnpm audit:tenant` | Auditoria estática de cobertura tenant. |
| `pnpm seed:demo` | Fixture idempotente do tenant demonstrativo. |

## 9. Compatibilidade

O namespace `learning` do Sprint 22 permanece montado somente para compatibilidade. Todo código novo deve usar `calibration`, `priceAdjustment`, `scopeCompleteness`, `analytics`, `tenantSettings` e `auditTrail`.

> **Regra de operação:** dados reais podem ensinar o sistema; só um humano identificado pode mudar o que a empresa cobra.
