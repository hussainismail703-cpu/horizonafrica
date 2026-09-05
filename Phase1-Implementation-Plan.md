# Phase 1 Implementation Plan — Developer Handoff

**Project:** Layla Campaign Orchestration & Customer Lifecycle Engine — Phase 1
**Developer:** Hussain
**Reviewer/Merger:** Mo
**Generated:** 28 August 2026
**Repo:** `/home/asif/Documents/Aesthetics (2)/horizon-africa/dashboard`

---

## ⚠️ READ FIRST: Pre-Flight Checklist

Before ANY code change, complete these steps in order. This protects the production app.

### Step 0: Backup Everything (DO NOT SKIP)

```bash
# 0.1 Backup the entire Supabase database via pg_dump
#    Go to: https://supabase.com/dashboard/project/gbchhzipbbxpvgtaheze
#    → Database → Backups → "Download backup" or use the SQL Editor to:
#    pg_dump -h db.gbchhzipbbxpvgtaheze.supabase.co -U postgres -d postgres --no-owner --no-acl -f ~/horizon-full-backup-$(date +%Y%m%d-%H%M).sql

# 0.2 Snapshot the current Supabase schema (tables, RLS, functions) via the API
#    Open Dashboard → SQL Editor → run:
#    SELECT * FROM information_schema.tables WHERE table_schema='public';

# 0.3 Create a Git branch (see Step 1 below)

# 0.4 Verify the current dashboard builds and runs:
cd /home/asif/Documents/Aesthetics\ \(2\)/horizon-africa/dashboard
npm run build   # must succeed with zero errors
```

### Why This Matters
This is a **production application** serving live WhatsApp conversations and leads for Horizon Africa. If a migration breaks the database or a code change breaks the dashboard, YOU must be able to revert everything to the last known-good state within minutes. The backup strategy below ensures this.

---

## 1. Git & Branching Strategy

### 1.1 Structure

```
main                    ← PRODUCTION (only Mo merges here, only after review)
  └── phase1/campaign-engine   ← Phase 1 development branch (Hussain works here)
       ├── phase1/m1-schema          ← M1: Database schema + migrations
       ├── phase1/m2-campaign-creator  ← M2: Campaign Creator UI
       ├── phase1/m3-sequence-engine   ← M3: Follow-up sequence engine
       ├── phase1/m4-response-classification  ← M4: Response detection + classification
       ├── phase1/m5-manual-controls   ← M5: Manual controls + audit trail + journey view
       ├── phase1/m6-dashboard        ← M6: Campaign dashboard + reporting
       ├── phase1/m7-backups          ← M7: Backup config + error handling
       ├── phase1/m8-testing          ← M8: Testing, QA, template coordination
       └── phase1/m9-pilot            ← M9: Pilot readiness
```

### 1.2 Workflow (per milestone)

```bash
# 1. Check out Phase 1 branch (one-time):
git checkout main
git pull
git checkout -b phase1/campaign-engine

# 2. For EACH milestone, create a sub-branch:
git checkout phase1/campaign-engine
git checkout -b phase1/m1-schema    # (m1, m2, m3, ..., m9)

# 3. Work on the milestone. Commit frequently.
git add .
git commit -m "M1: [description of what was done]"

# 4. When the milestone is complete and passes ALL tests:
git checkout phase1/campaign-engine
git merge phase1/m1-schema
git push origin phase1/campaign-engine

# 5. Tag the merge so you can always find it:
git tag -a "phase1-m1-complete" -m "M1: Schema complete"
git push origin --tags

# 6. Open a Pull Request from phase1/campaign-engine → main for Mo to review.
#    Mo reviews, then merges → main. The milestone sub-branch can be deleted.

# 7. Start next milestone:
git checkout -b phase1/m2-campaign-creator
```

### 1.3 Emergency Rollback

If something catastrophic happens and you need to revert to before a milestone:

```bash
# Revert main to the tag before the problem:
git checkout main
git revert --no-commit <bad-commit-hash>..HEAD
git commit -m "Revert: rolling back to phase1-m4-complete"
git push origin main

# Or restore the database from the backup (see Section 2):
# Use the Supabase dashboard to restore from the backup taken before the milestone.
```

---

## 2. Database Backup & Recovery Protocol

### 2.1 Before Every Milestone (MANDATORY)

```bash
# 1. Go to Supabase Dashboard → SQL Editor → run:
SELECT 
  schemaname, tablename, 
  n_live_tup AS estimated_rows
FROM pg_stat_user_tables 
ORDER BY n_live_tup DESC;

# Paste the output into a file: /backups/pre-milestone/phase1-mX-row-counts.txt

# 2. Export the full schema:
#    Dashboard → Database → Backups → "Download Backup"
#    Save as: ~/backups/pre-milestone/horizon-db-mX-YYYYMMDD.sql

# 3. git tag the current state (see Section 1)
```

### 2.2 Manual Backup Process (MANDATORY — every milestone)

There is no automated backup service on this project. You are responsible for taking a **manual database backup before every single milestone.** This is not optional.

