/** Real costs use the Phase 3 project ledger and its server-owned approved budget. */
import { useState } from 'react';
import { useSearch } from 'wouter';
import { z } from 'zod';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ACTUAL_COST_CATEGORIES } from '@shared/domain/phase3-taxonomy';
import { formatCents } from '@shared/actuals-variance-engine';
import { toast } from 'sonner';

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
const emptyForm = { costCode: '', vendorName: '', description: '', amount: '', category: 'labor' as const, dateIncurred: '', invoiceRef: '', notes: '' };
export default function ProjectActualsPage() {
  const search = useSearch();
  const [projectId, setProjectId] = useState(() => new URLSearchParams(search).get('projectId') ?? '');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<Omit<ActualForm, 'projectId'>>(emptyForm);
  const [offset, setOffset] = useState(0);
  const projects = trpc.project.list.useQuery({ limit: 100 });
  const validProject = z.string().uuid().safeParse(projectId).success;
  const actuals = trpc.actuals.list.useQuery({ projectId, limit: 50, offset }, { enabled: validProject });
  const utils = trpc.useUtils();
  const record = trpc.actuals.record.useMutation({
    onSuccess: async () => {
      toast.success('Cost recorded for approval'); setForm(emptyForm); setShowForm(false);
      await utils.actuals.list.invalidate({ projectId });
    },
    onError: error => toast.error(error.message),
  });
  const update = (key: keyof typeof form, value: string) => setForm(previous => ({ ...previous, [key]: value }));
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    try { record.mutate(buildActualPayload({ ...form, projectId })); }
    catch (error) { toast.error(error instanceof z.ZodError ? error.issues[0].message : 'Check the cost details.'); }
  };
  return <div className="space-y-6 max-w-4xl">
    <div><h1 className="text-2xl font-bold">Project Actuals</h1><p className="text-sm text-muted-foreground">Record real costs against the project’s approved estimate. New costs remain pending until approved.</p></div>
    <div className="flex gap-3 items-end"><div className="flex-1 space-y-2">
      <Label htmlFor="actual-project">Project</Label>
      <select id="actual-project" value={projectId} onChange={event => { setProjectId(event.target.value); setOffset(0); setShowForm(false); setForm(emptyForm); }} className="w-full rounded-md border border-border bg-background p-2">
        <option value="">Select a project</option>
        {(projects.data?.items ?? []).map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
      </select>
    </div><Button disabled={!validProject || record.isPending} onClick={() => setShowForm(value => !value)}>Record Cost</Button></div>
    {projects.isError && <p role="alert">Unable to load projects. Try again.</p>}
    {!validProject ? <p>Select a project to view its cost ledger.</p> : <>
      {showForm && <form onSubmit={submit} className="rounded-xl border border-border p-4 space-y-4">
        <p className="text-sm text-muted-foreground">The server resolves the approved estimate and budget. A cost code, payee, amount, and date are required.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2"><Label htmlFor="cost-code">Cost code</Label><Input id="cost-code" required value={form.costCode} onChange={e => update('costCode', e.target.value)} /></div>
          <div className="space-y-2"><Label htmlFor="payee">Payee</Label><Input id="payee" required value={form.vendorName} onChange={e => update('vendorName', e.target.value)} /></div>
          <div className="space-y-2"><Label htmlFor="actual-amount">Cost (USD)</Label><Input id="actual-amount" inputMode="decimal" required value={form.amount} onChange={e => update('amount', e.target.value)} /></div>
          <div className="space-y-2"><Label htmlFor="cost-date">Date incurred</Label><Input id="cost-date" type="date" required value={form.dateIncurred} onChange={e => update('dateIncurred', e.target.value)} /></div>
          <div className="space-y-2"><Label htmlFor="cost-category">Category</Label><select id="cost-category" value={form.category} onChange={e => update('category', e.target.value)} className="w-full rounded-md border border-border bg-background p-2">{ACTUAL_COST_CATEGORIES.map(category => <option key={category} value={category}>{category.replaceAll('_', ' ')}</option>)}</select></div>
          <div className="space-y-2"><Label htmlFor="invoice-ref">Invoice reference</Label><Input id="invoice-ref" value={form.invoiceRef} onChange={e => update('invoiceRef', e.target.value)} /></div>
        </div>
        <div className="space-y-2"><Label htmlFor="cost-description">Description</Label><Input id="cost-description" value={form.description} onChange={e => update('description', e.target.value)} /></div>
        <div className="space-y-2"><Label htmlFor="cost-notes">Notes</Label><Textarea id="cost-notes" value={form.notes} onChange={e => update('notes', e.target.value)} /></div>
        <div className="flex gap-3"><Button type="submit" disabled={record.isPending}>{record.isPending ? 'Recording…' : 'Save for approval'}</Button><Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancel</Button></div>
      </form>}
      {actuals.isError ? <p role="alert">Unable to load costs. Try again.</p> : actuals.isLoading ? <p role="status">Loading costs…</p> : <>
        {(actuals.data?.actuals ?? []).length === 0 ? <p>No costs recorded on this page.</p> : <div className="space-y-3">{actuals.data?.actuals.map(actual => <article key={actual.id} className="rounded-xl border border-border p-4">
          <div className="flex justify-between gap-4"><div><h2 className="font-semibold">{actual.costCode} · {actual.vendorName}</h2><p>{actual.description}</p><p className="text-sm text-muted-foreground">{actual.dateIncurred} · {actual.status}</p></div><strong>${formatCents(actual.amountCents)}</strong></div>
          <p className="text-sm text-muted-foreground">Budget reference: {actual.estimatedAmountCents == null ? 'Unavailable' : formatCents(actual.estimatedAmountCents)} · Variance: {actual.varianceCents == null ? 'Unavailable' : formatCents(actual.varianceCents)}</p>
        </article>)}</div>}
        <div className="flex gap-3"><Button variant="outline" disabled={offset === 0} onClick={() => setOffset(value => Math.max(0, value - 50))}>Previous</Button><Button variant="outline" disabled={(actuals.data?.actuals.length ?? 0) < 50} onClick={() => setOffset(value => value + 50)}>Next</Button></div>
      </>}
    </>}
  </div>;
}
