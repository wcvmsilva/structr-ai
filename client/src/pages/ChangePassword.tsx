import { useEffect } from "react";
import { Link, useLocation } from "wouter";
import ChangePasswordForm from "@/components/ChangePasswordForm";
import { useAuth } from "@/_core/hooks/useAuth";
import { IS_SUPABASE_AUTH } from "@/const";

export default function ChangePassword() {
  const [, setLocation] = useLocation();
  const { loading, isAuthenticated } = useAuth();

  useEffect(() => {
    if (!loading && (!IS_SUPABASE_AUTH || !isAuthenticated))
      setLocation("/login");
  }, [loading, isAuthenticated, setLocation]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <section className="w-full max-w-md space-y-6 rounded-lg border border-border p-8">
        <h1 className="text-xl font-semibold">Change password</h1>
        {loading ? (
          <p role="status" className="text-sm">
            Checking your account access…
          </p>
        ) : IS_SUPABASE_AUTH && isAuthenticated ? (
          <>
            <p className="text-sm text-muted-foreground">
              Confirm your current password and choose a new one with at least 8
              characters.
            </p>
            <ChangePasswordForm />
            <Link href="/" className="block text-sm text-gold underline">
              Back to dashboard
            </Link>
          </>
        ) : (
          <p className="text-sm">Sign in to change your password.</p>
        )}
      </section>
    </main>
  );
}
