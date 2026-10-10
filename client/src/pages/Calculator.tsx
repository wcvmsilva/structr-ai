/**
 * Calculator Page — Sprint 8 Bundle Calculator UI
 *
 * Full-page assembly-based cost calculator with:
 * - Context selectors (region, channel, finish level)
 * - Assembly selector with category filter
 * - Cost breakdown table with expandable rows
 * - Summary panel with Profit Shield and trade breakdown
 * - Export to Estimate Draft
 */

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  useBundleCalculator,
  REGION_OPTIONS,
  CHANNEL_OPTIONS,
  FINISH_OPTIONS,
} from "@/hooks/useBundleCalculator";
import AssemblySelector from "@/components/calculator/AssemblySelector";
import CostBreakdownTable from "@/components/calculator/CostBreakdownTable";
import BundleSummaryPanel from "@/components/calculator/BundleSummaryPanel";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Calculator as CalculatorIcon,
  MapPin,
  Radio,
  Sparkles,
  RotateCcw,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useLocation, useSearch } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import type { CalculatorPair } from "@shared/financial-calculator-engine";
import { currentQueryData } from "@/components/estimate/EstimateReadiness";
import {
  getAuthSessionSnapshot,
  subscribeAuthSession,
  subscribeAuthIdentityChange,
} from "@/lib/auth-token";
import {
  formatCalculatorMoney,
  calculatorBrowserStorage,
  calculatorSessionId,
  clearCalculatorIntent,
  createCalculatorJourney,
  parseCalculatorPair,
  type CalculatorOwner,
  type CalculatorJourneyState,
} from "@/lib/calculator-intent";
import type { Region, Channel, FinishLevel } from "@/hooks/useBundleCalculator";

