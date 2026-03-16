import { cn } from "@/lib/utils";
import { Settings, Shield, Database, Percent, Users, Bell, Globe } from "lucide-react";
import { toast } from "sonner";

const settingsGroups = [
  {
    title: "Company Profile",
    icon: Shield,
    items: [
      { label: "Company Name", value: "structr.ai", editable: false },
      { label: "Region", value: "Charleston, SC (Lowcountry)", editable: false },
      { label: "License", value: "SC General Contractor", editable: false },
    ],
  },
  {
    title: "Profit Protection",
    icon: Percent,
    items: [
      { label: "Minimum Gross Profit", value: "35%", editable: true },
      { label: "Default Bundle Discount", value: "8%", editable: true },
      { label: "Auto-Adjust Enabled", value: "Yes", editable: true },
    ],
  },
  {
    title: "Database",
    icon: Database,
    items: [
      { label: "Cost Codes", value: "426 active", editable: false },
      { label: "Assemblies", value: "15 active", editable: false },
      { label: "Bundles", value: "3 preset", editable: false },
      { label: "Pricing Region", value: "Charleston, SC — 2026", editable: false },
    ],
  },
  {
    title: "Integrations",
    icon: Globe,
    items: [
      { label: "JobTread", value: "CSV Export Ready", editable: false },
      { label: "QuickBooks", value: "Not Connected", editable: true },
      { label: "Supabase", value: "Connected", editable: false },
    ],
  },
  {
    title: "Notifications",
    icon: Bell,
    items: [
      { label: "Email Alerts", value: "Enabled", editable: true },
      { label: "Review Notifications", value: "Enabled", editable: true },
    ],
  },
  {
    title: "User Management",
    icon: Users,
    items: [
      { label: "Active Users", value: "1 (admin)", editable: false },
      { label: "Roles", value: "Admin, Estimator, Reviewer, Viewer", editable: false },
    ],
  },
];

export default function SettingsPage() {
  const handleEdit = (label: string) => {
    toast("Feature coming soon", {
      description: `Editing "${label}" will be available in the next sprint.`,
    });
  };

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      {/* Page Header */}
      <div>
        <div className="flex items-center gap-3">
          <Settings className="h-6 w-6 text-gold" />
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Settings
          </h1>
        </div>
        <p className="text-sm text-muted-foreground mt-1 ml-9">
          System configuration and integrations
        </p>
        <div className="h-[2px] w-48 mt-3 ml-9 bg-gradient-to-r from-gold via-gold/50 to-transparent" />
      </div>

      {/* Settings Groups */}
      {settingsGroups.map((group) => (
        <div key={group.title}>
          <div className="flex items-center gap-3 mb-3">
            <group.icon className="h-4 w-4 text-gold" />
            <span className="text-[0.8rem] font-bold uppercase tracking-[0.06em] text-gold whitespace-nowrap">
              {group.title}
            </span>
            <div className="h-px flex-1 bg-gradient-to-r from-gold/35 to-transparent" />
          </div>

          <div className="rounded-xl border border-border overflow-hidden">
            {group.items.map((item, i) => (
              <div
                key={item.label}
                className={cn(
                  "flex items-center justify-between px-5 py-3.5",
                  i < group.items.length - 1 && "border-b border-border/50",
                  "hover:bg-surface-hover transition-colors"
                )}
              >
                <div>
                  <p className="text-sm font-medium text-foreground">{item.label}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-muted-foreground font-mono">
                    {item.value}
                  </span>
                  {item.editable && (
                    <button
                      onClick={() => handleEdit(item.label)}
                      className={cn(
                        "text-[0.7rem] font-semibold text-gold",
                        "hover:text-gold-light transition-colors"
                      )}
                    >
                      Edit
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Version Info */}
      <div className="text-center py-4">
        <p className="text-[0.65rem] font-mono text-muted-foreground/40 tracking-wider">
          structr.ai v9.0 — CONSTRUCTION BRAIN ENGINE
        </p>
      </div>
    </div>
  );
}
