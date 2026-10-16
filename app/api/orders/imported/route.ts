import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { createImportedOrder } from "@/lib/orders";

// POST /api/orders/imported
// Called by n8n when a customer wants an imported/online-order item. Layla
// has already explained the 6-week lead time + 50% deposit terms; this route
// records the enquiry on the imported track and hands it to the orders team
// (the handover email itself goes via n8n/Brevo — no email code here).
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const appSecret = process.env.APP_SECRET;
  if (!appSecret || authHeader !== `Bearer ${appSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json(
      { error: "Request body must be a JSON object" },
      { status: 400 }
    );
  }

  const phone = body.phone ?? body.phone_number;
  if (typeof phone !== "string" || !phone.trim()) {
    return NextResponse.json({ error: "phone is required" }, { status: 400 });
  }

  const itemDescription = body.item_description ?? body.item ?? body.description;
  if (typeof itemDescription !== "string" || !itemDescription.trim()) {
    return NextResponse.json(
      { error: "item_description is required" },
      { status: 400 }
    );
  }

  const customer =
    body.customer && typeof body.customer === "object" && !Array.isArray(body.customer)
      ? (body.customer as Record<string, unknown>)
      : {};

  const result = await createImportedOrder(createServiceClient(), {
    phone,
    item_description: itemDescription,
    notes: typeof body.notes === "string" ? body.notes : null,
    customer: {
      name: typeof customer.name === "string" ? customer.name.slice(0, 200) : null,
      email: typeof customer.email === "string" ? customer.email.slice(0, 200) : null,
    },
  });

  if (!result.ok) {
    const status =
      result.error === "invalid_phone" || result.error === "invalid_item" ? 400 : 502;
    return NextResponse.json(result, { status });
  }

  const order = result.order;
  return NextResponse.json(
    {
      ok: true,
      order_id: order.id,
      order_number: order.order_number,
      order_track: order.order_track,
      status: order.status,
    },
    { status: 201 }
  );
}