**How to take a backup:**

1. Go to Supabase Dashboard: https://supabase.com/dashboard/project/gbchhzipbbxpvgtaheze
2. Click **Database** (left sidebar) → **Backups**
3. Click **"Download Backup"**
4. Save the file to: `~/horizon-backups/horizon-db-mX-YYYYMMDD.sql`
5. Also run the row-count query (Section 2.1 Step 2) and save the output alongside the backup file.

**After taking the backup, verify it:**
- The .sql file should be non-zero (typically 100 KB+).
- Open it in a text editor and spot-check that you can see `CREATE TABLE` statements and `INSERT` data.

**Store backups somewhere safe** — not inside the Git repo. Keep at least the last 3 backups at all times. Mo should also keep a copy.

### 2.3 Recovery Procedure

```bash
# If the database gets corrupted:
# 1. Go to Supabase dashboard → Database → Backups
#    → Scroll down to "Restore from backup" section
# 2. Upload the most recent .sql backup file (from 2.2 above).
# 3. Wait for restore to complete (5–15 minutes).
# 4. Verify by running the row-count query from 2.1 and comparing to saved values.
```

# If the code breaks:
# 1. git checkout main → git revert to the last tagged commit (see 1.3)
# 2. Run npm run build to verify

# If BOTH code and database break:
# 1. Restore database first (above), then revert code (1.3)
```

---

## 3. Tech Stack Summary (Reference)

| Layer | Technology | Notes |
|---|---|---|
| **Frontend** | Next.js 15 (App Router), React 19, TypeScript | Dashboard at `/dashboard` |
| **Auth** | Supabase Auth | Cookie-based sessions, middleware |
| **Database** | PostgreSQL via Supabase | Live project: `gbchhzipbbxpvgtaheze.supabase.co` |
| **API** | Next.js API routes + n8n workflows | n8n is self-hosted, handles WhatsApp webhook dispatching |
| **WhatsApp** | Meta WhatsApp Business API (v21.0) | Templates + free-form messages |
| **AI** | OpenRouter GPT-5.6-sol | Classification, response generation |
| **Styling** | Tailwind CSS 4 + Lucide React icons + Recharts | Charts in reports |
| **Hosting** | Vercel (dashboard), self-hosted (n8n) | Vercel config in `vercel.json` |
| **Email alert** | Brevo | Hot lead + escalation alerts |
| **Handover** | Chatwoot | Human escalation handover |

### Key Files to Know

| File | Purpose |
|---|---|
| `lib/supabase/browser.ts` | Client-side Supabase client |
| `lib/supabase/server.ts` | Server-side Supabase client |
| `lib/types.ts` | All TypeScript types (leads, conversations, broadcasts, etc.) |
| `lib/utils.ts` | Message text extraction utility |
| `lib/follow-ups.ts` | Existing follow-up sending logic (reference for campaign engine) |
| `middleware.ts` | Auth middleware |
| `components/broadcast-form.tsx` | Broadcast UI (reference for campaign targeting) |
| `components/follow-ups-manager.tsx` | Follow-up management UI |
| `components/lead-table.tsx` | Lead table (reference for customer profile views) |
| `app/(app)/layout.tsx` | Dashboard shell layout |
| `workflow-inbound-ai-v2.json` | n8n inbound AI workflow (…/horizon-africa/workflow-inbound-ai-v2.json) |
| `.env.local` | Environment variables (Supabase, Meta, OpenRouter keys) |

---

## 4. Milestone-by-Milestone Implementation (AI-Ready Prompts)

Each milestone below is written as a **self-contained AI prompt**. Hussain should feed each one to his AI tool (ChatGPT, Claude, etc.). Each includes: what to build, exact files to create/modify, database changes, and how to test.

---

### M1: Database Schema + Data Model

**Goal:** Create campaign, sequence, enrolment, classification, and interaction storage tables.

#### AI Prompt (Paste this into your AI tool):

```
I am building a WhatsApp campaign engine for a Next.js 15 + Supabase + TypeScript application. The existing database has these tables: leads, conversations, broadcast_groups, broadcast_contacts, broadcast_history, staff_alerts. I need to add campaign-related tables.

Create a Supabase migration SQL file that adds these tables to the `public` schema:

1. **campaigns**
   - id: uuid, primary key, default gen_random_uuid()
   - name: text, not null
   - objective: text, nullable
   - status: text, default 'draft', check (draft | active | paused | completed | stopped)
   - start_date: timestamptz, nullable
   - end_date: timestamptz, nullable
   - created_at: timestamptz, default now()
   - updated_at: timestamptz, default now()

2. **campaign_steps**
   - id: uuid, primary key, default gen_random_uuid()
   - campaign_id: uuid, references campaigns(id) on delete cascade
   - step_number: integer, not null
   - delay_days: integer, not null (days after previous step or campaign start)
   - template_name: text, not null (WhatsApp template name)
   - created_at: timestamptz, default now()

