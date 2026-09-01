# Backup & Recovery Protocol — Horizon Africa Dashboard

**Project:** Horizon Africa WhatsApp AI Sales Dashboard
**Supabase Project:** `gbchhzipbbxpvgtaheze` (https://supabase.com/dashboard/project/gbchhzipbbxpvgtaheze)
**Last updated:** September 2026

---

## 1. When to Take a Backup

A **manual database backup is MANDATORY before every milestone** (M1–M9) and before
any schema migration. This is not optional — the dashboard is a production system
serving live WhatsApp conversations and leads.

| Trigger | Action |
|---|---|
| Before a new milestone (M1–M9) | Full backup + row counts |
| Before any SQL migration | Full backup + row counts |
| Before deploying to `main` | Full backup |
| Ad-hoc / weekly | Recommended full backup |

---

## 2. How to Take a Manual Backup

### Step 1: Download a full backup from Supabase

1. Go to the Supabase Dashboard:
   https://supabase.com/dashboard/project/gbchhzipbbxpvgtaheze
2. Click **Database** (left sidebar).
3. Click **Backups**.
4. Click **"Download Backup"**.
5. Save the `.sql` file to a safe location (NOT inside the Git repo):
   ```
   ~/horizon-backups/horizon-db-<milestone>-<YYYYMMDD>.sql
   ```
   Example: `~/horizon-backups/horizon-db-m7-20260901.sql`

### Step 2: Record row counts (for verification)

Open the Supabase **SQL Editor** and run:

```sql
SELECT
  schemaname, tablename,
  n_live_tup AS estimated_rows
FROM pg_stat_user_tables
ORDER BY n_live_tup DESC;
```

Save the output alongside the backup:
```
~/horizon-backups/horizon-db-<milestone>-<YYYYMMDD>-rowcounts.txt
```

### Step 3: Verify the backup

- The `.sql` file should be non-zero (typically 100 KB+).
- Open it in a text editor and spot-check that you can see
  `CREATE TABLE` statements and `INSERT`/`COPY` data.
- Compare the row counts from Step 2 against the previous backup's
  row counts — they should be consistent or growing.

### Step 4: Store safely

- Keep at least the **last 3 backups** at all times.
- Mo (reviewer/merger) should also keep a copy.
- Do NOT commit backup files to the Git repository.

---

## 3. How to Restore from Backup

### If the database is corrupted or a migration broke something:

1. Go to Supabase Dashboard → **Database** → **Backups**.
2. Scroll down to the **"Restore from backup"** section.
3. Upload the most recent valid `.sql` backup file (from Section 2).
4. Wait for restore to complete (5–15 minutes).
5. Verify by running the row-count query from Section 2, Step 2
   and comparing to the saved row counts.

### If the code breaks (but the database is fine):

```bash
# Revert to the last tagged milestone commit:
git checkout main
git revert --no-commit <bad-commit-hash>..HEAD
git commit -m "Revert: rolling back to phase1-mX-complete"
git push origin main

# Verify the build:
npm run build
```

### If BOTH code and database break:

1. Restore the database first (Section 3, above).
2. Then revert the code (above).
3. Run `npm run build` to verify.

---

## 4. Git Tags (Code Recovery Points)

Each completed milestone is tagged. Use these to find the last known-good state:

| Tag | Milestone |
|---|---|
| `phase1-m1-complete` | M1: Database schema |
| `phase1-m2-complete` | M2: Campaign Creator UI |
| `phase1-m3-complete` | M3: Follow-up sequence engine |
| `phase1-m4-complete` | M4: Response detection + classification |
| `phase1-m5-complete` | M5: Manual controls + audit trail + journey view |
| `phase1-m6-complete` | M6: Campaign dashboard + reporting |
| `phase1-m7-complete` | M7: Error handling + backups |

To see all tags:
```bash
git tag -l "phase1-*"
```

To check out a specific tagged state:
```bash
git checkout phase1-m6-complete
```

---

## 5. Emergency Contacts

| Role | Name | Responsibility |
|---|---|---|
| Developer | Hussain | Code changes, migrations, backups |
| Reviewer/Merger | Mo | PR review, merges to `main`, rollback approval |
| Client | Keshlan / Horizon Africa | Business decisions, pilot scope |

**In an emergency:**
1. Contact Hussain first (code + database).
2. If Hussain is unavailable, contact Mo (can approve rollback + restore).
3. If both unavailable, restore the database from the latest backup
   and revert code to the last tag.

---

## 6. Pre-Migration Checklist (Quick Reference)

Before running ANY SQL migration:

- [ ] Full backup downloaded and verified (Section 2)
- [ ] Row counts saved
- [ ] On a milestone sub-branch (`phase1/mX-*`)
- [ ] `npm run build` passes on current state
- [ ] Migration tested on a copy/staging if possible

After running the migration:

- [ ] Verify new tables/columns exist (`SELECT * FROM information_schema.tables WHERE table_name LIKE 'campaign%';`)
- [ ] Row counts unchanged for pre-existing tables
- [ ] `npm run build` still passes
- [ ] Commit + tag the milestone
