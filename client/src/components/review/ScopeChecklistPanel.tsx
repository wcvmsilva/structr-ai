import { useId, type ReactNode } from "react";
import { trpc } from "@/lib/trpc";
import { formatCents } from "@shared/actuals-variance-engine";

function numericMetadata(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Historical tenant patterns; this panel does not certify or approve the current scope. */
export function ScopeChecklistPanel({ projectId }: { projectId: string }) {
  const headingId = useId();
  const projectQuery = trpc.project.getById.useQuery(
    { id: projectId },
    { enabled: Boolean(projectId), placeholderData: undefined }
  );
  const projectFailed = Boolean(projectQuery.isError || projectQuery.error);
  const projectLoading =
    projectQuery.isPending ||
    projectQuery.isLoading ||
    projectQuery.isFetching ||
    (!projectQuery.isSuccess && !projectFailed);
  const currentProject =
    !projectFailed && !projectLoading && projectQuery.data?.id === projectId;
  const projectType =
    currentProject && typeof projectQuery.data?.projectType === "string"
      ? projectQuery.data.projectType.trim()
      : "";
  const checklistEnabled = Boolean(
    currentProject && projectType && projectType.length <= 100
  );
  const checklistQuery = trpc.scopeCompleteness.getChecklist.useQuery(
    { projectType },
    { enabled: checklistEnabled, placeholderData: undefined }
  );

  const loading = (
    <p role="status" className="text-sm text-muted-foreground">
      Loading historical omissions...
    </p>
  );
  const checklistUnavailable = (
    <div role="alert" className="space-y-2 text-sm">
      <p>Unable to load historical omissions. Try again.</p>
      <button
        type="button"
        aria-label="Retry historical omissions"
        disabled={checklistQuery.isFetching}
        onClick={() => void checklistQuery.refetch()}
        className="text-gold underline disabled:opacity-50"
      >
        Try again
      </button>
    </div>
  );
  let content: ReactNode;

  // A failed or disabled prerequisite must never expose a dependent query's cached list.
  if (projectFailed || (!projectLoading && !currentProject)) {
    content = (
      <div role="alert" className="space-y-2 text-sm">
        <p>
          Unable to load project details for historical omissions. Try again.
        </p>
        <button
          type="button"
          aria-label="Retry project details"
          disabled={projectQuery.isFetching}
          onClick={() => void projectQuery.refetch()}
          className="text-gold underline disabled:opacity-50"
        >
          Try again
        </button>
      </div>
    );
  } else if (projectLoading) {
    content = loading;
  } else if (!checklistEnabled) {
    content = (
      <p className="text-sm text-muted-foreground">
        Project type is unavailable. Historical omissions cannot be loaded.
      </p>
    );
  } else if (checklistQuery.isError || checklistQuery.error) {
    content = checklistUnavailable;
  } else if (
    !checklistQuery.isSuccess ||
    checklistQuery.isPending ||
    checklistQuery.isLoading ||
    checklistQuery.isFetching
  ) {
    content = loading;
  } else if (
    !checklistQuery.data ||
    checklistQuery.data.projectType.trim().toLowerCase() !==
      projectType.toLowerCase()
  ) {
    content = checklistUnavailable;
  } else if (checklistQuery.data.items.length === 0) {
    content = (
      <p className="text-sm text-muted-foreground">
        No recurring omissions recorded for this project type yet.
      </p>
    );
  } else {
    content = (
      <ol className="space-y-3">
        {checklistQuery.data.items.map(item => {
          const occurrences = numericMetadata(item.occurrenceCount);
          const projects = numericMetadata(item.projectCount);
          const frequency = numericMetadata(item.frequency);
          const averageCents = numericMetadata(item.avgUnplannedCents);
          return (
            <li
              key={item.id}
              className="rounded-lg border border-border/60 p-3 space-y-1.5"
            >
              <p className="font-medium text-sm text-foreground">
                {item.costCode}
                {item.costCodeName?.trim() ? ` — ${item.costCodeName}` : ""}
              </p>
              <p className="text-sm text-muted-foreground">
                {item.suggestion?.trim()
                  ? item.suggestion
                  : "Historical suggestion unavailable."}
              </p>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>
                  {occurrences === null || projects === null
                    ? "Occurrences unavailable"
                    : `${occurrences} of ${projects} projects`}
                </span>
                <span>
                  {frequency === null
                    ? "Frequency unavailable"
                    : `Frequency: ${(frequency * 100).toLocaleString("en-US", { maximumFractionDigits: 1 })}%`}
                </span>
                <span>
                  {averageCents === null
                    ? "Average historical omission cost unavailable"
                    : `Average historical omission cost: $${formatCents(averageCents)}`}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    );
  }

  return (
    <section
      aria-labelledby={headingId}
      className="rounded-xl border border-border bg-card p-4 space-y-3"
    >
      <div className="space-y-1">
        <h3 id={headingId} className="text-sm font-semibold text-foreground">
          Recurring omissions to review
        </h3>
        <p className="text-xs text-muted-foreground">
          Historical patterns for this project type. Review whether they apply
          to this scope.
        </p>
      </div>
      {content}
    </section>
  );
}
