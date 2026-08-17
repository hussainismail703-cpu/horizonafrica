import { createClient } from "@/lib/supabase/server";
import { BroadcastForm, ContactsManager } from "@/components/broadcast-form";
import { BroadcastHistoryList } from "@/components/broadcast-history";
import { BroadcastGroup, BroadcastHistory, BroadcastContact } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function BroadcastsPage() {
  const supabase = await createClient();

  const [groupsRes, historyRes, contactsRes] = await Promise.all([
    supabase.from("broadcast_groups").select("*").order("id"),
    supabase.from("broadcast_history").select("*").order("created_at", { ascending: false }),
    supabase.from("broadcast_contacts").select("*").order("created_at", { ascending: false }),
  ]);

  const groups = (groupsRes.data ?? []) as BroadcastGroup[];
  const history = (historyRes.data ?? []) as BroadcastHistory[];
  const contacts = (contactsRes.data ?? []) as BroadcastContact[];

  const contactCounts = groups.map((g) => ({
    ...g,
    count: contacts.filter((c) => c.group_id === g.id).length,
  }));

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-on-surface-variant">
          Manage broadcast campaigns, groups, and contacts
        </p>
      </div>

      {/* Broadcast Group Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {contactCounts.map((g) => (
          <div key={g.id} className="card-shadow rounded-xl border border-surface-variant bg-surface-container-lowest p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">{g.group_label}</p>
                <p className="mt-1 text-3xl font-bold text-on-surface">{g.count}</p>
                <p className="text-xs text-on-surface-variant/60">contacts</p>
              </div>
              <div className="rounded-lg bg-secondary-container/20 px-3 py-2 text-xs font-semibold text-secondary">
                {g.group_name}
              </div>
            </div>
            {g.description && (
              <p className="mt-3 text-xs text-on-surface-variant">{g.description}</p>
            )}
          </div>
        ))}
      </div>

      {/* Form + Contacts Manager */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <BroadcastForm groups={groups} />
        <ContactsManager groups={groups} contacts={contacts} />
      </div>

      {/* Broadcast History */}
      <div className="card-shadow rounded-xl border border-surface-variant bg-surface-container-lowest p-6">
        <h2 className="mb-5 text-lg font-semibold text-on-surface">Broadcast History</h2>
        <BroadcastHistoryList history={history} />
      </div>
    </div>
  );
}
