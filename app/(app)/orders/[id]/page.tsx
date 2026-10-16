import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CheckCircle2, ExternalLink, Package, ShoppingBag } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import type { Lead, Order, OrderEvent, OrderStatus } from "@/lib/types";
import { formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

type OrderWithLead = Order & {
  lead: Pick<Lead, "id" | "full_name" | "email" | "phone_number"> | null;
};

const STATUS_LABELS: Record<OrderStatus, string> = {
  pending_payment: "Pending payment",
  paid: "Paid",
  payment_failed: "Payment failed",
  cancelled: "Cancelled",
  expired: "Expired",
};

const STATUS_STYLES: Record<OrderStatus, string> = {
  pending_payment: "bg-secondary-container/40 text-secondary",
  paid: "bg-tertiary-container/40 text-on-tertiary",
  payment_failed: "bg-error-container/40 text-on-error",
  cancelled: "bg-surface-container-high text-on-surface-variant",
  expired: "bg-surface-container-high text-on-surface-variant",
};

function money(cents: number | null, currency = "ZAR") {
  if (cents === null || cents === undefined) return "—";
  return `R${(cents / 100).toFixed(2)} ${currency === "ZAR" ? "" : currency}`.trim();
}

function addressText(address: Record<string, unknown> | null) {
  if (!address) return "—";
  return [
    address.address1 ?? address.line1 ?? address.street ?? address.address,
    address.address2 ?? address.line2 ?? address.suburb,
    address.city ?? address.town,
    address.province ?? address.state,
    address.zip ?? address.postal_code ?? address.postalCode,
    address.country,
  ]
    .filter(Boolean)
    .join(", ");
}

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [orderRes, eventsRes] = await Promise.all([
    supabase
      .from("orders")
      .select("*, lead:leads(id, full_name, email, phone_number)")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("order_events")
      .select("*")
      .eq("order_id", id)
      .order("created_at", { ascending: true }),
  ]);

  if (orderRes.error || !orderRes.data) notFound();

  const order = orderRes.data as OrderWithLead;
  const events = (eventsRes.data ?? []) as OrderEvent[];

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/orders"
          className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-secondary hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Orders
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-on-surface">
              Order #{order.order_number}
            </h1>
            <p className="mt-1 text-sm text-on-surface-variant">
              Created {formatDateTime(order.created_at)}
            </p>
          </div>
          <span className={`inline-flex rounded-full px-3 py-1.5 text-xs font-semibold ${STATUS_STYLES[order.status]}`}>
            {STATUS_LABELS[order.status]}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section className="card-shadow rounded-xl border border-surface-variant bg-surface-container-lowest p-5">
            <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-on-surface">
              <Package className="h-5 w-5 text-secondary" />
              Items
            </h2>
            <div className="divide-y divide-surface-variant/60">
              {order.items.map((item) => (
                <div key={`${item.variant_id}-${item.sku}`} className="flex items-start justify-between gap-4 py-3">
                  <div>
                    <p className="font-medium text-on-surface">{item.product_title}</p>
                    <p className="text-xs text-on-surface-variant">
                      {item.variant_title ?? "Default variant"}
                      {item.sku ? ` · SKU ${item.sku}` : ""}
                    </p>
                  </div>
                  <div className="text-right text-sm">
                    <p className="font-medium text-on-surface">× {item.qty}</p>
                    <p className="text-xs text-on-surface-variant">
                      {money(item.price_cents, order.currency)} each
                    </p>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 space-y-2 border-t border-surface-variant pt-4 text-sm">
              <div className="flex justify-between text-on-surface-variant">
                <span>Subtotal</span>
                <span>{money(order.subtotal_cents, order.currency)}</span>
              </div>
              <div className="flex justify-between text-on-surface-variant">
                <span>{order.delivery_method === "collection" ? "Collection" : "Delivery"}</span>
                <span>{money(order.delivery_fee_cents, order.currency)}</span>
              </div>
              <div className="flex justify-between text-base font-bold text-on-surface">
                <span>Total</span>
                <span>{money(order.total_cents, order.currency)}</span>
              </div>
            </div>
          </section>

          <section className="card-shadow rounded-xl border border-surface-variant bg-surface-container-lowest p-5">
            <h2 className="mb-4 text-lg font-semibold text-on-surface">Timeline</h2>
            {events.length === 0 ? (
              <p className="text-sm text-on-surface-variant">No order events recorded.</p>
            ) : (
              <ol className="relative ml-3 space-y-5 border-l border-outline-variant/50 pl-6">
                {events.map((event) => (
                  <li key={event.id} className="relative">
                    <span className="absolute -left-[31px] top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-secondary-container text-secondary">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    </span>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium capitalize text-on-surface">
                        {event.event.replace(/_/g, " ")}
                      </p>
                      <time className="text-xs text-on-surface-variant">
                        {formatDateTime(event.created_at)}
                      </time>
                    </div>
                    {event.detail && Object.keys(event.detail).length > 0 && (
                      <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-surface-container-low p-3 text-[11px] text-on-surface-variant">
                        {JSON.stringify(event.detail, null, 2)}
                      </pre>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        <aside className="space-y-6">
          <section className="card-shadow rounded-xl border border-surface-variant bg-surface-container-lowest p-5">
            <h2 className="mb-4 text-lg font-semibold text-on-surface">Customer</h2>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-xs uppercase tracking-wider text-on-surface-variant">Name</dt>
                <dd className="font-medium text-on-surface">
                  {order.customer_name ?? order.lead?.full_name ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wider text-on-surface-variant">Phone</dt>
                <dd className="font-medium text-on-surface">{order.phone_number}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wider text-on-surface-variant">Email</dt>
                <dd className="font-medium text-on-surface">
                  {order.customer_email ?? order.lead?.email ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wider text-on-surface-variant">Track</dt>
                <dd className="font-medium capitalize text-on-surface">
                  {order.order_track.replace(/_/g, " ")}
                </dd>
              </div>
            </dl>
          </section>

          <section className="card-shadow rounded-xl border border-surface-variant bg-surface-container-lowest p-5">
            <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-on-surface">
              <ShoppingBag className="h-5 w-5 text-secondary" />
              Fulfilment
            </h2>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-xs uppercase tracking-wider text-on-surface-variant">Method</dt>
                <dd className="font-medium capitalize text-on-surface">
                  {order.delivery_method ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wider text-on-surface-variant">Address</dt>
                <dd className="font-medium text-on-surface">{addressText(order.delivery_address)}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wider text-on-surface-variant">Paid at</dt>
                <dd className="font-medium text-on-surface">{formatDateTime(order.paid_at)}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wider text-on-surface-variant">Shopify draft</dt>
                <dd className="font-medium text-on-surface">
                  {order.shopify_draft_order_id ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wider text-on-surface-variant">Shopify order</dt>
                <dd className="font-medium text-on-surface">
                  {order.shopify_order_number ?? order.shopify_order_id ?? "—"}
                </dd>
              </div>
            </dl>
          </section>

          {order.payment_link && order.status === "pending_payment" && (
            <a
              href={order.payment_link}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-on-primary shadow-sm transition-all hover:brightness-110"
            >
              Open payment link
              <ExternalLink className="h-4 w-4" />
            </a>
          )}
        </aside>
      </div>
    </div>
  );
}
