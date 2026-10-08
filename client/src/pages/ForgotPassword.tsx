import { useRef, useState, type FormEvent } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { IS_SUPABASE_AUTH } from "@/const";
import { requestPasswordRecovery } from "@/lib/password-recovery-session";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(
    null
  );
  const inFlight = useRef(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!IS_SUPABASE_AUTH || inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setResult(null);
    try {
      setResult(await requestPasswordRecovery(email));
    } catch {
      setResult({
        ok: false,
        message: "Unable to request a reset link. Try again shortly.",
      });
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <section className="w-full max-w-md space-y-6 rounded-lg border border-border p-8">
        <h1 className="text-xl font-semibold">Forgot password</h1>
        {IS_SUPABASE_AUTH ? (
          <>
            <p className="text-sm text-muted-foreground">
              Request a reset link, then open it in this browser to choose a new
              password.
            </p>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="recovery-email">Email</Label>
                <Input
                  id="recovery-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={event => setEmail(event.target.value)}
                  disabled={pending}
                />
              </div>
              {result && (
                <p role={result.ok ? "status" : "alert"} className="text-sm">
                  {result.message}
                </p>
              )}
              <Button type="submit" className="w-full" disabled={pending}>
                {pending ? "Requesting link…" : "Send reset link"}
              </Button>
            </form>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Password recovery is managed by your sign-in provider.
          </p>
        )}
        <Link href="/login" className="block text-sm text-gold underline">
          Back to sign in
        </Link>
      </section>
    </main>
  );
}