3. **campaign_enrolments**
   - id: uuid, primary key, default gen_random_uuid()
   - campaign_id: uuid, references campaigns(id) on delete cascade
   - phone_number: text, not null
   - lead_id: integer, nullable, references leads(id) on delete set null
   - current_step: integer, default 0
   - status: text, default 'active', check (active | responded | completed | removed)
   - enrolled_at: timestamptz, default now()
   - updated_at: timestamptz, default now()
   - UNIQUE constraint on (campaign_id, phone_number) where status != 'removed'

4. **campaign_interactions**
   - id: uuid, primary key, default gen_random_uuid()
   - campaign_id: uuid, references campaigns(id) on delete cascade
   - enrol_id: uuid, nullable, references campaign_enrolments(id) on delete set null
   - phone_number: text, not null
   - step_number: integer, nullable
   - message_type: text, not null, check (outbound | inbound)
   - template_name: text, nullable
   - message_body: text, nullable
   - delivery_status: text, default 'pending', check (pending | sent | delivered | read | failed)
   - meta_message_id: text, nullable
   - occurred_at: timestamptz, default now()
   - created_at: timestamptz, default now()

5. **campaign_classifications**
   - id: uuid, primary key, default gen_random_uuid()
   - interaction_id: uuid, references campaign_interactions(id) on delete cascade
   - phone_number: text, not null
   - classification: text, not null, check (interested | not_interested | already_has_service | needs_information | no_response | other | uncertain)
   - rejection_reason: text, nullable, check (price | already_has_service | not_needed | not_now | needs_more_info | competitor | not_eligible | other | null)
   - confidence: real, nullable (0.0 to 1.0)
   - classified_by: text, default 'ai', check (ai | manual)
   - original_ai_classification: text, nullable
   - corrected_by: text, nullable
   - corrected_at: timestamptz, nullable
   - created_at: timestamptz, default now()

6. **campaign_audit_log**
   - id: uuid, primary key, default gen_random_uuid()
   - entity_type: text, not null (e.g. 'campaign_enrolment', 'classification')
   - entity_id: uuid, not null
   - field_changed: text, not null
   - old_value: text, nullable
   - new_value: text, nullable
   - changed_by: text, not null
   - changed_at: timestamptz, default now()

Enable RLS on all tables. Create policies: authenticated users can SELECT/INSERT/UPDATE/DELETE all tables.

Add a function `trigger_set_updated_at()` and apply it to `campaigns` and `campaign_enrolments` as a BEFORE UPDATE trigger.

Add a function `log_campaign_audit()` that inserts into campaign_audit_log. Apply it as a trigger on `campaign_enrolments` (when status or current_step changes) and `campaign_classifications` (when classification or rejection_reason changes, and when corrected_by is set).

Output: a single SQL migration file that I can run in the Supabase SQL Editor.
```

#### Testing M1 (after running the migration):

1. Run the migration in Supabase SQL Editor. Check for errors.
2. Run: `SELECT * FROM information_schema.tables WHERE table_name LIKE 'campaign%';` — should show 6 tables.
3. Insert a test campaign:
   ```sql
   INSERT INTO campaigns (name, objective, status)
   VALUES ('Test Campaign', 'Test objective', 'draft');
   SELECT * FROM campaigns;
   ```
4. Insert a test step:
   ```sql
   INSERT INTO campaign_steps (campaign_id, step_number, delay_days, template_name)
   VALUES ('<id from above>', 1, 0, 'test_template');
   ```
5. Verify: `SELECT * FROM campaign_steps;`

#### Deliverable:
- [ ] Migration SQL file saved and executed
- [ ] All 6 tables exist in Supabase
- [ ] RLS policies active
- [ ] Audit trigger fires on status changes (test by updating an enrolment status)
- [ ] Git commit: "M1: Database schema for campaign engine"

---

### M2: Campaign Creator UI

**Goal:** Dashboard page to create, name, and configure campaigns with sequence steps.

#### AI Prompt (Paste this into your AI tool):

```
I am extending a Next.js 15 + React 19 + TypeScript dashboard (App Router). The tech stack uses Supabase for auth/data, Tailwind CSS 4, Lucide React icons, and the `sonner` toast library. The sidebar already exists at `components/sidebar.tsx`.

I need a **Campaign Creator** page. Create:

### File 1: `app/(app)/campaigns/page.tsx`
- A page listing all existing campaigns from the `campaigns` table.
- Each campaign shows: name, objective, status badge (colored: draft=gray, active=green, paused=yellow, completed=blue, stopped=red), start/end dates, and a "Manage" button.
- "Create Campaign" button at the top opens a full-page or modal form.
- Use `createClient()` from `@/lib/supabase/browser` for all Supabase calls.
- Use `sonner` toasts for success/error feedback.
- On click "Manage", redirect to `/campaigns/[id]` for the campaign detail/edit view.

### File 2: `app/(app)/campaigns/create/page.tsx`
- A form to create a new campaign:
  - Campaign name (text input, required)
  - Objective (textarea, optional)
  - Start date (date picker)
  - End date (date picker)
  - Target group (dropdown populated from `broadcast_groups` table, optional)
