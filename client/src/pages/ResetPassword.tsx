import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { IS_SUPABASE_AUTH } from "@/const";
import {
  getPasswordRecoverySnapshot,
  subscribePasswordRecovery,
  submitRecoveredPassword,
  exitPasswordRecovery,
} from "@/lib/password-recovery-session";

export default function ResetPassword() {
  const [, setLocation] = useLocation();
  const recovery = useSyncExternalStore(
    subscribePasswordRecovery,
    getPasswordRecoverySnapshot,
    getPasswordRecoverySnapshot
  );
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [exiting, setExiting] = useState(false);
  const inFlight = useRef(false);
  const exitInFlight = useRef(false);
  const hasForm =
    IS_SUPABASE_AUTH &&
    recovery.active &&
    (recovery.status === "ready" ||
      recovery.status === "error" ||
      recovery.status === "submitting");
  const canSubmit =
    hasForm && recovery.status !== "submitting" && !pending && !exiting;

  useEffect(() => {
    if (hasForm) return;
    setPassword("");
    setConfirmation("");
    setMessage(null);
  }, [hasForm]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit || inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setMessage(null);
    try {
      const result = await submitRecoveredPassword(password, confirmation);
      setMessage(result.message);
      if (result.ok) {
        setPassword("");
        setConfirmation("");
      }
    } catch {
      setMessage(
        "Unable to update your password. Try again or request a new link."
      );
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  async function finishRecovery(destination: string) {
    if (exitInFlight.current) return;
    exitInFlight.current = true;
    setExiting(true);
    setPassword("");
    setConfirmation("");
    try {
      await exitPasswordRecovery();
      setLocation(destination);
    } catch {
      setMessage("Unable to finish signing out. Try again.");
    } finally {
      exitInFlight.current = false;
      setExiting(false);
    }
  }
  async function handleExit() {
    await finishRecovery("/login");
  }
  async function handleNewLink() {
    await finishRecovery("/forgot-password");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <section className="w-full max-w-md space-y-6 rounded-lg border border-border p-8">
        <h1 className="text-xl font-semibold">Reset password</h1>
        {hasForm ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-password">New password</Label>
              <Input
                id="new-password"
                name="password"
                type="password"
                autoComplete="new-password"
                required
                value={password}
                onChange={event => setPassword(event.target.value)}
                disabled={!canSubmit}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm new password</Label>
              <Input
                id="confirm-password"
                name="confirmation"
                type="password"
                autoComplete="new-password"
                required
                value={confirmation}
                onChange={event => setConfirmation(event.target.value)}
                disabled={!canSubmit}
              />
            </div>
            <Button type="submit" className="w-full" disabled={!canSubmit}>
              {pending || recovery.status === "submitting"
                ? "Updating password…"
                : "Update password"}
            </Button>
          </form>
        ) : recovery.status !== "complete" ? (
          <p className="text-sm text-muted-foreground">
            Open the latest reset link in the browser where you requested it. If
            it has expired or was already used, request a new link.
          </p>
        ) : null}
        {(message ?? recovery.message) && (
          <p
            role={recovery.status === "complete" ? "status" : "alert"}
            className="text-sm"
          >
            {message ?? recovery.message}
          </p>
        )}
        {!hasForm && recovery.status !== "complete" && IS_SUPABASE_AUTH && (
          <Button
            type="button"
            variant="link"
            onClick={handleNewLink}
            disabled={exiting}
          >
            Request a new reset link
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={handleExit}
          disabled={exiting}
        >
          {exiting ? "Signing out…" : "Back to sign in"}
        </Button>
      </section>
    </main>
  );
}
