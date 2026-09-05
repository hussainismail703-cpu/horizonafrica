import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { CallingQueueClient } from "./queue-client";
import { CallingQueueItem, Campaign } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function CallingQueuePage() {
  const supabase = await createClient();

  const [queueRes, campaignsRes] = await Promise.all([
    supabase
      .from("calling_queue")
      .select(`
        *,
        campaign:campaigns(id, name)
      `)
      .order("created_at", { ascending: false }),
    supabase
      .from("campaigns")
      .select("id, name, status")
      .order("name", { ascending: true }),
  ]);

  if (queueRes.error) {
    console.error("calling queue load error:", queueRes.error);
    notFound();
  }

  const items = (queueRes.data ?? []) as (CallingQueueItem & {
    campaign: Pick<Campaign, "id" | "name"> | null;
  })[];

  const campaigns = (campaignsRes.data ?? []) as Pick<Campaign, "id" | "name" | "status">[];

  return <CallingQueueClient items={items} campaigns={campaigns} />;
}
