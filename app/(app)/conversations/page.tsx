import { createClient } from "@/lib/supabase/server";
import { ConversationView } from "@/components/conversation-view";
import { LeadScore } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ConversationsPage() {
  const supabase = await createClient();
  const [{ data: threads }, { data: leads }] = await Promise.all([
    // One row per phone thread — scales with distinct customers, not total
    // messages. Individual threads are lazy-loaded on selection.
    supabase
      .from("conversation_threads")
      .select("*")
      .order("created_at", { ascending: false }),
    supabase.from("leads").select("phone_number, lead_score"),
  ]);

  const leadScores: Record<string, LeadScore> = {};
  leads?.forEach((l) => {
    leadScores[l.phone_number] = l.lead_score as LeadScore;
  });

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-on-surface-variant">
          WhatsApp conversation history between leads and the AI assistant
        </p>
      </div>
      <ConversationView threads={threads ?? []} leadScores={leadScores} />
    </div>
  );
}
