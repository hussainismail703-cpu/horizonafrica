# Campaign Engine — Front-End Test Guide

A step-by-step manual testing guide for the Horizon Africa campaign engine UI.
Work through each section in order. For each step, perform the action, then check
the **Expected result**. If something doesn't match, note it under **Fail notes**.

---

## Prerequisites

| Requirement | How to verify |
|-------------|---------------|
| Dev server running | `http://localhost:3000` loads without error |
| Authenticated session | You can log in and see the sidebar |
| Supabase connected | Campaign pages load data (not a blank error page) |
| `META_WABA_ID` set in `.env.local` | Template dropdown on campaign detail shows template names (if not set, dropdown shows "No templates available") |
| Test campaign exists | At least one campaign in the database (the "Local Test Campaign" from session 5) |
| Test enrolments exist | At least 2 enrolments (27820000001 responded, 27830000001 completed) |

> **Tip:** Open the browser console (DevTools → Console) while testing. Report
> any red errors you see there alongside the UI issue.

---

## Section 1 — Campaign List Page (`/campaigns`)

### 1.1 Page loads

1. Navigate to **Campaigns** from the sidebar (or go to `/campaigns` directly).

**Expected:**
- Page title "Campaigns" with subtitle "Create and manage WhatsApp campaign sequences"
- Two buttons in the top-right: **Dashboard** and **Create Campaign**
- A table listing all campaigns with columns: Name, Objective, Status, Start, End, Action
- Each row has a **Manage** button on the right
- Status badges are colour-coded (draft=grey, active=green, paused=purple, completed=teal, stopped=red)

### 1.2 Empty state (only if no campaigns exist)

1. If no campaigns exist, verify the empty state.

**Expected:**
- Megaphone icon
- "No campaigns yet" heading
- "Create your first campaign…" text
- A **Create Campaign** button

### 1.3 Navigate to campaign detail

1. Click **Manage** on any campaign row.

**Expected:**
- Redirects to `/campaigns/[id]` (campaign detail page)

---

## Section 2 — Create Campaign Page (`/campaigns/create`)

### 2.1 Form renders

1. From the campaign list, click **Create Campaign**.

**Expected:**
- Form with fields: Campaign Name (required, red asterisk), Objective (textarea), Start Date, End Date, Target Group (dropdown, optional)
- **Cancel** and **Create Campaign** buttons at the bottom
- Create button is disabled when name is empty

### 2.2 Create a campaign

1. Enter a name (e.g. "Frontend Test Campaign")
2. Enter an objective (e.g. "Testing the campaign creation flow")
3. Optionally pick a start date and target group
4. Click **Create Campaign**

**Expected:**
- Button shows "Creating…" with a spinner
- Toast notification: "Campaign created"
- Redirects to the new campaign's detail page (`/campaigns/[new-id]`)
- The campaign appears in the campaign list when you navigate back

### 2.3 Validation — empty name

1. Go to `/campaigns/create`
2. Leave the name empty
3. Click **Create Campaign**

**Expected:**
- Button is disabled (cannot submit)
- No network request is made

### 2.4 Cancel button

1. Go to `/campaigns/create`
2. Click **Cancel**

**Expected:**
- Returns to the previous page (browser back)

---

## Section 3 — Campaign Detail Page (`/campaigns/[id]`)

### 3.1 Page renders with all sections

1. Navigate to any campaign's detail page.

**Expected:**
- Back to Campaigns link (top-left)
- Top-right buttons: **Report**, **Enrolments**, **Audit Trail**, and a status badge
- Three card sections:
  1. **Campaign Details** — editable name, objective, start/end dates, group selector, Save Details button
  2. **Message Sequence** — step builder with Add Step button
  3. **Campaign Status** — Activate / Pause / Stop buttons
- Below the cards: a collapsible **Error Monitoring** section

### 3.2 Edit campaign metadata

1. Change the campaign name
2. Change the objective
3. Click **Save Details**

**Expected:**
- Button shows spinner briefly
- Toast: "Campaign saved"
- Page refreshes; new values are displayed

### 3.3 Group selector

1. Open the Group dropdown

**Expected:**
- Shows "No group" as the first option
- Lists all broadcast groups with format: `Group Label (group_name)`
- If `META_WABA_ID` is not configured, this still works (groups come from Supabase, not Meta)

