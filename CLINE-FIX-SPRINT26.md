# Hotfix: Sprint 26 Ressalvas — Pipeline Integration Corrections

---

## CONTEXT

Sprint 26 (Pipeline Integration) was completed and approved with 2 ressalvas identified during Chief Architect review:

1. **`lead.convert` endpoint was NOT updated** — it still calls the old `convertLeadToProject()` from `lead-db.ts`, which creates Client + Project but does NOT create a Deal. The new `orchestrateLeadConversion()` in `pipeline-db.ts` creates Client + Deal + Project atomically. Two parallel conversion paths exist, which will cause silent bugs (deals missing when leads are converted via the old path).

2. **`getPipelineSummary` omits `projectsByStatus`** — the spec required this field in the return object, but the implementation only returns `leadsByStatus` and `dealsByStage`. The pipeline overview page cannot show project status breakdown without it.

**Affected files:**
- `server/lead-router.ts` — uses old conversion function
- `shared/pipeline-orchestrator.ts` — missing projectsByStatus
- `server/sprint26-pipeline-engine.test.ts` — needs test for projectsByStatus
- `server/sprint24-lead-router.test.ts` — needs updated expectation for convert response

---

## GOAL

Fix both ressalvas with surgical changes. No new features, no refactoring, no architecture changes. Just wire the correct function and add the missing field.

**Expected outcome:**
- `lead.convert` → calls `orchestrateLeadConversion` → returns `{ clientId, dealId, projectId }`
- `getPipelineSummary` → returns `projectsByStatus` in addition to existing fields
- All existing tests pass with zero regressions
- 2 new tests added (1 for each fix)

---

## FILES

### Files to READ first:
| File | Why |
|------|-----|
| `AGENTS.md` | Project rules |
| `server/lead-router.ts` | See current convert implementation |
| `server/pipeline-db.ts` | See orchestrateLeadConversion signature |
| `shared/pipeline-orchestrator.ts` | See getPipelineSummary current return |

### Files to MODIFY:
| File | Change |
|------|--------|
| `server/lead-router.ts` | Replace `convertLeadToProject` call with `orchestrateLeadConversion` |
| `shared/pipeline-orchestrator.ts` | Add `projectsByStatus` to `getPipelineSummary` return |
| `server/sprint26-pipeline-engine.test.ts` | Add test for `projectsByStatus` |
| `server/sprint24-lead-router.test.ts` | Update convert test to expect `dealId` in response |

---

## CONSTRAINTS

1. **Do NOT modify any other files** beyond the 4 listed above
2. **Do NOT add new functions** — only modify existing ones
3. **Do NOT change function signatures** — only change internal implementation
4. **Run `pnpm check` + `pnpm test` after EACH change** — zero regressions
5. Follow AGENTS.md Tier 1 rules (especially F6: "When spec says UPDATE an existing endpoint, you MUST modify it")

---

## OUTPUT — Exact Changes Required

### Change 1: Update `lead.convert` in `server/lead-router.ts`

**Current code (find this):**
```typescript
import { ..., convertLeadToProject, ... } from "./lead-db";
```
...somewhere in the convert procedure:
```typescript
const result = await convertLeadToProject(input.leadId, ctx.user.id);
```

**Replace with:**
```typescript
import { orchestrateLeadConversion } from "./pipeline-db";
```
...in the convert procedure:
```typescript
const result = await orchestrateLeadConversion(input.leadId, ctx.user.id);
```

The return shape is additive: old returned `{ clientId, projectId }`, new returns `{ clientId, dealId, projectId }`. No breaking change.

**Verify:** `pnpm check && pnpm test`

---

### Change 2: Add `projectsByStatus` to `getPipelineSummary` in `shared/pipeline-orchestrator.ts`

**Current code (find the function `getPipelineSummary`):**
After the `dealsByStage` reduce block, ADD:
```typescript
const projectsByStatus = projects.reduce((acc: any, project: any) => {
  acc[project.status] = (acc[project.status] || 0) + 1;
  return acc;
}, {});
```

In the return statement, ADD `projectsByStatus`:
```typescript
return {
  leadsByStatus,
  dealsByStage,
  projectsByStatus,  // <-- ADD THIS LINE
  pipelineValue: totalValue,
  conversionRate,
  avgDealValue,
  totalLeads,
  totalDeals: deals.length,
  totalProjects: projects.length,
};
```

**Verify:** `pnpm check && pnpm test`

---

### Change 3: Add test for `projectsByStatus` in `server/sprint26-pipeline-engine.test.ts`

Inside the `describe("getPipelineSummary")` block, ADD:
```typescript
it("should group projects by status", () => {
  const projects = [
    { status: "intake" },
    { status: "intake" },
    { status: "in_progress" },
  ];
  const result = getPipelineSummary([], [], projects as any);
  expect(result.projectsByStatus).toEqual({ intake: 2, in_progress: 1 });
});
```

**Verify:** `pnpm check && pnpm test`

---

### Change 4: Update convert test in `server/sprint24-lead-router.test.ts`

Find the test for `lead.convert` and update the expected response to include `dealId`:
```typescript
expect(result).toHaveProperty("dealId");
expect(result).toHaveProperty("clientId");
expect(result).toHaveProperty("projectId");
```

**Verify:** `pnpm check && pnpm test`

---

### Final Verification:
```bash
pnpm check    # 0 TypeScript errors
pnpm test     # ALL tests passing, 0 regressions
```

**Report these results:**
- [ ] lead.convert calls orchestrateLeadConversion: YES/NO
- [ ] getPipelineSummary returns projectsByStatus: YES/NO
- [ ] New tests added: [count]
- [ ] All tests passing: [count] passing, 0 failures
- [ ] TypeScript: 0 errors
