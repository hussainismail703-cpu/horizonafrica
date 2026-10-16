import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import type { Lead, Order } from "@/lib/types";
import { OrdersClient } from "./orders-client";

export const dynamic = "force-dynamic";

export type OrderWithLead = Order & {
  lead: Pick<Lead, "id" | "full_name" | "email" | "phone_number"> | null;
};

export default async function OrdersPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("orders")
    .select("*, lead:leads(id, full_name, email, phone_number)")
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) {
    console.error("orders load error:", error);
    notFound();
  }

  return <OrdersClient orders={(data ?? []) as OrderWithLead[]} />;
}