export function LegacyCalculatorPage() {
  const { isAuthenticated } = useAuth();

  const [projectId, setProjectId] = useState("");
  const [projectSearch, setProjectSearch] = useState("");
  const projectsQuery = trpc.project.list.useQuery(
    {
      limit: 100,
      ...(projectSearch.trim() ? { search: projectSearch.trim() } : {}),
    },
    { enabled: isAuthenticated }
  );
  const projects = (projectsQuery.data?.items ?? []).filter(
    project =>
      project.deletedAt === null &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        project.id
      ) &&
      project.id !== "00000000-0000-0000-0000-000000000000"
  );
  const selectedProject = projects.find(project => project.id === projectId);
  const projectsLoading =
    projectsQuery.isLoading ||
    projectsQuery.isPending ||
    projectsQuery.isFetching;

  const calc = useBundleCalculator();

  // ── Export to Estimate Draft (Sprint 9) ──
  const createDraft = trpc.estimate.createFromCalculator.useMutation({
    onSuccess: (result: any) => {
      const warnings = result.warnings ?? [];
      if (warnings.length > 0) {
        toast.warning(
          `Estimate Draft #${result.draft.id} created with ${warnings.length} warning(s)`,
          { duration: 5000 }
        );
      } else {
        toast.success(
          `Estimate Draft #${result.draft.id} created — ${result.batchSummary.assemblyCount} assemblies, $${Number(result.draft.finalTotalPrice).toLocaleString()}`,
          { duration: 4000 }
        );
      }
      // Keep the receipt visible. Navigation must be a current explicit action.
    },
    onError: (err: any) => toast.error(err.message),
  });
  // Listing is only a choice of context; the server still authorizes the write.
  const canGenerate = Boolean(
    isAuthenticated &&
      selectedProject &&
      !projectsLoading &&
      !projectsQuery.isError &&
      !createDraft.isPending &&
      calc.canExport &&
      !calc.calculating &&
      !calc.recalculating
  );

  const handleExport = () => {
    if (!calc.batchResult || !calc.region || !calc.channel) return;
    if (!isAuthenticated) {
      toast.error("Please log in to export estimates");
      return;
    }
    if (!canGenerate || !selectedProject) return;

    createDraft.mutate({
      selections: calc.selections.map(s => ({
        assemblyId: s.assemblyId,
        quantity: s.quantity,
      })),
      context: {
        projectId: selectedProject.id,
        region: calc.region,
        channel: calc.channel as "direct" | "insurance" | "commercial",
        finishLevel: calc.finishLevel,
        notes: null,
      },
    });
  };

  return (
    <div className="flex flex-col gap-6 pb-8">
      {/* ── Page Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-gold-glow flex items-center justify-center">
              <CalculatorIcon className="h-5 w-5 text-gold" />
            </div>
            Bundle Calculator
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Select assemblies, set context, and calculate real-time pricing with
            Profit Shield
          </p>
        </div>
        {calc.selections.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              calc.clearSelections();
              toast.info("Selections cleared");
            }}
            className="gap-2 text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Clear All
          </Button>
        )}
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="calculator-project-search"
              className="text-sm font-medium"
            >
              Search projects
            </label>
            <input
              id="calculator-project-search"
              type="search"
              value={projectSearch}
              onChange={event => {
                setProjectSearch(event.target.value);
                setProjectId("");
              }}
              disabled={!isAuthenticated || createDraft.isPending}
              placeholder="Search by project name or address"
              className="h-10 rounded-md border border-border bg-background px-3 text-sm disabled:opacity-50"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="calculator-project" className="text-sm font-medium">
              Project for this estimate
            </label>
            <select
              id="calculator-project"
              value={selectedProject?.id ?? ""}
              onChange={event => setProjectId(event.target.value)}
              disabled={
                !isAuthenticated ||
                projectsLoading ||
                projectsQuery.isError ||
                createDraft.isPending ||
                projects.length === 0
              }
              aria-describedby="calculator-project-status"
              className="h-10 rounded-md border border-border bg-background px-3 text-sm disabled:opacity-50"
            >
              <option value="">Choose a project</option>
              {projects.map(project => (
                <option key={project.id} value={project.id}>
                  {project.name}
                  {project.address ? ` — ${project.address}` : ""}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p
          id="calculator-project-status"
          role="status"
          className="text-xs text-muted-foreground mt-3"
        >
          {!isAuthenticated
            ? "Log in to choose a project."
            : projectsQuery.isError
              ? "Projects could not be loaded. Try changing the search or reload the page."
              : projectsLoading
                ? "Loading projects…"
                : projects.length === 0
                  ? "No projects found. Try another search."
                  : (projectsQuery.data?.total ?? 0) > 100
                    ? "Showing up to 100 projects. Search to find another project."
                    : "Choose an existing project before generating the estimate draft."}
        </p>
      </div>

      {/* ── Context Selectors ── */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center gap-3 mb-3">
          <span className="text-[0.75rem] font-bold uppercase tracking-[0.06em] text-gold whitespace-nowrap">
            Pricing Context
          </span>
          <div className="h-px flex-1 bg-gradient-to-r from-gold/35 to-transparent" />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* Region */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[0.65rem] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <MapPin className="h-3 w-3" />
              Region
            </label>
            <Select
              value={calc.region ?? ""}
              onValueChange={v => calc.setRegion(v as Region)}
            >
              <SelectTrigger className="bg-background border-border">
                <SelectValue placeholder="Select region..." />
              </SelectTrigger>
              <SelectContent>
                {REGION_OPTIONS.map(opt => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Channel */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[0.65rem] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Radio className="h-3 w-3" />
              Channel
            </label>
            <Select
              value={calc.channel ?? ""}
              onValueChange={v => calc.setChannel(v as Channel)}
            >
              <SelectTrigger className="bg-background border-border">
                <SelectValue placeholder="Select channel..." />
              </SelectTrigger>
              <SelectContent>
                {CHANNEL_OPTIONS.map(opt => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Finish Level */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[0.65rem] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Sparkles className="h-3 w-3" />
              Finish Level
            </label>
            <Select
              value={calc.finishLevel}
              onValueChange={v => calc.setFinishLevel(v as FinishLevel)}
            >
              <SelectTrigger className="bg-background border-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FINISH_OPTIONS.map(opt => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {!calc.contextReady && calc.selections.length > 0 && (
          <p className="text-xs text-amber-400 mt-3 flex items-center gap-1.5">
            <Sparkles className="h-3 w-3" />
            Select both region and channel to enable pricing calculation
          </p>
        )}
      </div>

      {/* ── Main Layout: Two Columns ── */}
      <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-6 xl:gap-8">
        {/* Left Column — Assembly Selector */}
        <aside className="lg:sticky lg:top-4 lg:self-start">
          <div className="rounded-xl border border-border bg-card p-4">
            <AssemblySelector
              assemblies={calc.assemblyList}
              loading={calc.assembliesLoading}
              categories={calc.categories
                .map((c: any) => (typeof c === "string" ? c : c.category))
                .filter(Boolean)}
              activeCategory={calc.activeCategory}
              onCategoryChange={calc.setActiveCategory}
              isSelected={calc.isSelected}
              getQuantity={calc.getQuantity}
              onToggle={calc.toggleAssembly}
              onQuantityChange={calc.updateQuantity}
              selectionCount={calc.selections.length}
            />
          </div>
        </aside>

        {/* Right Column — Cost Breakdown + Summary */}
        <main className="flex flex-col gap-6">
          {/* Cost Breakdown Table */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
              <span className="text-[0.75rem] font-bold uppercase tracking-[0.06em] text-gold whitespace-nowrap">
                Cost Breakdown
              </span>
              <div className="h-px flex-1 bg-gradient-to-r from-gold/35 to-transparent" />
              {calc.calculating && (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-gold" />
              )}
            </div>

            <CostBreakdownTable
              assemblies={(calc.batchResult?.assemblies ?? []) as any[]}
              assemblyShields={calc.assemblyShields}
              onRemove={calc.removeAssembly}
              onQuantityChange={calc.updateQuantity}
            />
          </div>

          {/* Summary Panel */}
          <div className="rounded-xl border border-border bg-card p-4">
            <BundleSummaryPanel
              batchResult={calc.batchResult}
              profitShield={calc.profitShield}
              tradeBreakdown={calc.tradeBreakdown}
              region={calc.region}
              channel={calc.channel}
              finishLevel={calc.finishLevel}
              calculating={calc.calculating}
              recalculating={calc.recalculating}
              canExport={canGenerate}
              selectionCount={calc.selections.length}
              onExport={handleExport}
            />
          </div>
        </main>
      </div>
    </div>
  );
}

type SessionQuery = Parameters<
  typeof currentQueryData<inferRouterOutputs<AppRouter>["auth"]["session"]>
>[0];
export default function CalculatorPage() {
  const sessionQuery = trpc.auth.session.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });
  const session = currentQueryData(sessionQuery);
  if (session?.estimateReadOnly === false) return <LegacyCalculatorPage />;
  if (
    session?.estimateReadOnly === true &&
    session.authenticated &&
    session.financialCalculatorEnabled
  )
    return <ContextualCalculator sessionQuery={sessionQuery} />;
  return (
    <CalculatorNotice>
      {sessionQuery.isError || sessionQuery.error
        ? "Calculator access is unavailable. Reload the page to try again."
        : !session
          ? "Checking Calculator access…"
          : "Calculator is unavailable for this session. Please try again later."}
    </CalculatorNotice>
  );
}
function CalculatorNotice({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-4xl space-y-3">
      <h1 className="text-2xl font-bold">Calculator</h1>
      <p role="status">{children}</p>
    </div>
  );
}
/** The contextual branch cannot mount the legacy global list/catalog hooks. */
export function ContextualCalculator({
  sessionQuery,
}: {
  sessionQuery: SessionQuery;
}) {
  const auth = useAuth();
  const browser = useSyncExternalStore(
    subscribeAuthSession,
    getAuthSessionSnapshot,
    getAuthSessionSnapshot
  );
  const search = useSearch(),
    pair = parseCalculatorPair(search),
    sessionId = calculatorSessionId(browser.session);
  useEffect(() => {
    if (!pair) clearCalculatorIntent();
  }, [search]);
  if (!pair)
    return (
      <CalculatorNotice>
        Open a project and intake link with both IDs to use this Calculator.
      </CalculatorNotice>
    );
  if (
    !auth.isAuthenticated ||
    auth.loading ||
    auth.error ||
    !auth.user?.tenantId ||
    browser.loading ||
    browser.error ||
    !browser.session ||
    !sessionId ||
    auth.user.externalOpenId !== browser.session.user.id
  )
    return (
      <CalculatorNotice>
        Sign in with an account that has access to this project and intake.
      </CalculatorNotice>
    );
  const identity = {
    actorId: auth.user.id,
    tenantId: auth.user.tenantId,
    subject: browser.session.user.id,
    sessionId,
    generation: browser.generation,
  };
  return (
    <CalculatorWorkspace
      key={JSON.stringify([identity, pair])}
      identity={identity}
      pair={pair}
      sessionQuery={sessionQuery}
    />
  );
}
const emptyJourney: CalculatorJourneyState = {
  context: null,
  selections: [],
  result: null,
  intent: null,
  receipt: null,
  confirmed: false,
  busy: false,
  message: null,
};
function CalculatorWorkspace({
  identity,
  pair,
  sessionQuery,
}: {
  identity: CalculatorOwner & {
    actorId: string;
    tenantId: string;
    generation: number;
  };
  pair: CalculatorPair;
  sessionQuery: SessionQuery;
}) {
  const utils = trpc.useUtils();
  const [, navigate] = useLocation();
  const client = useQueryClient();
  const latest = useRef(sessionQuery);
  latest.current = sessionQuery;
  const [journey, setJourney] = useState<ReturnType<
    typeof createCalculatorJourney
  > | null>(null);
  const [manualRequestId, setManualRequestId] = useState("");
  useEffect(() => {
    let active = true;
    const current = () => {
      const browser = getAuthSessionSnapshot(),
        profile = utils.auth.me.getData(),
        descriptor = currentQueryData(latest.current);
      const status = client.getQueryState(
        getQueryKey(trpc.auth.session, undefined, "query")
      );
      const urlPair =
        typeof window === "undefined"
          ? pair
          : parseCalculatorPair(window.location.search);
      return (
        active &&
        !!urlPair &&
        urlPair.projectId === pair.projectId &&
        urlPair.intakeFormId === pair.intakeFormId &&
        (!globalThis.location ||
          globalThis.location.pathname === "/calculator") &&
        !browser.loading &&
        !browser.error &&
        browser.generation === identity.generation &&
        browser.session?.user.id === identity.subject &&
        calculatorSessionId(browser.session) === identity.sessionId &&
        profile?.id === identity.actorId &&
        profile.tenantId === identity.tenantId &&
        profile.externalOpenId === identity.subject &&
        descriptor?.authenticated === true &&
        descriptor.estimateReadOnly === true &&
        descriptor.financialCalculatorEnabled === true &&
        utils.auth.session.getData() === descriptor &&
        status?.status === "success" &&
        status.fetchStatus === "idle" &&
        !status.error
      );
    };
    const controller = createCalculatorJourney({
      storage: calculatorBrowserStorage(),
      owner: identity,
      pair,
      now: Date.now,
      requestId: () => crypto.randomUUID(),
      current,
      transport: {
        context: input => utils.client.assembly.list.query(input),
        calculate: input => utils.client.assembly.calculateBatch.query(input),
        create: input =>
          utils.client.estimate.createFromCalculator.mutate(input),
        recover: input =>
          utils.client.estimate.getCalculatorResult.query(input),
      },
    });
    setJourney(controller);
    const stop = subscribeAuthIdentityChange(() => {
      active = false;
      controller.invalidate(true);
    });
    void controller.load();
    return () => {
      active = false;
      stop();
      controller.invalidate(false);
    };
  }, [
    client,
    identity.actorId,
    identity.tenantId,
    identity.subject,
    identity.sessionId,
    identity.generation,
    pair.projectId,
    pair.intakeFormId,
    utils,
  ]);
  const state = useSyncExternalStore(
    journey?.subscribe ?? (() => () => {}),
    journey?.getSnapshot ?? (() => emptyJourney),
    () => emptyJourney
  );
  const locked = state.busy || !!state.intent || !!state.receipt;
  const result = state.result,
    receipt = state.receipt;
  const money = formatCalculatorMoney;
  return (
    <div className="max-w-5xl space-y-6 pb-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold">Project Calculator</h1>
        <p className="text-sm text-muted-foreground">
          Choose assemblies and quantities, calculate, then confirm a draft.
        </p>
        <dl className="text-xs break-all">
          <dt>Project ID</dt>
          <dd>{pair.projectId}</dd>
          <dt>Intake ID</dt>
          <dd>{pair.intakeFormId}</dd>
        </dl>
      </header>
      {state.message && (
        <p role="status" className="rounded-lg border p-3">
          {state.message}
        </p>
      )}
      {!state.context ? (
        <div className="space-y-2">
          <p>
            {state.busy
              ? "Loading authorized assemblies…"
              : "Assemblies are unavailable."}
          </p>
          <Button
            variant="outline"
            disabled={!journey || state.busy}
            onClick={() => void journey?.load()}
          >
            Retry assemblies
          </Button>
        </div>
      ) : (
        <section
          aria-label="Assembly selection"
          className="rounded-xl border bg-card p-4 space-y-4"
        >
          <h2 className="font-semibold">Assemblies</h2>
          <p className="text-sm text-muted-foreground">
            Select each quantity explicitly (1–100). Intake area is not used as
            quantity.
          </p>
          {state.context.options.length === 0 && (
            <p>No assemblies are available for this project and intake.</p>
          )}
          {state.context.options.map(option => {
            const selected = state.selections.find(
              v => v.assemblyId === option.assemblyId
            );
            return (
              <div
                key={option.assemblyId}
                className="flex flex-wrap items-center gap-4"
              >
                <label className="flex items-center gap-2 min-w-48">
                  <input
                    type="checkbox"
                    checked={!!selected}
                    disabled={locked}
                    onChange={e =>
                      journey?.select(
                        option.assemblyId,
                        e.target.checked ? 1 : null
                      )
                    }
                  />
                  {option.name}
                </label>
                {selected && (
                  <label className="flex items-center gap-2 text-sm">
                    Quantity for {option.name}
                    <input
                      aria-label={`Quantity for ${option.name}`}
                      type="number"
                      min={1}
                      max={100}
                      step={1}
                      value={selected.quantity}
                      disabled={locked}
                      onChange={e =>
                        journey?.select(
                          option.assemblyId,
                          e.target.valueAsNumber
                        )
                      }
                      className="w-24 rounded border bg-background p-2"
                    />
                    {option.unit}
                  </label>
                )}
              </div>
            );
          })}
          <Button
            disabled={!state.selections.length || locked}
            onClick={() => void journey?.calculate()}
          >
            {state.busy ? "Calculating…" : result ? "Recalculate" : "Calculate"}
          </Button>
        </section>
      )}
      {result && (
        <section
          aria-label="Calculation result"
          className="rounded-xl border bg-card p-4 space-y-4"
        >
          <h2 className="font-semibold">Simulation</h2>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt>Total cost</dt>
            <dd>{money(result.financials.costMinor)}</dd>
            <dt>Total price</dt>
            <dd>{money(result.financials.priceMinor)}</dd>
            <dt>Gross profit</dt>
            <dd>{money(result.financials.profitMinor)}</dd>
            <dt>Gross margin</dt>
            <dd>
              {result.financials.grossProfitPct.toLocaleString(undefined, {
                maximumFractionDigits: 6,
              })}
              %
            </dd>
          </dl>
          <p className="text-xs text-muted-foreground">
            Evaluated {result.provenance.evaluationDate} (
            {result.provenance.timeZone}).
          </p>
          {result.warnings.length > 0 && (
            <p
              role="alert"
              className="rounded-lg border border-amber-500 p-3 text-sm"
            >
              Margin is below a policy or assembly threshold. You may save a
              draft for review. This does not approve the estimate or authorize
              construction.
            </p>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input
              id="calculator-confirm"
              type="checkbox"
              checked={state.confirmed}
              disabled={locked}
              onChange={e => journey?.confirm(e.target.checked)}
            />
            I reviewed this calculation and want to save this draft.
          </label>
          <Button
            disabled={locked || !state.confirmed}
            onClick={() => void journey?.save()}
          >
            Save draft
          </Button>
        </section>
      )}
      <section
        aria-label="Recover a saved draft"
        className="rounded-xl border bg-card p-4 space-y-3"
      >
        <h2 className="font-semibold">Check a save result</h2>
        <p className="text-sm text-muted-foreground">
          Keep the request ID and both project/intake IDs. Local recovery
          details expire after 24 hours; you can still enter a recorded request
          ID here. Checking never submits a draft.
        </p>
        {state.intent ? (
          <p className="text-sm break-all">
            Request ID:{" "}
            <strong id="calculator-request-id">
              {state.intent.command.requestId}
            </strong>
          </p>
        ) : (
          <label className="block text-sm">
            Recorded request ID
            <input
              id="calculator-recovery-request"
              value={manualRequestId}
              onChange={e => setManualRequestId(e.target.value)}
              className="mt-1 block w-full rounded border bg-background p-2"
              placeholder="Request UUID"
              disabled={state.busy}
            />
          </label>
        )}
        <Button
          variant="outline"
          disabled={
            !journey || state.busy || (!state.intent && !manualRequestId)
          }
          onClick={() => void journey?.recover(manualRequestId)}
        >
          Check saved result
        </Button>
        {receipt?.status === "confirmed" &&
          receipt.draft &&
          receipt.creation && (
            <div role="status" className="space-y-1 text-sm break-all">
              <p>
                Confirmed draft:{" "}
                <strong id="calculator-draft-id">{receipt.draft.id}</strong>
              </p>
              <p>
                Current status: {receipt.draft.status} · Version{" "}
                {receipt.draft.version}
              </p>
              {receipt.draft.supersededBy && (
                <p>Superseded by: {receipt.draft.supersededBy}</p>
              )}
              <p>Request ID: {receipt.requestId}</p>
              <p>Created: {receipt.creation.createdAt}</p>
              <p>Draft review and approval are separate steps.</p>
              <Button
                variant="outline"
                onClick={() => {
                  const path = journey?.confirmedDraftPath();
                  if (path) navigate(path);
                }}
              >
                Open confirmed draft
              </Button>
            </div>
          )}
      </section>
    </div>
  );
}