- After entering campaign metadata and saving, user is taken to the sequence builder (below).

### File 3: `app/(app)/campaigns/[id]/page.tsx`
- Shows the campaign detail view:
  - Editable campaign metadata (name, objective, dates, status dropdown)
  - Sequence builder section:
    - A list of steps, each showing: step number, delay in days, WhatsApp template name
    - "Add Step" button that appends a new row (step_number auto-increments)
    - "Remove Step" button per row
    - "Save Sequence" button that persists all steps to `campaign_steps`
  - Status control: buttons to Activate / Pause / Stop campaign (updates `status` field)
- Template dropdown populated from the existing `templates` or the Meta templates list (use the same API as the existing broadcast form at `components/broadcast-form.tsx` for reference).

### File 4: Update `components/sidebar.tsx`
- Add a "Campaigns" menu item linking to `/campaigns` with a Megaphone or Send icon from Lucide.

### Database:
- Tables already created: campaigns, campaign_steps (from M1 migration).
- Use `supabase.from('campaigns')` and `supabase.from('campaign_steps')`.

### Edge cases:
- Prevent activating a campaign with zero steps.
- Prevent duplicate campaign names.
- Show confirmation dialog before stopping an active campaign.
- Handle empty state ("No campaigns yet. Create your first campaign.").

### Testing instructions:
After building, verify:
1. Create a campaign → saves to campaigns table.
2. Add 3 steps → saves to campaign_steps table.
3. Edit campaign name → updates in database.
4. Activate → status changes. Pause → status changes. Stop → status changes.
5. Try activating with zero steps → shows error toast.
```

#### Testing M2:

1. Visit `/campaigns` — page loads, empty state shown.
2. Click "Create Campaign" → fill form → submit → redirected to sequence builder.
3. Add 5 steps with varying delays (0, 2, 5, 10, 21 days).
4. Save sequence → check `campaign_steps` table — 5 rows.
5. Edit campaign name → save → check `campaigns` table.
6. Activate → verify status = 'active' in DB.
7. Stop → confirm dialog → verify status = 'stopped'.
8. Verify sidebar has "Campaigns" link.

#### Deliverable:
- [ ] `/campaigns` page functional
- [ ] `/campaigns/create` page functional
- [ ] `/campaigns/[id]` page functional (edit + sequence builder)
- [ ] Sidebar updated
- [ ] Can create, edit, activate, pause, stop campaigns
- [ ] Git commit: "M2: Campaign Creator UI"

---

### M3: Follow-Up Sequence Engine

**Goal:** Automated scheduled sending of campaign messages via n8n + Vercel Cron.

#### AI Prompt (Paste this into your AI tool):

```
I am building an automated WhatsApp campaign follow-up engine. The system must:

1. Identify all active campaigns whose current date >= end_date OR campaigns with enrolments at step X where the delay_days have passed.
2. Send the appropriate WhatsApp template message to each customer.
3. Record the send in campaign_interactions.
4. If the customer does NOT respond, auto-advance them to the next step.

### File 1: `lib/campaign-engine.ts`
A server-side library exported as a module. Create these functions:

```typescript
// Process all active campaigns — this is the main entry point called by the cron job.
export async function processCampaigns(): Promise<CampaignProcessingResult>

// For a single active campaign, find all enrolments due for their next step and send.
export async function processCampaign(campaignId: string): Promise<CampaignProcessingResult>

// Send a single WhatsApp template message to a phone number.
// Reference: lib/follow-ups.ts for the WhatsApp send pattern (Meta API v21.0).
export async function sendCampaignMessage(
  phoneNumber: string,
  templateName: string,
  campaignId: string,
  enrolId: string,
  stepNumber: number
): Promise<SendResult>

// Record the interaction in campaign_interactions after each send.
export async function recordInteraction(...): Promise<void>

// Advance the enrolment to the next step (or mark complete if last step).
export async function advanceEnrolment(enrolId: string): Promise<void>
```

Types needed:
```typescript
interface CampaignProcessingResult {
  campaigns_processed: number;
  messages_sent: number;
  messages_failed: number;
  enrolments_advanced: number;
  errors: string[];
}

interface SendResult {
  success: boolean;
  metaMessageId?: string;
  error?: string;
}
```

The WhatsApp send pattern is identical to `lib/follow-ups.ts`:
- Use Meta Graph API: `https://graph.facebook.com/${META_API_VERSION}/${META_PHONE_NUMBER_ID}/messages`
- Headers: Authorization Bearer token
- Body: { messaging_product: "whatsapp", to: phone, type: "template", template: { name: templateName, language: { code: "en_US" } } }

### File 2: `app/api/campaigns/process/route.ts`
An API route that calls `processCampaigns()`. This is triggered by Vercel Cron or by n8n.
- Method: POST
- Requires an `Authorization` header matching a shared secret (use `process.env.APP_SECRET`).
- Returns JSON: `{ processed, sent, failed, errors }`.

### File 3: Update `vercel.json`
Add a cron trigger (every 15 minutes):
```json
{
  "crons": [
    {
      "path": "/api/campaigns/process",
      "schedule": "*/15 * * * *"
    }
  ]
}
```

