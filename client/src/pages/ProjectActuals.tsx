/** Existing cost facts remain visible while execution authority is unavailable in A1. */
import { useState } from 'react';
import { useSearch } from 'wouter';
import { z } from 'zod';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { ACTUAL_COST_CATEGORIES } from '@shared/domain/phase3-taxonomy';
import { formatCents } from '@shared/actuals-variance-engine';

const formSchema = z.object({
  projectId: z.string().uuid('Select a project.'),
  costCode: z.string().trim().min(1, 'Cost code is required.').max(64),
  vendorName: z.string().trim().min(1, 'Payee is required.').max(255),
  description: z.string().trim().max(2000),
  category: z.enum(ACTUAL_COST_CATEGORIES),
  amount: z.string().trim().regex(/^\d+(?:\.\d{1,2})?$/, 'Enter a dollar amount with at most two decimals.')
    .refine(value => Number(value) <= 20_000_000, 'Amount exceeds the supported limit.'),
  dateIncurred: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Select the date incurred.')
    .refine(value => { const date = new Date(`${value}T00:00:00Z`); return !isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value; }, 'Select a valid date.'),
  invoiceRef: z.string().trim().max(128),
  notes: z.string().trim().max(5000),
});
export type ActualForm = z.input<typeof formSchema>;
export function buildActualPayload(input: ActualForm) {
  const form = formSchema.parse(input);
  const [dollars, fraction = ''] = form.amount.split('.');
  return {
    projectId: form.projectId, costCode: form.costCode, vendorName: form.vendorName,
    description: form.description || undefined, category: form.category,
    amountCents: Number(dollars) * 100 + Number(fraction.padEnd(2, '0')),
    dateIncurred: form.dateIncurred, invoiceRef: form.invoiceRef || undefined, notes: form.notes || undefined,
  };
}
export default function ProjectActualsPage() {
  const search = useSearch();
  const [projectId, setProjectId] = useState(() => new URLSearchParams(search).get('projectId') ?? '');
  const [offset, setOffset] = useState(0);
  const projects = trpc.project.list.useQuery({ limit: 100 });
  const validProject = z.string().uuid().safeParse(projectId).success;
  const actuals = trpc.actuals.list.useQuery({ projectId, limit: 50, offset }, { enabled: validProject });
  return <div className="space-y-6 max-w-4xl">
    <div><h1 className="text-2xl font-bold">Project Actuals</h1><p className="text-sm text-muted-foreground">Review the project’s recorded costs and historical budget references.</p></div>
    <div className="flex gap-3 items-end"><div className="flex-1 space-y-2">
      <Label htmlFor="actual-project">Project</Label>
      <select id="actual-project" value={projectId} onChange={event => { setProjectId(event.target.value); setOffset(0); }} className="w-full rounded-md border border-border bg-background p-2">
        <option value="">Select a project</option>
        {(projects.data?.items ?? []).map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
      </select>
    </div><Button disabled aria-describedby="actual-authority">Record Cost</Button></div>
    <p id="actual-authority" role="status" className="text-sm text-muted-foreground">Awaiting execution authorization. Cost recording and approval are unavailable; existing records remain visible.</p>
    {projects.isError && <p role="alert">Unable to load projects. Try again.</p>}
    {!validProject ? <p>Select a project to view its cost ledger.</p> : <>
      {actuals.isError ? <p role="alert">Unable to load costs. Try again.</p> : actuals.isLoading ? <p role="status">Loading costs…</p> : <>
        {(actuals.data?.actuals ?? []).length === 0 ? <p>No costs recorded on this page.</p> : <div className="space-y-3">{actuals.data?.actuals.map(actual => <article key={actual.id} className="rounded-xl border border-border p-4">
          <div className="flex justify-between gap-4"><div><h2 className="font-semibold">{actual.costCode} · {actual.vendorName}</h2><p>{actual.description}</p><p className="text-sm text-muted-foreground">{actual.dateIncurred} · {actual.status}</p></div><strong>${formatCents(actual.amountCents)}</strong></div>
          <p className="text-sm text-muted-foreground">Historical budget reference: {actual.estimatedAmountCents == null ? 'Unavailable' : formatCents(actual.estimatedAmountCents)} · Recorded variance: {actual.varianceCents == null ? 'Unavailable' : formatCents(actual.varianceCents)}</p>
        </article>)}</div>}
        <div className="flex gap-3"><Button variant="outline" disabled={offset === 0} onClick={() => setOffset(value => Math.max(0, value - 50))}>Previous</Button><Button variant="outline" disabled={(actuals.data?.actuals.length ?? 0) < 50} onClick={() => setOffset(value => value + 50)}>Next</Button></div>
      </>}
    </>}
  </div>;
}
