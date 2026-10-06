/** Real Projects form markup and callbacks with synthetic transport and explicit
 * state rerenders; this proves payloads and field behavior, not browser scheduling. */
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const io = vi.hoisted(() => ({
  projects: vi.fn(), clients: vi.fn(), create: vi.fn(), update: vi.fn(), error: vi.fn(),
  slots: [] as unknown[], cursor: 0,
}));
vi.mock("react", async importOriginal => ({
  ...await importOriginal<typeof import("react")>(),
  useMemo: (calculate: () => unknown) => calculate(),
  useState(initial: unknown) {
    const index = io.cursor++;
    if (!(index in io.slots)) io.slots[index] = typeof initial === "function" ? initial() : initial;
    return [io.slots[index], (value: unknown) => {
      io.slots[index] = typeof value === "function" ? value(io.slots[index]) : value;
    }];
  },
}));
vi.mock("@/lib/trpc", () => ({ trpc: {
  useUtils: () => ({ project: { list: { invalidate: vi.fn() } } }),
  clients: { list: { useQuery: io.clients } },
  project: {
    list: { useQuery: io.projects },
    create: { useMutation: () => ({ mutate: io.create, isPending: false }) },
    update: { useMutation: () => ({ mutate: io.update, isPending: false }) },
    updateStatus: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    delete: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    geocode: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
  },
} }));
vi.mock("sonner", () => ({ toast: { error: io.error, success: vi.fn(), warning: vi.fn() } }));
import ProjectsPage from "../client/src/pages/Projects";

const PROJECT = "bd100000-0000-4000-8000-000000000001";
const CLIENT = "bd100000-0000-4000-8000-000000000002";
const OTHER_CLIENT = "bd100000-0000-4000-8000-000000000003";
const project = { id: PROJECT, name: "Existing job", clientId: CLIENT, zip: "29401", status: "intake" };

function text(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (isValidElement<{ children?: ReactNode }>(node)) return text(node.props.children);
  return Children.toArray(node).map(child => isValidElement(child) ? text(child) : String(child)).join("");
}
function find(tree: ReactNode, match: (element: ReactElement<Record<string, any>>) => boolean): ReactElement<Record<string, any>> {
  let found: ReactElement<Record<string, any>> | undefined;
  function visit(node: ReactNode) {
    if (found || !isValidElement<Record<string, any>>(node)) return;
    if (match(node)) { found = node; return; }
    Children.forEach(node.props.children, visit);
  }
  visit(tree);
  if (!found) throw new Error("Expected project form control was not rendered");
  return found;
}
function render() {
  io.cursor = 0;
  return ProjectsPage();
}
function button(label: string) {
  return find(render(), element => element.type === "button" && text(element.props.children).includes(label));
}
function field(label: string, value: string) {
  find(render(), element => element.props.label === label).props.onChange(value);
}
function clientSelect() {
  return find(render(), element => element.type === "select" && Children.toArray(element.props.children).some(child =>
    isValidElement<Record<string, any>>(child) && child.props.value === CLIENT,
  ));
}
function submit() {
  find(render(), element => element.type === "form").props.onSubmit({ preventDefault: vi.fn() });
}
function startNew() {
  button("New Project").props.onClick();
  field("Project Name", "New job");
}
function startEdit() {
  button("Existing job").props.onClick();
  button("Edit").props.onClick();
}

beforeEach(() => {
  vi.clearAllMocks(); io.slots = []; io.cursor = 0;
  io.projects.mockReturnValue({ data: { items: [project], total: 1 }, isLoading: false });
  io.clients.mockReturnValue({ data: { items: [
    { id: CLIENT, name: "Alex Owner", company: "Owner Company" },
    { id: OTHER_CLIENT, name: "Blair Owner", company: null },
  ], total: 2 } });
});

describe("Projects form client and ZIP contract", () => {
  it("renders persisted client names/company instead of absent legacy name fields", () => {
    startNew();
    expect(renderToStaticMarkup(render())).toContain("Alex Owner (Owner Company)");
  });

  it("keeps a selected UUID as a string and submits it with create's canonical ZIP field", () => {
    startNew();
    clientSelect().props.onChange({ target: { value: CLIENT } });
    field("ZIP Code", "29401");
    expect(clientSelect().props.value).toBe(CLIENT);
    submit();
    expect(io.create).toHaveBeenCalledWith(expect.objectContaining({ name: "New job", clientId: CLIENT, zip: "29401" }));
    expect(io.create.mock.calls[0][0]).not.toHaveProperty("zipCode");
  });

  it("clears a create-time selection without inventing a client reference", () => {
    startNew();
    clientSelect().props.onChange({ target: { value: CLIENT } });
    clientSelect().props.onChange({ target: { value: "" } });
    submit();
    expect(io.create.mock.calls[0][0].clientId ?? null).toBeNull();
  });

  it("prefills an existing project's persisted ZIP and displays it in project details", () => {
    button("Existing job").props.onClick();
    expect(renderToStaticMarkup(render())).toContain("29401");
    button("Edit").props.onClick();
    expect(find(render(), element => element.props.label === "ZIP Code").props.value).toBe("29401");
  });

  it("disables client selection while editing and never submits a reassignment", () => {
    startEdit();
    expect(clientSelect().props.disabled).toBe(true);
    field("ZIP Code", "29402");
    submit();
    expect(io.update).toHaveBeenCalledWith({ id: PROJECT, data: expect.objectContaining({ zipCode: "29402" }) });
    expect(io.update.mock.calls[0][0].data).not.toHaveProperty("clientId");
  });
});