Alternatively, if n8n is the scheduler, create an n8n HTTP Request node that calls `POST /api/campaigns/process` every 15 minutes with the APP_SECRET header.

### Edge cases:
- Skip enrolments where status is 'responded', 'completed', or 'removed'.
- Do not send to a phone number that has already been sent the current step (check campaign_interactions for duplicate outbound per step).
- Handle Meta API errors gracefully — log the failure but do not crash the entire batch.
- If a campaign's end_date has passed, mark the campaign as 'completed'.

### Testing instructions:
1. Create a test campaign with 2 steps (delay 0 and delay 1 day).
2. Manually insert an enrolment.
3. Run the API route manually: `POST /api/campaigns/process` with the secret header.
4. Verify: a message was sent, recorded in campaign_interactions, and the enrolment advanced to step 1.
5. Run again — verify step 2 sends on day 1.
6. After the last step: verify enrolment status = 'completed'.
```

#### Testing M3:

1. Create a campaign with steps at delays: 0, 1 day (set dates so they are immediately due).
2. Insert a test lead and enrol them manually.
3. Call the process endpoint: `curl -X POST http://localhost:3000/api/campaigns/process -H "Authorization: Bearer ce2d384445d497c72b779a56c4083d55"`
4. Check `campaign_interactions` — an outbound row should exist with delivery_status.
5. Check `campaign_enrolments` — current_step should have advanced.
6. Test duplicate prevention: run process again — no second message sent for the same step.
7. Simulate a Meta API error (use invalid template name) — error logged, batch continues.

#### Deliverable:
- [ ] `lib/campaign-engine.ts` with all exported functions
- [ ] `app/api/campaigns/process/route.ts` API endpoint
- [ ] Cron or n8n scheduling configured
- [ ] Duplicate send prevention working
- [ ] Error handling: individual failures don't crash batch
- [ ] Git commit: "M3: Follow-up sequence engine"

---

### M4: Response Detection + Classification

**Goal:** Detect customer replies, stop campaign sequence, route to sales flow, classify response, capture "not interested" reasons.

#### AI Prompt (Paste this into your AI tool):

```
I need to add response detection and AI classification to the campaign engine.

### Component 1: Update the WhatsApp webhook handler
The existing webhook is at `app/api/whatsapp-webhook/`. Update it to detect if an incoming message is from a customer who is currently enrolled in an active campaign.

Logic:
1. When a WhatsApp inbound message arrives, extract the phone_number.
2. Query `campaign_enrolments` WHERE phone_number = <extracted> AND status = 'active'.
3. If found, STOP the campaign sequence for this customer:
   a. Update `campaign_enrolments` SET status = 'responded'.
   b. Record the inbound message in `campaign_interactions` (message_type = 'inbound', delivery_status = 'delivered').
   c. DO NOT advance to next step or send any more campaign messages to this customer.
   d. Route the customer into the EXISTING sales flow (the normal Layla AI conversation handler).

### Component 2: Intent Classification
After routing to the sales flow, if the customer says they're not interested (detected by existing keyword detection or AI analysis), capture the classification.

Create `lib/classification.ts`:

```typescript
export type ClassificationResult = {
  classification: 'interested' | 'not_interested' | 'already_has_service' | 'needs_information' | 'no_response' | 'other' | 'uncertain';
  rejection_reason?: 'price' | 'already_has_service' | 'not_needed' | 'not_now' | 'needs_more_info' | 'competitor' | 'not_eligible' | 'other';
  confidence: number; // 0.0 to 1.0
  method: 'keyword' | 'ai' | 'combined';
};

export async function classifyResponse(
  messageText: string,
  campaignId: string,
  enrolId: string,
  phoneNumber: string
): Promise<ClassificationResult>
```

The function uses:
1. **Keyword detection first** (fast, free):
   - "not interested", "don't need", "already have" → not_interested
   - "how much", "price", "cost" → interested (with pricing intent)
   - "send details", "more info", "tell me more" → needs_information
   - "yes", "interested", "let's do it" → interested
2. **If keywords are inconclusive → call OpenRouter AI** (pattern: same as existing Layla prompt structure). The AI prompt asks: "Classify this WhatsApp response from a campaign outreach. The customer said: [message]. Classify as one of: interested, not_interested, already_has_service, needs_information, other, uncertain. If not_interested, identify the reason: price, already_has_service, not_needed, not_now, needs_more_info, competitor, not_eligible, other. Return as JSON."
3. **Store the classification** in `campaign_classifications`.
4. **If uncertain (confidence < 0.5), flag for human review** — record classification as 'uncertain'.

### Component 3: Update Customer Profile
When a classification is stored, update the `leads` table:
- If not_interested: update lead status, store rejection reason in a notes field or custom field.
- Update `last_campaign_id`, `last_campaign_response`, `last_campaign_outcome` (add these columns via a migration if not present, or use the existing notes structure).

### Testing instructions:
1. Simulate an incoming WhatsApp message from a phone number enrolled in a campaign.
2. Verify: the enrolment status changes to 'responded'.
3. Verify: no further campaign messages are sent to this phone number.
4. Test classification with various message texts:
   - "Not interested, I already have Telkom" → not_interested, already_has_service
   - "Tell me more" → needs_information
   - "Yes I want fibre" → interested
   - "Maybe later" → uncertain
5. Verify all classifications are stored in `campaign_classifications`.
```

