import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { IS_SUPABASE_AUTH } from "@/const";
import { changeCurrentPassword } from "@/lib/password-change-session";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

export default function ChangePasswordForm() {
  const { loading, isAuthenticated, user } = useAuth();
  const identity =
    IS_SUPABASE_AUTH && !loading && isAuthenticated ? (user?.id ?? null) : null;
  const allowed = identity !== null;
  const [formIdentity, setFormIdentity] = useState(identity);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(
    null
  );
  const inFlight = useRef(false);
  const mounted = useRef(false);
  const revision = useRef(0);
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  const ownsFields = formIdentity === identity;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      revision.current += 1;
      inFlight.current = false;
    };
  }, []);

  useEffect(() => {
    revision.current += 1;
    inFlight.current = false;
    setPending(false);
    setFormIdentity(identity);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmation("");
    setResult(null);
  }, [identity]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!allowed || !ownsFields || !mounted.current || inFlight.current) return;
    const invalid = !currentPassword
      ? "Enter your current password."
      : newPassword.length < 8
        ? "Use at least 8 characters for your new password."
        : newPassword !== confirmation
          ? "New passwords do not match."
          : newPassword === currentPassword
            ? "Choose a new password different from your current password."
            : null;
    if (invalid) {
      setResult({ ok: false, message: invalid });
      return;
    }

    inFlight.current = true;
    const attempt = ++revision.current;
    const isCurrent = () =>
      mounted.current &&
      revision.current === attempt &&
      currentIdentity.current === identity;
    setPending(true);
    setResult(null);
    try {
      const outcome = await changeCurrentPassword(
        currentPassword,
        newPassword,
        confirmation
      );
      if (!isCurrent()) return;
      setResult(outcome);
      if (outcome.ok) {
        setCurrentPassword("");
        setNewPassword("");
        setConfirmation("");
      }
    } catch {
      if (isCurrent())
        setResult({
          ok: false,
          message:
            "Unable to change your password. Try again or sign in again.",
        });
    } finally {
      if (isCurrent()) {
        inFlight.current = false;
        setPending(false);
      }
    }
  }

  if (!allowed) return null;
  return (
    <form
      aria-label="Change password"
      onSubmit={handleSubmit}
      className="space-y-4"
    >
      <div className="space-y-2">
        <Label htmlFor="change-current-password">Current password</Label>
        <Input
          id="change-current-password"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          maxLength={1024}
          required
          value={ownsFields ? currentPassword : ""}
          onChange={event => setCurrentPassword(event.target.value)}
          disabled={pending || !ownsFields}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="change-new-password">New password</Label>
        <Input
          id="change-new-password"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          minLength={8}
          maxLength={128}
          required
          value={ownsFields ? newPassword : ""}
          onChange={event => setNewPassword(event.target.value)}
          disabled={pending || !ownsFields}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="change-confirm-password">Confirm new password</Label>
        <Input
          id="change-confirm-password"
          name="confirmation"
          type="password"
          autoComplete="new-password"
          minLength={8}
          maxLength={128}
          required
          value={ownsFields ? confirmation : ""}
          onChange={event => setConfirmation(event.target.value)}
          disabled={pending || !ownsFields}
        />
      </div>
      {ownsFields && result && (
        <p role={result.ok ? "status" : "alert"} className="text-sm">
          {result.message}
        </p>
      )}
      <Button
        type="submit"
        className="w-full"
        disabled={pending || !ownsFields}
      >
        {pending ? "Changing password…" : "Change password"}
      </Button>
    </form>
  );
}
