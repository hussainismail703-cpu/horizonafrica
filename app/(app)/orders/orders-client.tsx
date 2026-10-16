"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ShoppingBag, Search, Clock3 } from "lucide-react";
import type { Lead, Order, OrderStatus, OrderTrack } from "@/lib/types";
import { formatDateTime } from "@/lib/format";

export type OrderWithLead = Order & {
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

const TRACK_LABELS: Record<OrderTrack, string> = {
  stock_on_hand: "Stock on hand",
  imported: "Imported",
};

function money(cents: number | null, currency = "ZAR") {
  if (cents === null || cents === undefined) return "—";
  return `R${(cents / 100).toFixed(2)} ${currency === "ZAR" ? "" : currency}`.trim();
}

function itemSummary(order: Order) {
  return order.items
    .map((item) => `${item.qty} × ${item.product_title}${item.variant_title ? ` (${item.variant_title})` : ""}`)
    .join(", ");
}

export function OrdersClient({ orders }: { orders: OrderWithLead[] }) {
  const [status, setStatus] = useState("");
  const [track, setTrack] = useState("");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter((order) => {
      if (status && order.status !== status) return false;
      if (track && order.order_track !== track) return false;
      if (!q) return true;
      return (
        String(order.order_number).includes(q) ||
        order.phone_number.toLowerCase().includes(q) ||
        (order.customer_name ?? order.lead?.full_name ?? "").toLowerCase().includes(q) ||
        (order.customer_email ?? order.lead?.email ?? "").toLowerCase().includes(q) ||
        itemSummary(order).toLowerCase().includes(q)
      );
    });
  }, [orders, status, track, search]);

  const pendingCount = orders.filter((o) => o.status === "pending_payment").length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-on-surface">Orders</h1>
          <p className="text-sm text-on-surface-variant">
            WhatsApp stock-on-hand orders, payment links and Shopify payment status
          </p>
        </div>
        {pendingCount > 0 && (
          <span className="inline-flex items-center gap-2 rounded-full bg-secondary-container/40 px-4 py-2 text-xs font-semibold text-secondary">
            <Clock3 className="h-4 w-4" />
            {pendingCount} awaiting payment
          </span>
        )}
      </div>

      <div className="card-shadow rounded-xl border border-surface-variant bg-surface-container-lowest p-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
              Status
            </label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full rounded-lg border border-surface-variant bg-surface px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
            >
              <option value="">All statuses</option>
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
              Track
            </label>
            <select
              value={track}
              onChange={(e) => setTrack(e.target.value)}
              className="w-full rounded-lg border border-surface-variant bg-surface px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
            >
              <option value="">All tracks</option>
              {Object.entries(TRACK_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
              Search
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-on-surface-variant" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Order, phone, customer, item…"
                className="w-full rounded-lg border border-surface-variant bg-surface py-2 pl-9 pr-3 text-sm text-on-surface outline-none focus:border-primary"
              />
            </div>
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="card-shadow rounded-xl border border-surface-variant bg-surface-container-lowest p-12 text-center">
          <ShoppingBag className="mx-auto mb-4 h-12 w-12 text-on-surface-variant/40" />
          <p className="text-sm text-on-surface-variant">
            {orders.length === 0
              ? "No orders yet. Orders created by Layla will appear here."
              : "No orders match the current filters."}
          </p>
        </div>
      ) : (
        <div className="card-shadow overflow-hidden rounded-xl border border-surface-variant bg-surface-container-lowest">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-surface-variant bg-surface-container-low text-xs uppercase tracking-wider text-on-surface-variant">
                <tr>
                  <th className="px-4 py-3 font-semibold">Order</th>
                  <th className="px-4 py-3 font-semibold">Customer</th>
                  <th className="px-4 py-3 font-semibold">Items</th>
                  <th className="px-4 py-3 font-semibold">Track</th>
                  <th className="px-4 py-3 font-semibold">Total</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Created</th>
                  <th className="px-4 py-3 font-semibold text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-variant/50">
                {filtered.map((order) => (
                  <tr key={order.id} className="transition-colors hover:bg-surface-container-low">
                    <td className="px-4 py-3 font-semibold text-on-surface">
                      #{order.order_number}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-on-surface">
                        {order.customer_name ?? order.lead?.full_name ?? "—"}
                      </div>
                      <div className="text-xs text-on-surface-variant">{order.phone_number}</div>
                    </td>
                    <td className="max-w-sm px-4 py-3 text-on-surface-variant">
                      <span className="line-clamp-2 text-xs">{itemSummary(order)}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex rounded-full bg-surface-container-high px-2.5 py-1 text-xs font-semibold text-on-surface-variant">
                        {TRACK_LABELS[order.order_track]}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium text-on-surface">
                      {money(order.total_cents, order.currency)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLES[order.status]}`}>
                        {STATUS_LABELS[order.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-on-surface-variant">
                      {formatDateTime(order.created_at)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/orders/${order.id}`}
                        className="rounded-lg bg-surface-container-high px-3 py-1.5 text-xs font-semibold text-on-surface transition-colors hover:bg-surface-container-highest"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