#### Testing M4:

1. Enrol a test phone in a campaign. Send a message as that phone → verify enrolment.status = 'responded'.
2. Run process endpoint → verify no messages sent to that phone (skip responded).
3. Test 5 different response texts (see above) and verify correct classification.
4. Test "ambiguous" response → verify classification = 'uncertain'.
5. Check `campaign_classifications` table for stored records.

#### Deliverable:
- [ ] Webhook updated with campaign enrolment detection
- [ ] `lib/classification.ts` with keyword + AI classification
- [ ] Classification stored in `campaign_classifications`
- [ ] Responded customers excluded from further sequence sends
- [ ] Git commit: "M4: Response detection + classification"

---

### M5: Manual Controls + Audit Trail + Customer Journey View

**Goal:** Manual status override, classification correction with audit trail, and basic "what happened" customer view.

#### AI Prompt (Paste this into your AI tool):

```
I need three additions to the dashboard:

### Feature 1: Manual Status & Classification Override

### File: `app/(app)/campaigns/[id]/enrolments/page.tsx`
- Shows all enrolments for a campaign (table: campaign_enrolments with lead info joined).
- Each row shows: phone number, lead name, current step, status, classification (if any).
- Action buttons per row:
  - **Override Status**: dropdown to set status to active/responded/completed/removed.
  - **Correct Classification**: dropdown to set classification, with reason sub-dropdown if not_interested.
  - **Remove from Campaign**: button (sets status = 'removed').
- On ANY manual change:
  - Update the relevant record.
  - Insert into `campaign_audit_log` with: entity_type, entity_id, field_changed, old_value, new_value, changed_by (current user from auth session), changed_at.
  - Show success toast.

### Feature 2: Audit Trail View

### File: `app/(app)/campaigns/[id]/audit/page.tsx`
- Lists all audit log entries for this campaign (join campaign_enrolments to get campaign_id, then join campaign_audit_log on entity_id).
- Columns: date/time, user, entity, field, old value → new value.
- Filterable by date range.
- Export as CSV (use existing xlsx library pattern from lead-table.tsx).

### Feature 3: Basic Customer Journey View

### File: `app/(app)/campaigns/[id]/customers/[phone]/page.tsx`
- For a given phone number in a campaign, show a flat "what happened" view:
  - Customer info: phone, name, current status
  - Campaign: name, enrolment date, current step
  - All interactions: chronological list of messages sent/received with timestamps, delivery status
  - Classification: current classification + rejection reason
  - Last response: timestamp + text
- This is NOT a visual timeline — it's a flat record view with clear sections.
- Navigation: from the enrolments page, click a phone number → goes to this view.

### Database:
- campaign_audit_log table already exists from M1 migration.
- The audit log trigger fires automatically on status changes. For manual changes via the UI, insert explicitly.

### Edge cases:
- When overriding a classification, store the original AI classification as `original_ai_classification` and set `classified_by = 'manual'`.
- If user removes a customer, future processing must skip them (already handled — status = 'removed').
- Audit log must be read-only (no edits/deletes from UI).
```

#### Testing M5:

1. Create a campaign with enrolments.
2. Override a status manually → check `campaign_enrolments.status` updated + audit log entry created.
3. Correct a classification → check `campaign_classifications.classified_by = 'manual'` + audit log entry.
4. Remove a customer → status = 'removed' + audit log entry.
5. View audit trail page → all manual changes listed.
6. View customer journey page → shows campaign, interactions, classification, last response.

#### Deliverable:
- [ ] Enrolment management page with override controls
- [ ] Audit trail page with filtering
- [ ] Customer journey "what happened" view
- [ ] All manual changes logged to campaign_audit_log
- [ ] Git commit: "M5: Manual controls + audit trail + customer journey view"

---

### M6: Campaign Dashboard + Performance Reporting

**Goal:** Campaign overview dashboard with statistics.

#### AI Prompt (Paste this into your AI tool):

