-- Conversation Threads View + Lead Score/Status Lock Flags
-- 1. conversations stores one row per message, so counting rows inflates the
--    "Active Conversations" metric. The conversation_threads view returns the
--    latest message per phone_number (one row per chat) for the dashboard.
-- 2. score_locked / status_locked mark leads whose score or status was set
--    manually in the dashboard. The n8n AI workflow must not overwrite locked
--    fields, and unlocked scores may move up or down with each classification.

CREATE OR REPLACE VIEW public.conversation_threads AS
SELECT DISTINCT ON (phone_number)
  id,
  phone_number,
  contact_name,
  incoming_message,
  ai_response,
  lead_score,
  session_id,
  message_id,
  "timestamp",
  created_at,
  objection_type,
  follow_up_requested,
  follow_up_date,
  needs_escalation
FROM conversations
ORDER BY phone_number, created_at DESC;

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS score_locked boolean NOT NULL DEFAULT false;
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS status_locked boolean NOT NULL DEFAULT false;
