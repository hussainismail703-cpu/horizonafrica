import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

const TABLES = [
  "leads", "conversations", "campaigns", "campaign_steps",
  "campaign_enrolments", "campaign_interactions", "campaign_classifications",
  "campaign_audit_log", "campaign_errors", "calling_queue", "opt_out_list",
  "broadcast_groups", "broadcast_contacts", "broadcast_history",
  "broadcast_recipients", "message_delivery_failures", "products",
  "app_settings", "staff_alerts", "tenants", "users",
];

const stamp = process.argv[2] || new Date().toISOString().slice(0, 10);
const dir = path.join(process.cwd(), "backups", stamp, "db");
fs.mkdirSync(dir, { recursive: true });

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const manifest = [];
for (const table of TABLES) {
  const rows = [];
  let from = 0;
  for (;;) {
    const { data, error } = await sb.from(table).select("*").range(from, from + 999);
    if (error) { console.error(`FAIL ${table}: ${error.message}`); break; }
    rows.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  fs.writeFileSync(path.join(dir, `${table}.json`), JSON.stringify(rows, null, 2));
  manifest.push(`- ${table}: ${rows.length} rows`);
  console.log(`${table}: ${rows.length} rows`);
}

fs.writeFileSync(
  path.join(dir, "..", "MANIFEST.md"),
  `# Backup ${stamp}\n\nTaken before webhook-hardening changes.\nRollback tag: backup/pre-hardening-${stamp}\n\n## Row counts\n${manifest.join("\n")}\n`
);
console.log(`\nDone → backups/${stamp}/db/`);
