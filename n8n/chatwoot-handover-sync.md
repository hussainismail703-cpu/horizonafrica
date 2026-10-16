# Chatwoot Handover Sync (EW M4, scope freeze §4.6)

Workflow ID: `patLFfQOIDwaJDB5` — **active** (version `43d02db5`)
Export: `n8n/workflows/chatwoot-handover-sync.json` (secret redacted)

Keeps `leads.human_takeover` in sync with who owns the Chatwoot conversation:

| Chatwoot state | Webhook event | Flag |
|---|---|---|
| Agent assigned | `conversation_updated` (`changed_attributes.assignee_id` set) or `assignee_changed` | `true` |
| Conversation resolved / closed | `conversation_status_changed` | `false` |
| Reopened with assignee | `conversation_status_changed` (`open`) | `true` |
| Unassigned | `assignee_changed` / `conversation_updated` (`assignee_id` → null) | `false` |
| Labels, snooze, typing, messages, other updates | any | ignored |

`assignee_changed` is **not** subscribable in stock Chatwoot — agent
assignment arrives inside `conversation_updated` as a
`changed_attributes.assignee_id` diff. `conversation_updated` only syncs when
the assignee actually changed, so unrelated updates never release a
manually-set dashboard takeover.

## Required setup (after M4 deploys)

1. Deploy `ew/m4-imported-orders` → production so `POST /api/handover` exists
   (currently returns 307/405 on the old deployment).
2. In Chatwoot admin → **Settings → Integrations → Webhooks**, add:

   - **URL:** `https://n8n.horizonafrica.co.za/webhook/chatwoot-handover`
   - **Events:** `conversation_updated`, `conversation_status_changed`

3. Send a test assignment and confirm the lead's `human_takeover` flag flips.

`Call Handover API` authenticates with `Authorization: Bearer $APP_SECRET`
and retries 3× on failure. Request failures surface as failed n8n executions.
