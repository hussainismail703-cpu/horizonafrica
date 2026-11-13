-- Drop permissive anon/public RLS policies.
--
-- Context: n8n workflows previously queried Supabase REST with the anon key,
-- which required these wide-open policies. All Horizon-project workflows have
-- been migrated to the service-role key (bypasses RLS), the Next.js app uses
-- service clients for unauthenticated paths and authenticated sessions for
-- dashboard users, so anonymous access is no longer needed and is a data-
-- exposure risk (customer PII in leads/conversations was world-readable).
--
-- Every statement is IF EXISTS so this can be re-applied safely.

-- leads: customer PII
DROP POLICY IF EXISTS anon_insert_leads ON public.leads;
DROP POLICY IF EXISTS anon_select_leads ON public.leads;
DROP POLICY IF EXISTS anon_update_leads ON public.leads;

-- conversations: message contents
DROP POLICY IF EXISTS anon_delete_conversations ON public.conversations;
DROP POLICY IF EXISTS anon_insert_conversations ON public.conversations;
DROP POLICY IF EXISTS anon_select_conversations ON public.conversations;
DROP POLICY IF EXISTS anon_update_conversations ON public.conversations;

-- broadcast tables: recipient PII / send history
DROP POLICY IF EXISTS anon_insert_broadcast_contacts ON public.broadcast_contacts;
DROP POLICY IF EXISTS anon_select_broadcast_contacts ON public.broadcast_contacts;
DROP POLICY IF EXISTS anon_update_broadcast_contacts ON public.broadcast_contacts;
DROP POLICY IF EXISTS anon_select_broadcast_groups ON public.broadcast_groups;
DROP POLICY IF EXISTS anon_insert_broadcast_history ON public.broadcast_history;
DROP POLICY IF EXISTS anon_update_broadcast_history ON public.broadcast_history;
DROP POLICY IF EXISTS "Anyone can insert broadcast_recipients" ON public.broadcast_recipients;
DROP POLICY IF EXISTS "Anyone can read broadcast_recipients" ON public.broadcast_recipients;
DROP POLICY IF EXISTS "Anyone can update broadcast_recipients" ON public.broadcast_recipients;

-- legacy product catalogue: keep products_auth_all (authenticated) — only the
-- public SELECT goes away.
DROP POLICY IF EXISTS products_read_all ON public.products;

-- staff alerts: inserts now go through the service client
DROP POLICY IF EXISTS anon_insert_staff_alerts ON public.staff_alerts;

-- scheduler heartbeats: read only by the service client
DROP POLICY IF EXISTS system_heartbeats_read ON public.system_heartbeats;
