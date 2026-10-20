# M8 — Number Cutover + Go-Live Runbook

**Scope freeze ref:** §4.9 · milestone M8
**Who:** Hoosen + Mo together — **do not run solo** (Meta/WABA changes, webhook
URL changes, and live-number operations all carry production risk).
**When:** a quiet window agreed with the client (low customer traffic).

> ⚠️ Submit Meta changes (WABA display name, template rewrites) **weeks early** —
> Meta review takes time and cannot be done inside the cutover window.

---

## Phase 0 — Prerequisites (complete ALL before scheduling cutover)

### Backups (§4.9)

- [ ] `backups/horizon-pre-repurpose-2026-10-16/` exists — 24 table JSON exports
      + `MANIFEST.md` row counts + `env.local.bak`
- [ ] n8n workflow exports in `n8n/workflows/*-pre-repurpose.json` (secrets redacted)
- [ ] **Supabase native backup downloaded by Mo** (Dashboard → Database →
      Backups) — the manifest flags this as the outstanding manual step
- [ ] Restore path spot-verified: pick one table (e.g. `leads`), compare JSON
      export row count vs live `leads` count — they will differ slightly (data
      has grown since 2026-10-16); confirm the export *content* is valid JSON
      and loadable, e.g. spot-restore a few rows into a scratch table

### Eastern Wear readiness

- [x] `n8n/prompts/business-rules.md` — TODOs filled from the client email +
      website policies (20 Oct 2026). Mo to confirm the ⚠ items: collection
      closing time (16:30 vs 17:00) and the WhatsApp payment gateway
- [x] Separate Eastern Wear inbound workflow built: **"Eastern Wear - Layla
      Inbound AI"** (`XrSnS0xF2bKZPSq1`, webhook path `/webhook/eastern-wear-webhook`).
      Eastern Wear persona + business rules, live `shopify_products` catalogue,
      telecoms guard in the verifier, writes `message_category`/`order_track`.
      Kept **inactive** until cutover. The telecoms workflow (`kW4ELXolGnYx2AvB`)
      is untouched and stays the rollback path
- [ ] OpenRouter credits topped up and the EW workflow re-tested in manual mode
      (sales question, imported-order question, "do you sell fibre?" refusal)
- [ ] Alert recipients/sender in the EW workflow email nodes agreed (currently
      internal Sif + `keshlan@horizonafrica.co.za` sender; add
      `orders@easternwearbykersh.com` if the client wants handover emails)
- [ ] `~15` rewritten WhatsApp templates **APPROVED** in Meta — list them in
      Meta Business Manager and record statuses; none `PENDING`/`REJECTED`
- [ ] Payment gateway confirmed live (PayFast or Yoco — whichever the client
      confirmed); a test payment link resolves on the real merchant account
- [ ] `eastern-wear/phase1` branch deployed to production and verified on the
      live URL (orders page, follow-ups, reports §8 metrics render)
- [ ] Client branding assets applied (logo/palette) — M7 leftover
- [x] Decision: **keep telecoms data** (Asif, 19 Oct 2026). It stays in
      Supabase untouched, and a full export was produced for the client:
      `backups/horizon-africa-data-export-2026-10-20.zip` (CSV + JSON, no
      secrets) — send via WeTransfer
- [ ] WeTransfer of the export sent to the client and receipt confirmed

### Meta / WABA

- [ ] WABA display name + business assets updated to Eastern Wear (submit via
      Meta Business Manager early; allow review time)
- [ ] `META_APP_SECRET` configured in Vercel production env
- [ ] `META_VERIFY_TOKEN` correct; webhook GET verification passes:
      `GET /api/whatsapp-webhook?hub.mode=subscribe&hub.verify_token=<token>&hub.challenge=<x>` → returns `<x>`
- [ ] `META_WEBHOOK_ENFORCE_SIGNATURE=true` set in production **after**
      confirming real Meta posts validate (run soft-mode first and watch logs)

### Operations

- [ ] Cutover date/time agreed with client in writing; quiet window
- [ ] Rollback plan agreed (see Phase 4)
- [ ] `tests/phase1-eastern-wear-e2e.md` printed/open for the smoke checks

---

## Phase 1 — Freeze telecoms automation

The same verified WABA number serves Eastern Wear — the number itself does not
move. What turns OFF is the Horizon-Africa-specific automation and copy.

- [ ] Pause/stop all telecoms campaigns (dashboard → Campaigns; confirm Fibre
      campaign is paused and stays paused — it already is)
