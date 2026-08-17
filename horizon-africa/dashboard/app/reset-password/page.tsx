"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Loader2, Lock, Eye, EyeOff, ArrowRight, ShieldCheck, CheckCircle2 } from "lucide-react";
import logo from "@/app/assets/logo.png";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [verifying, setVerifying] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event) => {
      if (event === "PASSWORD_RECOVERY") {
        setVerifying(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function handleUpdate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Password must be at least 8 characters long");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);

    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      setSuccess(true);
      setLoading(false);
      setTimeout(() => router.push("/login"), 3000);
    }
  }

  if (verifying) {
    return (
      <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-surface px-4 font-sans">
        <div className="relative z-10 w-full max-w-md">
          <div className="rounded-2xl border border-outline-variant/50 bg-white p-8 shadow-xl">
            <div className="flex flex-col items-center gap-4 py-8">
              <Loader2 className="h-8 w-8 animate-spin text-secondary" />
              <p className="text-sm text-on-surface-variant">Verifying reset link...</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-surface px-4 font-sans">
      <div className="relative z-10 w-full max-w-md">
        <div className="rounded-2xl border border-outline-variant/50 bg-white p-8 shadow-xl">
          <div className="mb-6 flex flex-col items-center">
            <div className="relative mb-4 h-28 w-56">
              <Image
                src={logo}
                alt="Horizon Africa"
                fill
                className="object-contain"
                priority
              />
            </div>
            <div className="text-center">
              <h1 className="mb-1 text-2xl font-semibold text-on-surface">New password</h1>
              <p className="text-sm text-on-surface-variant">
                {success ? "Password updated successfully" : "Enter your new password below"}
              </p>
            </div>
          </div>

          {success ? (
            <div className="space-y-6">
              <div className="flex flex-col items-center gap-3 rounded-lg bg-primary-container/50 px-4 py-6 text-center">
                <CheckCircle2 className="h-10 w-10 text-primary" />
                <p className="text-sm text-on-surface">
                  Your password has been updated successfully.
                </p>
                <p className="text-xs text-on-surface-variant">
                  Redirecting you to login...
                </p>
              </div>
              <Link
                href="/login"
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-3 text-sm font-semibold text-on-primary shadow-lg transition-all hover:brightness-110"
              >
                Go to login
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          ) : (
            <>
              <form onSubmit={handleUpdate} className="space-y-4">
                <div className="space-y-1.5">
                  <label
                    htmlFor="password"
                    className="ml-1 block text-xs font-semibold tracking-wide text-on-surface-variant"
                  >
                    New password
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-on-surface-variant/50" />
                    <input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      minLength={8}
                      className="w-full rounded-lg border border-outline-variant/50 bg-surface-container-low py-2.5 pl-10 pr-12 text-sm text-on-surface outline-none transition-all placeholder:text-on-surface-variant/50 focus:border-secondary focus:ring-2 focus:ring-secondary/20"
                      placeholder="At least 8 characters"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant/50 transition-colors hover:text-on-surface"
                    >
                      {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="confirmPassword"
                    className="ml-1 block text-xs font-semibold tracking-wide text-on-surface-variant"
                  >
                    Confirm new password
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-on-surface-variant/50" />
                    <input
                      id="confirmPassword"
                      type={showPassword ? "text" : "password"}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                      minLength={8}
                      className="w-full rounded-lg border border-outline-variant/50 bg-surface-container-low py-2.5 pl-10 pr-4 text-sm text-on-surface outline-none transition-all placeholder:text-on-surface-variant/50 focus:border-secondary focus:ring-2 focus:ring-secondary/20"
                      placeholder="Re-enter new password"
                    />
                  </div>
                </div>

                {error && (
                  <div className="rounded-lg bg-error-container px-4 py-3 text-sm text-error">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-3 text-base font-semibold text-on-primary shadow-lg transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-60"
                >
                  {loading ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <>
                      Update password
                      <ArrowRight className="h-5 w-5" />
                    </>
                  )}
                </button>
              </form>
            </>
          )}
        </div>

        <div className="mt-4 flex items-center justify-center gap-2 opacity-60 transition-all hover:opacity-100">
          <ShieldCheck className="h-4 w-4 text-on-surface-variant" />
          <span className="text-[11px] font-medium uppercase tracking-widest text-on-surface-variant">
            Enterprise Secure
          </span>
        </div>
      </div>
    </div>
  );
}