### 3.4 Sequence builder — add a step

1. In the Message Sequence section, click **Add Step**

**Expected:**
- A new step row appears with:
  - A numbered circle (step number)
  - Delay (days) input — defaults to 0 for first step, 1 for subsequent steps
  - WhatsApp Template dropdown
  - A trash icon to remove the step
- If templates loaded: dropdown shows approved template names with human-readable labels
- If templates failed to load: dropdown shows "No templates available"

### 3.5 Sequence builder — template dropdown

1. Click the template dropdown on a step

**Expected (if `META_WABA_ID` is configured):**
- Shows "Loading templates…" briefly, then populates with template names
- Each option shows a human-readable label (e.g. "Welcome to Horizon Africa" instead of "horizon_welcome_v1")

**Expected (if `META_WABA_ID` is NOT configured):**
- Dropdown shows "No templates available"
- You can still type a template name manually (the select is disabled, but the step saves with empty template_name)

> **Note:** If templates aren't loading, add `META_WABA_ID` to `.env.local` and restart the dev server.

### 3.6 Sequence builder — remove a step

1. Add 2 steps
2. Click the trash icon on the first step

**Expected:**
- The step is removed
- Remaining steps are renumbered (step numbers update sequentially)

### 3.7 Save sequence

1. Add at least one step with a template selected
2. Click **Save Sequence**

**Expected:**
- Button shows spinner with Save icon
- Toast: "Sequence saved"
- Page refreshes

### 3.8 Save sequence — validation

