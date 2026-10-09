# Horizon Africa Phase 1 Scope-Freeze Coverage Report

- Generated: 2026-10-07T10:39:37.142Z
- Base URL: http://localhost:3000
- Production mode: false
- UI skipped: false
- Live AI opt-in: false
- Totals: PASS 85, FAIL 0, PARTIAL 1, MANUAL 6, N/A 0

## Track Summary

| Track | PASS | FAIL | PARTIAL | MANUAL | N/A |
|---|---:|---:|---:|---:|---:|
| preflight | 6 | 0 | 0 | 0 | 0 |
| D | 8 | 0 | 0 | 0 | 0 |
| W | 5 | 0 | 1 | 1 | 0 |
| C | 17 | 0 | 0 | 0 | 0 |
| U | 25 | 0 | 0 | 0 | 0 |
| N | 17 | 0 | 0 | 2 | 0 |
| P | 7 | 0 | 0 | 3 | 0 |

## Matrix Results

| ID | Status | Check | Evidence / gap |
|---|---|---|---|
| preflight.PRE | PASS | Environment variables | http://localhost:3000; production=false |
| preflight.PRE | PASS | Dashboard server reachable | http://localhost:3000 HTTP 200 |
| preflight.PRE | PASS | Supabase service-role access | campaigns query returned 200 |
| preflight.PRE | PASS | Playwright browser | chromium launched |
| preflight.PRE | PASS | Real Fibre campaign safety | paused before suite |
| preflight.PRE | PASS | Coverage fixtures | group=62 campaign=df2aee29-19ec-463a-9434-6cb8ff80d3a8 |
| D.D1 | PASS | Core campaign + hardening tables/columns exist | 15 schema surfaces queried; Supabase REST SELECT evidence |
| D.D2 | PASS | Lead profile extension fields exist | score locks + campaign/profile fields selectable; leads SELECT projection |
| D.D3 | PASS | RLS blocks anonymous campaign reads | 7 campaign tables returned no anonymous rows |
| D.D4 | PASS | Unique constraints prevent duplicate sends/contact rows | interaction step=409, wamid=409, contact=409; insert attempt evidence |
| D.D5 | PASS | Audit trigger records old/new/user/timestamp | latest actor=test@horizonafrica.co.za; campaign_audit_log entity=ba4e1362-4cd6-4e0d-bb9b-4a1af01a1601 |
| D.D6 | PASS | Conversation trigger preserves locked lead score | COLD stayed COLD despite HOT snapshot; lead 10121 |
| D.D7 | PASS | Enrolment status check constraint rejects invalid values | HTTP 400 |
| D.D8 | PASS | Audit cleanup trigger removes orphaned enrolment audit | 0 rows after enrolment delete |
| W.W1 | PASS | Inbound AI Lead Qualification executes end-to-end | workflow kW4ELXolGnYx2AvB; ai_response captured; conversation 5066 |
| W.W2 | PASS | Campaign scheduler endpoint executes and writes heartbeat | processed=0 sent=0 failed=0; paused 0 external active campaigns during call; system_heartbeats 2026-10-07T01:09:51.333+00:00 |
| W.W3 | PASS | Follow-up sender executes isolated eligible send | cron_auth=401; isolated processed=1 sent=1 failed=0; workflow Jz1na3ZFwZG1V0Vq |
| W.W4 | PARTIAL | Missed Message Recovery detects eligible ai_response=null rows | eligible row 5067 seeded; scheduled n8n execution PvCdg60gkRYVxYOf requires N8N_API_KEY/manual capture |
| W.W5 | PASS | Delivery failure webhook persists failure + alert trail | row 6534b01a-965b-493a-b7d2-3035698d46ee; recipient=27995117564; workflow 9Hc0ZrL3H5LucMyA |
| W.W6 | MANUAL | Webhook/alert/ops workflow reviewed in n8n | Confirm workflow IDs in n8n UI/API: kW4ELXolGnYx2AvB, rOGNKmgeCRikitAe, Jz1na3ZFwZG1V0Vq, PvCdg60gkRYVxYOf, 9Hc0ZrL3H5LucMyA, plus remaining configured alert/recovery workflows; manual n8n workflow + execution IDs |
| W.W7 | PASS | Scheduler/integration health checks expose n8n + Meta + heartbeat | scheduler=healthy (Last run 1min ago); n8n=healthy; meta=healthy (Connected — +27 75 777 4389); GET /api/health |
| C.C1 | PASS | Campaign create/name/objective/date validation | 200-char boundary respected; duplicate=409; id=7a0c0c08-66bf-4184-8de1-e284c2af185d; campaign 7a0c0c08-66bf-4184-8de1-e284c2af185d |
| C.C2 | PASS | Multi-step sequence replacement preserves order + parameters | Day 0 -> Day 3 -> Day 5; contact_name body param retained; campaign 7a0c0c08-66bf-4184-8de1-e284c2af185d |
| C.C3 | PASS | Activation requires at least one sequence step | empty=400, populated=200 |
| C.C4 | PASS | Contact/group targeting enrols opted-in contacts only | enrolled=1; rows=2; skipped=1; campaign 7a0c0c08-66bf-4184-8de1-e284c2af185d |
| C.C5 | PASS | Failed Meta send is recorded and does not advance enrolment | failed interaction + campaign_errors row; step stayed 0; paused 0 external campaigns during call; interaction f0290d1d-002e-480f-8b5c-2f8e32f338b3 |
| C.C6 | PASS | Sequence delay prevents non-due sends; claim prevents duplicate sends | outbound rows=[{"step_number":1,"delivery_status":"failed"}] |
| C.C7 | PASS | Inbound campaign response detected; sequence stops; interaction recorded | status=responded, wamid=wamid.coverage-inbound-muxeoet8; interaction ba0543df-3627-4075-88b7-14627bcc8a7e |
| C.C8 | PASS | Intent classification covers frozen taxonomy | interested→interested, callback_requested→callback_requested, not_interested→not_interested, already_has_service→already_has_service, needs_information→needs_information, uncertain_or_other→uncertain |
| C.C9 | PASS | Not-interested reason taxonomy captured | price→price, already_has_service→already_has_service, competitor→competitor, not_needed→not_needed, not_now→not_now, needs_more_info→needs_more_info, not_eligible→not_eligible, other→not_now |
| C.C10 | PASS | Interaction tracking and failed-message visibility | stats.failedMessages=2; errors=2; interactions=17; stats API 7a0c0c08-66bf-4184-8de1-e284c2af185d |
| C.C11 | PASS | Campaign dashboard + performance metric math | sent=2, delivered=0, rate=0, responses=15, responseRate=750; dashboard-stats API |
| C.C12 | PASS | Customer profile campaign extension | last_campaign_response populated; lead 10121 |
| C.C13 | PASS | No-response flagging and late-response revival | no_response_final→responded; nurture=false |
| C.C14 | PASS | Simultaneous campaigns can enrol independent contacts | second campaign rows=2; no automatic conflict arbitration expected; campaign 7560ced1-721c-4a45-8e3a-1f59ee626f29 |
| C.C15 | PASS | STOP opts out active enrolments globally | 2 enrolments opted_out; opt_out row=9e7efd63-bb37-4365-9944-79992842e76d |
| C.C16 | PASS | Manual status/classification controls + removal + audit | cls=c3eaa095-6e4b-4933-a6b8-6efe5e37f7e8, corrected_by=test@horizonafrica.co.za, audit_rows=4 |
| C.C17 | PASS | Basic backup path covers campaign/customer data | backup-db.mjs includes all required tables; run `node scripts/backup-db.mjs <stamp>` for restore evidence; /Users/muhammedhusseinismail/Desktop/Projects/Horizon Africa/scripts/backup-db.mjs |
| U.U1 | PASS | Login page renders accessible fields + logo | http://localhost:3000/login; /Users/muhammedhusseinismail/Desktop/Projects/Horizon Africa/tests/screenshots/coverage/u1-login.png |
| U.U2 | PASS | Valid login lands on dashboard | http://localhost:3000/dashboard; /Users/muhammedhusseinismail/Desktop/Projects/Horizon Africa/tests/screenshots/coverage/u2-dashboard-logged-in.png |
| U.U3 | PASS | Overview dashboard renders KPI and recent sections | /dashboard; /Users/muhammedhusseinismail/Desktop/Projects/Horizon Africa/tests/screenshots/coverage/u3-dashboard.png |
| U.U4 | PASS | Leads table/search/list view | /leads; /Users/muhammedhusseinismail/Desktop/Projects/Horizon Africa/tests/screenshots/coverage/u4-leads.png |
| U.U5 | PASS | Conversation list/thread UX | /conversations; /Users/muhammedhusseinismail/Desktop/Projects/Horizon Africa/tests/screenshots/coverage/u5-conversations.png |
| U.U6 | PASS | Broadcast groups/form/history | /broadcasts; /Users/muhammedhusseinismail/Desktop/Projects/Horizon Africa/tests/screenshots/coverage/u6-broadcasts.png |
| U.U7 | PASS | Campaign list/manage navigation | /campaigns; /Users/muhammedhusseinismail/Desktop/Projects/Horizon Africa/tests/screenshots/coverage/u7-campaign-list.png |
| U.U8 | PASS | Campaign creator/sequence builder | /campaigns/create; /Users/muhammedhusseinismail/Desktop/Projects/Horizon Africa/tests/screenshots/coverage/u8-campaign-create.png |
| U.U9 | PASS | Campaign detail/status controls/sequence display | /campaigns/7a0c0c08-66bf-4184-8de1-e284c2af185d; /Users/muhammedhusseinismail/Desktop/Projects/Horizon Africa/tests/screenshots/coverage/u9-campaign-detail.png |
| U.U10 | PASS | Campaign enrolments/controls | /campaigns/7a0c0c08-66bf-4184-8de1-e284c2af185d/enrolments; /Users/muhammedhusseinismail/Desktop/Projects/Horizon Africa/tests/screenshots/coverage/u10-campaign-enrolments.png |
| U.U11 | PASS | Campaign audit view | /campaigns/7a0c0c08-66bf-4184-8de1-e284c2af185d/audit; /Users/muhammedhusseinismail/Desktop/Projects/Horizon Africa/tests/screenshots/coverage/u11-campaign-audit.png |
| U.U12 | PASS | Customer journey flat record | /campaigns/7a0c0c08-66bf-4184-8de1-e284c2af185d/customers/27995117564; /Users/muhammedhusseinismail/Desktop/Projects/Horizon Africa/tests/screenshots/coverage/u12-customer-journey.png |
| U.U13 | PASS | Campaign dashboard step distribution | /campaigns/dashboard; /Users/muhammedhusseinismail/Desktop/Projects/Horizon Africa/tests/screenshots/coverage/u13-campaign-dashboard.png |
| U.U14 | PASS | Campaign performance report | /campaigns/reports/7a0c0c08-66bf-4184-8de1-e284c2af185d; /Users/muhammedhusseinismail/Desktop/Projects/Horizon Africa/tests/screenshots/coverage/u14-campaign-report.png |
| U.U15 | PASS | Calling queue view/controls | /calling-queue; /Users/muhammedhusseinismail/Desktop/Projects/Horizon Africa/tests/screenshots/coverage/u15-calling-queue.png |
| U.U16 | PASS | Follow-up scheduler view | /follow-ups; /Users/muhammedhusseinismail/Desktop/Projects/Horizon Africa/tests/screenshots/coverage/u16-follow-ups.png |
| U.U17 | PASS | Template management UI | /templates; /Users/muhammedhusseinismail/Desktop/Projects/Horizon Africa/tests/screenshots/coverage/u17-templates.png |
| U.U18 | PASS | Product catalog manager | /products; /Users/muhammedhusseinismail/Desktop/Projects/Horizon Africa/tests/screenshots/coverage/u18-products.png |
| U.U19 | PASS | Reports analytics date range/charts | /reports; /Users/muhammedhusseinismail/Desktop/Projects/Horizon Africa/tests/screenshots/coverage/u19-reports.png |
| U.U20 | PASS | System health monitor | /health; /Users/muhammedhusseinismail/Desktop/Projects/Horizon Africa/tests/screenshots/coverage/u20-health.png |
| U.U21 | PASS | Settings alert email/status fields | /settings; /Users/muhammedhusseinismail/Desktop/Projects/Horizon Africa/tests/screenshots/coverage/u21-settings.png |
| U.U22 | PASS | Responsive layouts at 375/768/1440 | campaign dashboard renders without body overflow; /Users/muhammedhusseinismail/Desktop/Projects/Horizon Africa/tests/screenshots/coverage/u22-responsive-*.png |
| U.U23 | PASS | Protected campaign routes redirect logged-out users | http://localhost:3000/login |
| U.U24 | PASS | Invalid campaign route shows error/404 state | http://localhost:3000/campaigns/5fc2ee25-811a-49c8-b649-8e21db6b5fb9; /Users/muhammedhusseinismail/Desktop/Projects/Horizon Africa/tests/screenshots/coverage/u24-invalid-campaign.png |
| U.U25 | PASS | No console errors during UI track | 2 UI checks exercised |
| N.N1 | PASS | No mobile application deliverable | web dashboard only; no mobile routes/build artifacts |
| N.N2 | PASS | No third-party CRM integrations | no source/dependency hits for 'hubspot\|salesforce\|pipedrive\|zoho\|isp.*crm\|crm.*api' |
| N.N3 | PASS | No Google Sheets sync | no source/dependency hits for 'googleapis\|google.*sheet\|spreadsheets\.values\|google-auth\|googleSheets' |
| N.N4 | PASS | No SMS/email campaign channel | no source/dependency hits for 'twilio\|sms.*campaign\|sendgrid\|mailgun\|email.*campaign\|sms.*send' |
| N.N5 | PASS | No Voice/IVR integration | no source/dependency hits for 'twilio.*voice\|voice.*ivr\|ivr_\|call.*flow\|sip' |
| N.N6 | PASS | No custom AI model training/fine-tuning | no source/dependency hits for 'fine.?tun\|training.*model\|openai.*train\|model.*train\|lora' |
| N.N7 | PASS | No automatic rules-based segmentation | no source/dependency hits for 'auto.*segment\|rules.*segment\|dynamic.*campaign.*assign\|segmentation.*rules' |
| N.N8 | PASS | No automatic cross-campaign conflict prevention | manual targeting documented; no priority/exclusion engine found |
| N.N9 | PASS | No nurture campaign engine beyond flag | campaign_enrolments.nurture_flag only; no nurture sequences; schema/API inspection |
| N.N10 | PASS | No full Customer Intelligence Profile context feed | no source/dependency hits for 'customer intelligence\|intelligence.*profile\|profile.*feeding\|context.*profile' |
| N.N11 | PASS | No Phase 3 visual journey timeline | no source/dependency hits for 'animated.*timeline\|funnel.*journey\|cohort.*view\|visual.*journey\|timeline.*chart' |
| N.N12 | PASS | No per-customer pause/resume mid-sequence restore | campaign-level paused/active only; no per-customer restore UI/API; source route grep |
| N.N13 | PASS | No self-learning classification pipeline | no source/dependency hits for 'self.?learning\|automated.*retrain\|training.*pipeline\|learning.*pipeline' |
| N.N14 | PASS | No formal failed-message auto-retry daemon | no source/dependency hits for 'retry.*failed\|failed.*retry\|auto.?retry\|retry.*daemon\|queue.*retry' |
| N.N15 | PASS | No formal campaign-data CSV export | lead export only; no campaign export route found |
| N.N16 | PASS | No automatic in-flight workflow resume | no resume-on-service-restore workflow code found |
| N.N17 | PASS | Only OWD-template bulk upload exists | bulk-import route present; no non-template cleaning/mapping pipeline |
| N.N18 | MANUAL | Performance/load testing beyond current volume | No load-test artifacts required by Phase 1; confirm current production volume separately; manual capacity confirmation |
| N.N19 | MANUAL | Advanced DR/SLA outside scope | Basic backup path exists; formal RPO/RTO/recovery drills require platform/manual sign-off; manual backup/restore evidence |
| P.P1 | PASS | Production dashboard + webhook live on contracted domain | https://dashboard.horizonafrica.co.za; webhook challenge OK; https://dashboard.horizonafrica.co.za; /api/whatsapp-webhook |
| P.P2 | PASS | Meta webhook signature mode behaves as configured | unsigned=401; enforce=true; secret=true |
| P.P3 | PASS | Signed webhook accepted; retried wamid deduplicated | first=200, second=200, markers=1; wamid.coverage-dupe-muxz4ta0 |
| P.P4 | PASS | Meta WABA/phone/template approval evidence | +27 75 777 4389 quality=GREEN tier=undefined; templates=telkom_fibre_packages,telkom_reengagement; Meta Graph API |
| P.P5 | PASS | Delivery callbacks persist monotonic sent→delivered→read state | final=read; stale delivered ignored; interaction 977a5e4d-26c3-47e2-80f9-886d517ae35f |
| P.P6 | PASS | Production campaign scheduler endpoint reachable/authorized | http://localhost:3000/api/campaigns/process returned 200; fresh heartbeat written; /api/campaigns/process |
| P.P7 | PASS | OWD-template bulk upload deduped round-trip | imported=0 skipped=2; contact rows=1; /api/broadcasts/contacts/bulk-import |
| P.P8 | MANUAL | Pilot-readiness checklist remains client-controlled | Confirm lead segment count, enrollment plan, rollback steps, and written pilot scope before enrolling a live segment; client pilot sign-off |
| P.P9 | MANUAL | Supabase Pro daily backup + restore evidence | Confirm Pro plan, automated daily backups, and tested restore path at handover; Supabase dashboard/backup receipt |
| P.P10 | MANUAL | Full admin access inventory | Dashboard, Supabase, n8n, Vercel, and Meta admin access/credentials must be transferred at handover; access inventory checklist |

## Acceptance Readiness

- No blocking automated failures were recorded.
- 1 partial item(s) require targeted follow-up or an execution-ID/manual evidence attachment.
- 6 manual item(s) remain client/platform sign-offs.
- All generated test data is prefixed `[COVERAGE]`; cleanup warnings are listed in the JSON report.