```
I need a campaign dashboard and performance report.

### Page 1: Campaign Dashboard — `app/(app)/campaigns/dashboard/page.tsx`
- Overview cards at top:
  - Total active campaigns (count where status = 'active')
  - Total customers in campaigns (sum of active enrolments)
  - Messages sent today (count campaign_interactions where message_type = 'outbound' AND occurred_at::date = today)
  - Responses today (count where message_type = 'inbound' AND occurred_at::date = today)
- Active campaigns table:
  - Campaign name, status, total enrolled, current step distribution (simplified: how many at step 0, step 1, etc.), responses, conversions
  - Click campaign → goes to `/campaigns/[id]`
- Use stat-card.tsx pattern for the overview cards.

### Page 2: Campaign Performance Report — `app/(app)/campaigns/reports/[id]/page.tsx`
For a single campaign:
- Messages sent (total)
- Delivery rate (delivered / sent * 100)
- Response rate (inbound responses / messages sent * 100)
- Entered sales flow (count classified as interested)
- Converted (count where lead status changed to 'converted' via this campaign's interactions)

### API Route: `app/api/campaigns/stats/[id]/route.ts`
- GET: Returns the stats above for a given campaign ID as JSON.
- Used by the report page.

### API Route: `app/api/campaigns/dashboard-stats/route.ts`
- GET: Returns all dashboard overview statistics as JSON.

### Reporting logic:
- "Conversion" = a lead who responded to this campaign AND their lead status later changed to 'converted' (check leads table for the phone_number within 30 days of first campaign response).
- "Entered sales flow" = classification = 'interested' OR 'needs_information'.
- "Delivery rate" = count where delivery_status = 'delivered' OR 'read' / count where message_type = 'outbound'.
- "Response rate" = count where message_type = 'inbound' / count where message_type = 'outbound'.

### Edge cases:
- Campaign with zero messages: show all rates as "N/A".
- Campaign just started: show 0 for all counts, not errors.
- Multi-campaign dashboard: aggregate stats correctly across campaigns.
```

#### Testing M6:

1. Create 2 campaigns with enrolments and some simulated interactions.
2. Dashboard loads → overview cards show correct aggregations.
3. Active campaigns table → shows both campaigns with counts.
4. Click into a campaign report → all stats computed correctly.
5. Campaign with zero interactions → shows N/A, not errors.

#### Deliverable:
- [ ] Campaign overview dashboard page
- [ ] Per-campaign performance report page
- [ ] Stats API endpoints
- [ ] All metrics correctly calculated
- [ ] Git commit: "M6: Campaign dashboard + reporting"

---

### M7: Error Handling + Failed Message Visibility + Backup Docs

**Goal:** Add error logging, failure visibility, and formalise the backup documentation.

#### Tasks (not full AI prompt — configuration work):

1. **Failed message visibility**: Ensure the campaign dashboard shows failed messages.
   - Add a "Failed Messages" section to `app/(app)/campaigns/reports/[id]/page.tsx`:
     - List all campaign_interactions where delivery_status = 'failed'.
     - Show: phone, step, template, error (from meta_error field if captured), timestamp.

2. **Error logging table**: Add a migration for `campaign_errors`:
   ```sql
   CREATE TABLE public.campaign_errors (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     campaign_id uuid REFERENCES campaigns(id) ON DELETE CASCADE,
     enrol_id uuid REFERENCES campaign_enrolments(id) ON DELETE SET NULL,
     phone_number text,
     error_type text NOT NULL,
     error_message text,
     context jsonb DEFAULT '{}'::jsonb,
     created_at timestamptz DEFAULT now()
   );
   ```
   Update `lib/campaign-engine.ts` to log errors to this table.

3. **Error monitoring UI**: Add an "Errors" tab to the campaign detail page showing the most recent errors for that campaign.

4. **Backup documentation**: Write a `BACKUP-RECOVERY.md` file documenting:
   - How to take a manual backup (Supabase dashboard steps).
   - How to verify a backup (row counts).
   - How to restore from backup (upload .sql file).
   - Emergency contacts.

#### Testing M7:

1. Take a manual backup following the steps in Section 2.2 — verify the .sql file is valid and non-empty.
2. Send a message with invalid template → error logged to campaign_errors.
3. View failed messages on campaign report → shows the failure.
4. View error log on campaign detail → shows the error.
5. Backup doc is complete and accessible.

#### Deliverable:
- [ ] Manual backup taken and verified (Section 2.2)
- [ ] Failed message visibility on campaign report
- [ ] campaign_errors table + error logging in engine
- [ ] Error monitoring UI
- [ ] `BACKUP-RECOVERY.md` written
- [ ] Git commit: "M7: Backups + error handling"

---

### M8: Testing, QA, Template Coordination

**Goal:** End-to-end testing of all M1–M7 features.

#### AI Prompt (Paste this into your AI tool):

