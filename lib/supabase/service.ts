import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client that bypasses RLS.
 *
 * Use this ONLY in server-side code that runs without a user session
 * (webhook handler, cron-triggered endpoints, n8n callbacks). The
 * service role key has full access to all tables regardless of RLS
 * policies, so never expose it to the client.
 */
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  if (!serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not configured. This is required for service-role operations (webhook, cron)."
    );
  }

  return createSupabaseClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
