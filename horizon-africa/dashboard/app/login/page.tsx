"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { Loader2, Lock, Mail, Eye, EyeOff, ArrowRight, ShieldCheck } from "lucide-react";
import logo from "@/app/assets/logo.png";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      router.push("/dashboard");
      router.refresh();
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-surface px-4 font-sans">
      {/* Login Card */}
      <div className="relative z-10 w-full max-w-md">
        <div className="rounded-2xl border border-outline-variant/50 bg-white p-8 shadow-xl">
          {/* Brand Header */}
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
              <h1 className="mb-1 text-2xl font-semibold text-on-surface">Welcome back</h1>
              <p className="text-sm text-on-surface-variant">Please enter your details to sign in</p>
            </div>
          </div>

          {/* Login Form */}
          <form onSubmit={handleLogin} className="space-y-4">
            {/* Email Field */}
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

            {/* Password Field */}
            <div className="space-y-1.5">
              <label
                htmlFor="password"
                className="ml-1 block text-xs font-semibold tracking-wide text-on-surface-variant"
              >
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-on-surface-variant/50" />
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full rounded-lg border border-outline-variant/50 bg-surface-container-low py-2.5 pl-10 pr-12 text-sm text-on-surface outline-none transition-all placeholder:text-on-surface-variant/50 focus:border-secondary focus:ring-2 focus:ring-secondary/20"
                  placeholder="••••••••"
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

            {/* Remember & Forgot */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <input
                  id="remember"
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                  className="h-4 w-4 rounded border-outline-variant/50 bg-surface-container-low accent-secondary"
                />
                <label
                  htmlFor="remember"
                  className="cursor-pointer text-[13px] text-on-surface-variant"
                >
                  Remember me
                </label>
              </div>
              <a
                href="/forgot-password"
                className="text-[13px] font-semibold text-secondary transition-colors hover:underline"
              >
                Forgot password?
              </a>
            </div>

            {/* Error Message */}
            {error && (
              <div className="rounded-lg bg-error-container px-4 py-3 text-sm text-error">
                {error}
              </div>
            )}

            {/* Primary CTA */}
            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-3 text-base font-semibold text-on-primary shadow-lg transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-60"
            >
              {loading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <>
                  Sign In
                  <ArrowRight className="h-5 w-5" />
                </>
              )}
            </button>

          </form>

          {/* Footer Link */}
          <div className="mt-6 text-center">
            <p className="text-[13px] text-on-surface-variant">
              Don&apos;t have an account?{" "}
              <a
                href="mailto:admin@horizonafrica.co.za"
                className="font-semibold text-secondary transition-colors hover:underline"
              >
                Contact Administrator
              </a>
            </p>
          </div>
        </div>

        {/* Security Badge */}
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
