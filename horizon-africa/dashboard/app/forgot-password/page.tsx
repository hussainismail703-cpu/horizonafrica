"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Loader2, Mail, ArrowRight, ArrowLeft, ShieldCheck, CheckCircle2 } from "lucide-react";
import logo from "@/app/assets/logo.png";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      setSent(true);
      setLoading(false);
    }
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
              <h1 className="mb-1 text-2xl font-semibold text-on-surface">Reset password</h1>
              <p className="text-sm text-on-surface-variant">
                {sent
                  ? "Check your email for the reset link"
                  : "Enter your email and we'll send you a reset link"}
              </p>
            </div>
          </div>

          {sent ? (
            <div className="space-y-6">
              <div className="flex flex-col items-center gap-3 rounded-lg bg-primary-container/50 px-4 py-6 text-center">
                <CheckCircle2 className="h-10 w-10 text-primary" />
                <p className="text-sm text-on-surface">
                  We sent a password reset link to
                </p>
                <p className="text-sm font-semibold text-on-surface">{email}</p>
                <p className="text-xs text-on-surface-variant">
                  The link will expire in 1 hour. Check your spam folder if you don't see it.
                </p>
              </div>
              <Link
                href="/login"
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-outline-variant/50 py-3 text-sm font-semibold text-on-surface-variant transition-all hover:bg-surface-container-low"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to login
              </Link>
            </div>
          ) : (
            <>
              <form onSubmit={handleReset} className="space-y-4">
                <div className="space-y-1.5">
                  <label
                    htmlFor="email"
                    className="ml-1 block text-xs font-semibold tracking-wide text-on-surface-variant"
                  >
                    Email address
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-on-surface-variant/50" />
                    <input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      className="w-full rounded-lg border border-outline-variant/50 bg-surface-container-low py-2.5 pl-10 pr-4 text-sm text-on-surface outline-none transition-all placeholder:text-on-surface-variant/50 focus:border-secondary focus:ring-2 focus:ring-secondary/20"
                      placeholder="name@company.com"
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
                      Send reset link
                      <ArrowRight className="h-5 w-5" />
                    </>
                  )}
                </button>
              </form>

              <div className="mt-6 text-center">
                <Link
                  href="/login"
                  className="text-[13px] font-semibold text-secondary transition-colors hover:underline"
                >
                  Back to login
                </Link>
              </div>
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