- [ ] Deactivate the telecoms backup scheduler **"Campaign Sequence Engine
      Trigger"** (`rOGNKmgeCRikitAe`) — fibre campaign processing must not fire
      under the new brand. (Keep the workflow for rollback; just deactivate.)
- [ ] Review **"Layla Follow-up Sender"** (`Jz1na3ZFwZG1V0Vq`) — retarget its
      template/copy for Eastern Wear or deactivate until re-customised
- [ ] Review **"Follow-ups Daily Trigger"** (`YcEUNe5qVam06kps`) — must now
      process **order** follow-ups (M6) not telecoms lead follow-ups; verify the
      pending `follow_ups` rows are Eastern Wear orders, or clear stale rows
- [ ] **Switch Layla to the Eastern Wear workflow:**
      1. Publish/activate `XrSnS0xF2bKZPSq1`
      2. Set Vercel `N8N_WEBHOOK_URL` →
         `https://n8n.horizonafrica.co.za/webhook/eastern-wear-webhook` and redeploy
      3. Deactivate the telecoms workflow `kW4ELXolGnYx2AvB` (do not delete)
      4. Repoint **Missed Message Recovery** (`PvCdg60gkRYVxYOf`) resubmits to
         the `eastern-wear-webhook` path
      5. In the EW workflow `Fetch Conversation History` node, set the
         `created_at=gte.` cutoff to the cutover timestamp (currently
         `2026-10-20T00:00:00Z`) so no telecoms-era history reaches Layla
- [ ] Telecoms templates no longer used by any active workflow
      (`telkom_*`, `hello_world`, `horizon_*` — check workflows + campaign steps)

## Phase 2 — Cutover

- [ ] Confirm webhook/callback URLs in Meta App → WhatsApp → Configuration
      point at the correct deployment (`/api/whatsapp-webhook`)
- [ ] If the app is rebranded to a new domain, update:
      - Meta webhook callback URL + re-verify (GET challenge)
      - n8n HTTP nodes calling the app (process, handover, follow-ups, orders)
      - `APP_URL`/callback env vars in Vercel
- [ ] Verify Meta GET verification passes on the live domain
- [ ] Send a test inbound message from a tester number to the live line

## Phase 3 — Post-cutover verification (same window)

- [ ] Test message → Layla replies with **Eastern Wear persona** (no telecoms
      references anywhere in the reply)
- [ ] Conversation row created with correct `message_category`
- [ ] n8n execution succeeded end-to-end (check last execution of `XrSnS0xF2bKZPSq1`)
- [ ] **Error alerting** fires: trigger a deliberate controlled failure (e.g.
      bad webhook POST) → `webhook-proxy-error` alert email arrives
- [ ] **Missed Message Recovery** (`PvCdg60gkRYVxYOf`) still active and firing
- [ ] **Webhook Health Monitor** (`ytA7xBbvP6ubsY12`) still active — confirms
      Meta subscription + scheduler heartbeat
- [ ] **Chatwoot Handover Sync** active — assignment pauses Layla, resolve releases
- [ ] Dashboard loads; orders, follow-ups, reports render on live data
- [ ] One dry-run order flow on a tester number (payment link generates; do not
      pay) — or go straight to the pilot's real paid order if scheduled now

## Phase 4 — Rollback (only if cutover fails)

- [ ] Set `N8N_WEBHOOK_URL` back to `/webhook/whatsapp-webhook`, reactivate
      `kW4ELXolGnYx2AvB`, deactivate `XrSnS0xF2bKZPSq1`
- [ ] Reactivate Campaign Sequence Engine Trigger + telecoms follow-up paths
- [ ] Data was never deleted during cutover — telecoms rows remain intact
- [ ] If DB damage occurred: restore from Supabase native backup (Mo) +
      `backups/horizon-pre-repurpose-2026-10-16/db/*.json` and
      `backups/horizon-africa-handover-2026-10-20/db/*.json` exports
- [ ] Communicate rollback to client; reschedule cutover

---

## Sign-off

| Step | Owner | Done | Date/time |
|------|-------|------|-----------|
| Phase 0 prerequisites | | [ ] | |
| Phase 1 telecoms freeze | | [ ] | |
| Phase 2 cutover | | [ ] | |
| Phase 3 verification | | [ ] | |

Tag after successful cutover + verification: `git tag ew-m8-complete`
