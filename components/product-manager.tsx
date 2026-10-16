"use client";

import { useState, useEffect, useCallback } from "react";
import { RefreshCw, Package, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { formatDateTime } from "@/lib/format";
import type { ShopifyProductRow, ShopifyVariantRow } from "@/lib/types";

type CatalogProduct = ShopifyProductRow & {
  shopify_variants: ShopifyVariantRow[];
};

function formatPrice(cents: number | null): string {
  if (cents === null || cents === undefined) return "—";
  const rands = cents / 100;
  return `R${rands % 1 === 0 ? rands.toFixed(0) : rands.toFixed(2)}`;
}

function formatType(type: string | null): string {
  if (!type) return "Uncategorised";
  return type
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function ProductManager() {
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [notConfigured, setNotConfigured] = useState(false);

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/shopify/products");
      if (!res.ok) throw new Error("Failed to fetch products");
      const data = await res.json();
      setProducts(data.products || []);
    } catch {
      toast.error("Failed to load catalog");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  async function handleSync() {
    setSyncing(true);
    setNotConfigured(false);
    try {
      const res = await fetch("/api/shopify/sync-products", { method: "POST" });
      const data = await res.json();
      if (res.status === 503) {
        setNotConfigured(true);
        return;
      }
      if (!res.ok) throw new Error(data.error || "Sync failed");
      toast.success(
        `Synced ${data.products_upserted} products / ${data.variants_upserted} variants` +
          (data.products_deactivated ? ` · ${data.products_deactivated} removed` : "")
      );
      fetchProducts();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-on-surface-variant" />
      </div>
    );
  }

  const latestSync = products
    .map((p) => p.last_synced_at)
    .filter(Boolean)
    .sort()
    .pop();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-on-surface">
            {products.length} {products.length === 1 ? "Product" : "Products"}
          </h2>
          {latestSync && (
            <p className="text-xs text-on-surface-variant">
              Last synced {formatDateTime(latestSync)}
            </p>
          )}
        </div>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-on-primary shadow-sm transition-all hover:brightness-110 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
          {syncing ? "Syncing…" : "Sync now"}
        </button>
      </div>

      {notConfigured && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          Shopify isn&apos;t configured yet. Set <code>SHOPIFY_STORE_DOMAIN</code> and{" "}
          <code>SHOPIFY_ADMIN_ACCESS_TOKEN</code> in the environment, then sync.
        </div>
      )}

      <div className="grid gap-3">
        {products.map((product) => {
          const totalStock = product.shopify_variants.reduce(
            (sum, v) => sum + (v.inventory_qty ?? 0),
            0
          );
          const inStock = product.shopify_variants.some((v) => v.available);
          return (
            <div
              key={product.id}
              className={`card-shadow rounded-xl border border-surface-variant bg-surface-container-lowest p-5 ${!product.is_active ? "opacity-60" : ""}`}
            >
              <div className="flex items-start gap-4">
                {product.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={product.image_url}
                    alt={product.title}
                    className="h-14 w-14 rounded-lg object-cover"
                  />
                ) : (
                  <div className="rounded-lg bg-surface-container-high p-2.5">
                    <Package className="h-5 w-5 text-secondary" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-on-surface">{product.title}</p>
                    {!product.is_active && (
                      <span className="rounded-full bg-surface-container-high px-2 py-0.5 text-[10px] font-semibold text-on-surface-variant">
                        Inactive
                      </span>
                    )}
                    {!inStock && product.is_active && (
                      <span className="rounded-full bg-error-container px-2 py-0.5 text-[10px] font-semibold text-on-error">
                        Out of stock
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-sm text-on-surface-variant">
                    {formatType(product.category)} · {totalStock} in stock
                  </p>
                  {product.description && (
                    <p className="mt-1 line-clamp-2 text-xs text-on-surface-variant">
                      {product.description}
                    </p>
                  )}
                  {product.shopify_variants.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {product.shopify_variants.map((v) => (
                        <span
                          key={v.id}
                          className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${
                            v.available
                              ? "border-outline-variant bg-surface-container-lowest text-on-surface"
                              : "border-transparent bg-surface-container-high text-on-surface-variant line-through"
                          }`}
                          title={v.sku ? `SKU ${v.sku}` : undefined}
                        >
                          {v.title || "Default"} · {formatPrice(v.price_cents)} ·{" "}
                          {v.inventory_qty ?? 0} left
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {products.length === 0 && !notConfigured && (
          <div className="rounded-xl border border-dashed border-outline-variant p-12 text-center">
            <Package className="mx-auto h-8 w-8 text-on-surface-variant" />
            <p className="mt-2 text-sm text-on-surface-variant">
              No products synced yet. Click &quot;Sync now&quot; to pull the Shopify catalog.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