```
I need a comprehensive test script for the Phase 1 campaign engine. Create a file: `tests/phase1-e2e.md` containing step-by-step manual test procedures.

Each test should have: description, steps to reproduce, expected result, and pass/fail checkbox.

### Test Cases:

1. **Campaign Creation & Editing**
   - Create a campaign with 5 steps → verify saved to DB.
   - Edit campaign name → verify updated.
   - Try creating with empty name → verify validation error.
   - Try activating with 0 steps → verify error message.

2. **Campaign Lifecycle**
   - Activate a campaign → verify status = 'active'.
   - Pause → verify status = 'paused'.
   - Resume → verify status = 'active'.
   - Stop → verify confirmation dialog, then status = 'stopped'.

3. **Sequence Engine**
   - Enrol 2 test leads into a campaign with 3 steps (delays: 0, 1, 3).
   - Run process endpoint → verify both get step 0 message.
   - Wait/advance time → verify step 1 sends after 1 day.
   - After last step → verify status = 'completed'.
   - Verify no duplicate sends.

4. **Response Detection**
   - Enrol a lead. Send campaign message. Simulate inbound reply.
   - Verify: enrolment status → 'responded'.
   - Verify: no further campaign messages sent.

5. **Classification**
   - Simulate "I'm interested" → classification = 'interested'.
   - Simulate "Not interested, too expensive" → classification = 'not_interested', reason = 'price'.
   - Simulate ambiguous response → classification = 'uncertain' → flagged for human review.
   - Verify all stored in campaign_classifications.

6. **Manual Controls & Audit**
   - Override a status manually → verify audit log entry.
   - Correct a classification → verify audit log entry + classified_by = 'manual'.
   - Remove a customer → verify status = 'removed' + cannot re-enrol.

7. **Dashboard & Reporting**
   - View campaign dashboard → all counts correct.
   - View individual campaign report → all stats calculate correctly.
   - View customer journey → shows correct history.

8. **Error Handling**
   - Send with invalid template → error logged, batch continues.
   - WhatsApp API down simulation → errors captured, no crash.
   - View failed messages on dashboard → failures visible.

9. **Multi-Campaign**
   - Run 2 campaigns simultaneously → verify both process independently.
   - Same phone in 2 campaigns → verify both send (Phase 1 behavior — no auto-conflict prevention).
   - One campaign stopped → other continues unaffected.

Output the test document as markdown with checkboxes: `- [ ] Test description`
```

#### Template Coordination (manual task):

- Coordinate with Keshlan/Horizon Africa: which WhatsApp templates are needed for Phase 1?
- At minimum: a follow-up template for each of the 5-sequence-step campaign pattern.
- Templates must be submitted to Meta via the existing template manager at `/templates`.
- Submission = 24–48h approval per template. Start early so templates are approved by M9 pilot.

#### Deliverable:
- [ ] `tests/phase1-e2e.md` with all test cases
- [ ] Template list confirmed with client
- [ ] Templates submitted to Meta
- [ ] All tests passing
- [ ] Git commit: "M8: Testing + template coordination"

---

### M9: Controlled Pilot & Acceptance

**Goal:** Controlled pilot with a limited number of real (or test) contacts, verifying the acceptance checklist from the Scope Freeze document.

#### Tasks:

1. **Pilot Setup**
   - Agree with Mo and Keshlan: how many test contacts, which campaign(s).
   - Create a test campaign in the production dashboard with the agreed scope.
   - Enrol the test contacts.

2. **Pilot Execution**
   - Run the campaign through its full lifecycle (messages sent, responses, classification, completions).
   - Monitor via the campaign dashboard.
   - Record any issues in a `pilot-issues.md` log.

3. **Acceptance Checklist** (from the Scope Freeze document, Section 4 + Section 7):

   | # | Feature | Criterion | Pass? |
   |---|---------|-----------|-------|
   | 4.1 | Campaign Creator | Create, name, configure campaigns from dashboard | [ ] |
   | 4.2 | Multi-Step Sequences | Configurable sequence of steps with different templates per step | [ ] |
   | 4.3 | Auto Progression | System sends next step at configured interval | [ ] |
   | 4.4 | Response Detection | Customer response stops sequence, routes to sales flow | [ ] |
   | 4.5 | Not-Interested Capture | Reason identified and stored on profile | [ ] |
   | 4.6 | Intent Classification | Every response classified; uncertain → human review | [ ] |
   | 4.7 | Interaction Tracking | Every message tracked: who, when, delivery, response, outcome | [ ] |
   | 4.7a | Failed Message Visibility | Failures logged, identifiable, visible to admin | [ ] |
   | 4.8 | Campaign Dashboard | Active campaigns, contacts per step, progress | [ ] |
   | 4.9 | Performance Report | Per-campaign: sent, delivery rate, response rate, entered sales flow, converted | [ ] |
   | 4.10 | Contact List Targeting | Select contacts/groups via broadcast system | [ ] |
   | 4.11 | Customer Profile Extension | Profile shows campaign history, last contact, last response, rejection reason | [ ] |
   | 4.12 | No-Response Flagging | Non-responders flagged after final step | [ ] |
   | 7.1 | Manual Controls | Status override, classification correction (stored), campaign removal | [ ] |
   | 7.1a | Audit Trail | Original value, amended value, user, date/time on manual changes | [ ] |
   | 7.2 | Basic Backups | Daily automated backups + documented restore path | [ ] |
   | 7.3 | Customer Journey View | Campaign → Customer → What happened flat record | [ ] |

4. **Sign-off**: Mo reviews the completed pilot and acceptance checklist. Keshlan signs. Final R27,500 payment due.

#### Deliverable:
- [ ] Pilot completed with real/test contacts
- [ ] `pilot-issues.md` log with all findings (and resolutions)
- [ ] Acceptance checklist: all items passed
- [ ] Git tag: `phase1-delivered`
- [ ] Final payment confirmation