1. Add a step but leave the template empty (if templates aren't loading, this may happen)
2. Click **Save Sequence**

**Expected:**
- Toast error: "Every step needs a template"
- No save request is sent

### 3.9 Status controls — activate

1. On a draft campaign with at least one step, click **Activate**

**Expected:**
- Status badge changes to "active" (green)
- Toast: "Campaign active"
- The Activate button disappears; Pause and Stop buttons appear

### 3.10 Status controls — activate without steps

1. On a campaign with zero steps, try to click Activate

**Expected:**
- Activate button is disabled
- Helper text: "Add at least one sequence step before activating."

### 3.11 Status controls — pause

1. On an active campaign, click **Pause**

**Expected:**
- Status badge changes to "paused" (purple)
- Toast: "Campaign paused"
- Pause button disappears; Activate and Stop buttons appear

### 3.12 Status controls — stop

1. On an active or paused campaign, click **Stop**

**Expected:**
- A confirmation dialog: "Are you sure you want to stop this campaign? Enrolled contacts will no longer receive messages."
- Click Cancel → nothing happens
- Click OK → status changes to "stopped" (red), toast: "Campaign stopped"
- A message appears: "This campaign has been stopped. Create a new campaign to re-engage these leads."

### 3.13 Error Monitoring section

1. Scroll to the bottom of the campaign detail page
2. Click the **Error Monitoring** header to expand it

**Expected:**
- Section expands
- Shows a table with columns: Type, Phone, Message, When
- If errors exist: rows with error type badges (red), phone numbers, error messages, timestamps
- If no errors: "No errors recorded for this campaign."
- Click the header again to collapse

---

## Section 4 — Enrolments Page (`/campaigns/[id]/enrolments`)

### 4.1 Page renders

1. From the campaign detail page, click **Enrolments** (top-right)

**Expected:**
- Back to Campaign link
- Title: "Enrolments — [Campaign Name]"
- **Enrol Contacts** button (top-right)
- A table with columns: Phone, Name, Step, Status, Classification, Actions
- Each phone number is a link (blue, underlined on hover) to the customer journey page
- Status badges are colour-coded
- If a classification exists, it shows the classification text and rejection reason (if any)
- A pencil icon (✎) appears next to manually-corrected classifications

### 4.2 Enrol Contacts panel — open/close

1. Click **Enrol Contacts**

**Expected:**
- A panel appears with:
  - "Enrol from Group" dropdown
  - "— or —" divider
  - "Enter Phone Numbers Manually" textarea
  - Cancel and Enrol Contacts buttons

2. Click **Cancel**

**Expected:**
- Panel closes

### 4.3 Enrol Contacts — manual phone entry

1. Open the enrol panel
2. Enter phone numbers in the textarea (comma or newline separated, e.g. `27841111111, 27842222222`)
3. Click **Enrol Contacts**

**Expected:**
- Button shows "Enrolling…" with spinner
- Toast: "Enrolled 2 contacts" (or similar)
- Panel closes
- Table refreshes; new enrolments appear with status "active", step 0

### 4.4 Enrol Contacts — group selection

1. Open the enrol panel
2. Select a group from the dropdown
3. Click **Enrol Contacts**

**Expected:**
- All contacts in that group are enrolled
- Toast shows count: "Enrolled N contacts (M already active)" if some were already enrolled

### 4.5 Enrol Contacts — validation

1. Open the enrol panel
2. Leave both group and phone numbers empty
3. Click **Enrol Contacts**

**Expected:**
- Button is disabled (cannot click)
- OR toast error: "Select a group or enter phone numbers"

### 4.6 Override status

1. Find an enrolment in the table
2. Use the "Override status…" dropdown on its row
3. Select a new status (e.g. "responded")

**Expected:**
- Spinner appears on the row
- Toast: "Status changed to responded"
- Table refreshes; the status badge updates

### 4.7 Remove enrolment

1. Find an enrolment with status != "removed"
2. Click the **Remove** button on its row

**Expected:**
- Spinner appears
- Toast: "Status changed to removed"
- Status badge changes to "removed" (red)
- The Remove button disappears for that row

### 4.8 Correct classification

1. Find an enrolment that has a classification
2. Use the "Correct classification…" dropdown
3. Select a new classification (e.g. "not_interested")

**Expected:**
- Spinner appears
- Toast: "Classification corrected"
- Table refreshes; classification text updates
- A pencil icon (✎) appears next to the corrected classification (indicating manual override)

### 4.9 Correct classification with rejection reason

1. Find an enrolment with a classification
2. Open the "Correct classification…" dropdown
3. Scroll to the combined options at the bottom (e.g. "not_interested — price")
4. Select one

**Expected:**
- Classification updates to show both the classification and rejection reason in parentheses
- Example: "not_interested (price)"

### 4.10 Navigate to customer journey

1. Click any phone number link in the enrolments table

**Expected:**
- Redirects to `/campaigns/[id]/customers/[phone]`

---

## Section 5 — Customer Journey Page (`/campaigns/[id]/customers/[phone]`)

### 5.1 Page renders with all sections

**Expected:**
- Back to Enrolments link
- Title: "Customer Journey — [phone number]"
- Four card sections:
  1. **Customer Info** — phone, name, email, lead status, last campaign contact, last campaign response, rejection reason, nurture flag
  2. **Campaign** — campaign name, enrolled date, current step, enrolment status
  3. **Classification** — classification, rejection reason, confidence %, classified by
  4. **Interactions** — chronological list of all outbound/inbound messages
- If there's an inbound message, a **Last Response** card appears at the bottom

### 5.2 Customer Info section

**Expected:**
- Phone number matches the URL
- Name shows the lead's full_name (or "—" if unknown)
- Email shows the lead's email (or "—")
- Lead status shows the lead's current status
- Last Campaign Contact shows a formatted date/time (or "—")
- Last Campaign Response shows a formatted date/time (or "—")
- Rejection Reason shows the lead's rejection_reason (or "—")
- Nurture Flag shows "Yes" or "No"
- If the lead has notes, a Notes section appears below the grid

### 5.3 Interactions timeline

**Expected:**
- Each interaction is a card:
  - Outbound messages have a green/blue tint background
  - Inbound messages have a purple tint background
  - Shows message type (outbound/inbound), step number (if applicable)
  - Shows timestamp (formatted)
  - Shows template name (for outbound) in monospace font
  - Shows message body (for inbound)
  - Shows delivery status with colour coding (sent=green, delivered=green, read=teal, failed=red)
- Interactions are ordered chronologically (oldest first)

### 5.4 Classification section

**Expected:**
- If a classification exists: shows classification (capitalized), rejection reason, confidence as percentage, classified by (ai/manual)
- If corrected: shows "(by [user])" after the classified by field
- If no classification: "No classification recorded yet."

### 5.5 Last Response section

**Expected:**
- Only appears if there's at least one inbound message
- Shows the timestamp and message body of the last inbound message

### 5.6 Invalid phone number

1. Navigate to `/campaigns/[valid-id]/customers/0000000000` (a phone that doesn't exist)

**Expected:**
- 404 page (Not Found)

---

## Section 6 — Audit Trail Page (`/campaigns/[id]/audit`)

### 6.1 Page renders

1. From the campaign detail page, click **Audit Trail** (top-right)

**Expected:**
- Back to Campaign link
- Title: "Audit Trail — [Campaign Name]"
- A table with columns: Date/Time, User, Entity, Field, Old → New
- Each row shows a change with old value → new value (with a purple arrow between them)

### 6.2 Audit entries appear after manual changes

1. Go to the enrolments page and override an enrolment's status
2. Navigate to the audit trail page

**Expected:**
- A new row appears showing:
  - Date/Time of the change
  - User who made the change (your email)
  - Entity type (e.g. "enrolment")
  - Field changed (e.g. "status")
  - Old value → New value (e.g. "active → responded")

### 6.3 Empty state

1. If no manual changes have been made, the audit trail shows:

**Expected:**
- "No audit entries yet. Manual changes to enrolments and classifications will appear here."

---

## Section 7 — Campaign Dashboard (`/campaigns/dashboard`)

### 7.1 Page renders

1. From the campaign list, click **Dashboard**

**Expected:**
- Back to Campaigns link
- Title: "Campaign Dashboard" with subtitle "Performance overview across all campaigns"
- Four stat cards: Active Campaigns, Enrolled Customers, Messages Sent Today, Responses Today
- A table titled "All Campaigns" with columns: Campaign, Status, Enrolled, Step Distribution, Responses, Conversions, Action
- Each row has **Report** and **Manage** buttons

### 7.2 Stat cards show correct values

**Expected:**
- Active Campaigns: count of campaigns with status "active"
- Enrolled Customers: total enrolments across all campaigns
- Messages Sent Today: count of outbound interactions with occurred_at today
- Responses Today: count of inbound interactions with occurred_at today

### 7.3 Step distribution

**Expected:**
- Shows a compact representation like "S1: 2  ·  S2: 1" (step number: count of enrolments at that step)
- If no enrolments: "—"

### 7.4 Navigate to report

1. Click **Report** on any campaign row

**Expected:**
- Redirects to `/campaigns/reports/[id]`

### 7.5 Empty state

1. If no campaigns exist:

**Expected:**
- "No campaigns yet. Create one to see performance here."
- A **Create Campaign** button

---

## Section 8 — Campaign Report Page (`/campaigns/reports/[id]`)

### 8.1 Page renders with all sections

1. Navigate to any campaign's report page (via Dashboard or Campaign Detail → Report)

**Expected:**
- Back to Dashboard link
- Manage Campaign link (top-right)
- Title: "[Campaign Name] — Performance Report"
- Eight stat cards in two rows:
  - Row 1: Messages Sent, Delivery Rate, Response Rate, Entered Sales Flow
  - Row 2: Converted, Failed Messages, Total Enrolled, Active Enrolled
- **Enrolment Status Breakdown** section (4 boxes: Active, Responded, Completed, Removed)
- **Per-Step Performance** section (bar chart)
- **Rate Summary** section (4 cards: Delivery Rate, Read Rate, Response Rate, Conversion Rate)
- **Recent Interactions** table
- **Failed Messages** table
- **Engine Error Log** table

### 8.2 Stat cards

**Expected:**
- Messages Sent: count of outbound interactions
- Delivery Rate: percentage (delivered / sent), or "N/A" if no messages sent
- Response Rate: percentage (responses / sent), or "N/A"
- Entered Sales Flow: count of enrolments classified as "interested"
- Converted: count of enrolments with status "completed" that responded
- Failed Messages: count of interactions with delivery_status "failed"
- Total Enrolled: total enrolments for this campaign
- Active Enrolled: enrolments with status "active"

### 8.3 Per-step performance chart

**Expected:**
- A bar chart with one group per step
- Three bars per step: Sent (purple), Delivered (green), Responses (blue)
- X-axis: "Step 1", "Step 2", etc.
- Y-axis: counts
- If no interactions: "No interactions yet for this campaign."

### 8.4 Rate summary cards

**Expected:**
- Delivery Rate: percentage with subtitle "N delivered / M sent"
- Read Rate: percentage with subtitle "N read / M delivered"
- Response Rate: percentage with subtitle "N responses / M sent"
- Conversion Rate: percentage with subtitle "N converted / M sent"

### 8.5 Recent interactions table

**Expected:**
- Columns: Phone, Type, Template, Status, When
- Type badges: outbound (teal) / inbound (blue)
- Status badges: colour-coded (delivered/read = green, failed = red, sent/pending = grey)
- Shows up to 10 most recent interactions
- If none: "No interactions recorded yet."

### 8.6 Failed messages table

**Expected:**
- Columns: Phone, Step, Template, Error, When
- Shows interactions with delivery_status "failed"
- Error column shows the Meta API error message
- If none: "No failed messages. All sends delivered successfully."

### 8.7 Engine error log

**Expected:**
- Columns: Type, Phone, Message, When
- Shows recent errors from the campaign_errors table
- Error type shown as a red badge
- If none: "No engine errors recorded for this campaign."

---

## Section 9 — Cross-Page Navigation

### 9.1 Full navigation flow

1. Start at `/campaigns` (campaign list)
2. Click **Dashboard** → `/campaigns/dashboard`
3. Click **Back to Campaigns** → returns to `/campaigns`
4. Click **Create Campaign** → `/campaigns/create`
5. Click **Cancel** → returns to `/campaigns`
6. Click **Manage** on a campaign → `/campaigns/[id]`
7. Click **Enrolments** → `/campaigns/[id]/enrolments`
8. Click a phone number → `/campaigns/[id]/customers/[phone]`
9. Click **Back to Enrolments** → returns to enrolments
10. Click **Back to Campaign** → returns to campaign detail
11. Click **Audit Trail** → `/campaigns/[id]/audit`
12. Click **Back to Campaign** → returns to campaign detail
13. Click **Report** → `/campaigns/reports/[id]`
14. Click **Back to Dashboard** → `/campaigns/dashboard`
15. Click **Manage** on a campaign → `/campaigns/[id]`

**Expected:** Every link works and lands on the correct page with no errors.

---

## Section 10 — Responsive / Edge Cases

### 10.1 Mobile layout

1. Resize the browser to ~375px width (mobile viewport)
2. Go through the campaign list, detail, and enrolments pages

**Expected:**
- Tables scroll horizontally
- Card grids stack vertically (single column)
- Buttons remain tappable
- No horizontal overflow on the page itself

### 10.2 Long campaign name

1. Create a campaign with a very long name (120 characters — the max)

**Expected:**
- Name displays without breaking layout
- Table cells don't overflow

### 10.3 Campaign with no steps

1. Create a new campaign but don't add any steps

**Expected:**
- Sequence builder shows: "No steps yet. Click "Add Step" to build your follow-up sequence."
- Activate button is disabled
- Helper text: "Add at least one sequence step before activating."

### 10.4 Campaign with no enrolments

1. Go to the enrolments page for a campaign with no enrolments

**Expected:**
- "No enrolments yet for this campaign."

### 10.5 Deleted/nonexistent campaign

1. Navigate to `/campaigns/nonexistent-id`

**Expected:**
- 404 page (Not Found)

---

## Test Results Summary

| Section | Page | Pass/Fail | Notes |
|---------|------|-----------|-------|
| 1 | Campaign List | | |
| 2 | Create Campaign | | |
| 3 | Campaign Detail | | |
| 4 | Enrolments | | |
| 5 | Customer Journey | | |
| 6 | Audit Trail | | |
| 7 | Dashboard | | |
| 8 | Report | | |
| 9 | Cross-Page Navigation | | |
| 10 | Responsive / Edge Cases | | |

---

## Known Issues (as of testing)

1. **Template dropdown may show "No templates available"** — this happens when `META_WABA_ID` is not set in `.env.local`. The templates API endpoint requires it to fetch approved templates from Meta. Campaign steps can still be saved with manually-typed template names, but the dropdown won't populate until the env var is added.

2. **Audit trail may show entries from test data** — the 11 audit log entries from session 5 testing will appear. This is expected.

3. **`hello_world` template** — the test campaign uses the default Meta `hello_world` template. Real campaigns should use approved business templates.
