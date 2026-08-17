"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, Pencil, Trash2, X, Package, Wifi, Zap, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface Product {
  id: number;
  name: string;
  product_type: string;
  speed_down: number | null;
  speed_up: number | null;
  price_cents: number | null;
  billing_period: string;
  description: string | null;
  is_uncapped: boolean;
  is_active: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
}

const PRODUCT_TYPES = ["fibre", "lte", "wireless", "other"];
const BILLING_PERIODS = ["monthly", "once-off"];

function formatPrice(cents: number | null): string {
  if (cents === null || cents === undefined) return "Price on request";
  const rands = cents / 100;
  return `R${rands % 1 === 0 ? rands.toFixed(0) : rands.toFixed(2)}`;
}

function typeIcon(type: string) {
  switch (type) {
    case "fibre": return Wifi;
    case "lte": return Zap;
    case "wireless": return Zap;
    default: return Package;
  }
}

export function ProductManager() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/products");
      if (!res.ok) throw new Error("Failed to fetch products");
      const data = await res.json();
      setProducts(data.products || []);
    } catch {
      toast.error("Failed to load products");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  async function handleSave(product: Partial<Product> & { id?: number }) {
    const isEditing = !!product.id;
    const url = isEditing ? `/api/products/${product.id}` : "/api/products";
    const method = isEditing ? "PATCH" : "POST";

    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(product),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to save product");
      }
      toast.success(isEditing ? "Product updated" : "Product created");
      setShowForm(false);
      setEditingProduct(null);
      fetchProducts();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save product");
    }
  }

  async function handleDelete(id: number) {
    try {
      const res = await fetch(`/api/products/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to delete product");
      }
      toast.success("Product deleted");
      setDeletingId(null);
      fetchProducts();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete product");
      setDeletingId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-on-surface-variant" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-on-surface">
          {products.length} {products.length === 1 ? "Product" : "Products"}
        </h2>
        <button
          onClick={() => { setEditingProduct(null); setShowForm(true); }}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-on-primary shadow-sm transition-all hover:brightness-110"
        >
          <Plus className="h-4 w-4" />
          Add Product
        </button>
      </div>

      <div className="grid gap-3">
        {products.map((product) => {
          const Icon = typeIcon(product.product_type);
          return (
            <div
              key={product.id}
              className={`card-shadow rounded-xl border border-surface-variant bg-surface-container-lowest p-5 ${!product.is_active ? "opacity-60" : ""}`}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3">
                  <div className="rounded-lg bg-surface-container-high p-2.5">
                    <Icon className="h-5 w-5 text-secondary" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-on-surface">{product.name}</p>
                      {!product.is_active && (
                        <span className="rounded-full bg-surface-container-high px-2 py-0.5 text-[10px] font-semibold text-on-surface-variant">
                          Inactive
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-sm text-on-surface-variant">
                      {product.product_type.toUpperCase()}
                      {product.speed_down && ` · ${product.speed_down}${product.speed_up ? `/${product.speed_up}` : ""} Mbps`}
                      {" · "}
                      <span className="font-semibold text-on-surface">{formatPrice(product.price_cents)}</span>
                      {product.price_cents !== null && `/${product.billing_period}`}
                      {product.is_uncapped && " · Uncapped"}
                    </p>
                    {product.description && (
                      <p className="mt-1 text-xs text-on-surface-variant">{product.description}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => { setEditingProduct(product); setShowForm(true); }}
                    className="rounded-lg p-2 text-on-surface-variant transition-all hover:bg-surface-container hover:text-on-surface"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  {deletingId === product.id ? (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleDelete(product.id)}
                        className="rounded-lg bg-error px-2 py-1 text-[10px] font-semibold text-on-error"
                      >
                        Confirm
                      </button>
                      <button
                        onClick={() => setDeletingId(null)}
                        className="rounded-lg p-2 text-on-surface-variant hover:bg-surface-container"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setDeletingId(product.id)}
                      className="rounded-lg p-2 text-on-surface-variant transition-all hover:bg-error-container hover:text-on-error"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {products.length === 0 && (
          <div className="rounded-xl border border-dashed border-outline-variant p-12 text-center">
            <Package className="mx-auto h-8 w-8 text-on-surface-variant" />
            <p className="mt-2 text-sm text-on-surface-variant">No products yet. Click &quot;Add Product&quot; to create one.</p>
          </div>
        )}
      </div>

      {showForm && (
        <ProductForm
          product={editingProduct}
          onSave={handleSave}
          onCancel={() => { setShowForm(false); setEditingProduct(null); }}
        />
      )}
    </div>
  );
}

function ProductForm({
  product,
  onSave,
  onCancel,
}: {
  product: Product | null;
  onSave: (product: Partial<Product> & { id?: number }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(product?.name ?? "");
  const [productType, setProductType] = useState(product?.product_type ?? "fibre");
  const [speedDown, setSpeedDown] = useState(product?.speed_down?.toString() ?? "");
  const [speedUp, setSpeedUp] = useState(product?.speed_up?.toString() ?? "");
  const [priceRands, setPriceRands] = useState(
    product?.price_cents !== null && product?.price_cents !== undefined
      ? (product.price_cents / 100).toString()
      : ""
  );
  const [billingPeriod, setBillingPeriod] = useState(product?.billing_period ?? "monthly");
  const [description, setDescription] = useState(product?.description ?? "");
  const [isUncapped, setIsUncapped] = useState(product?.is_uncapped ?? true);
  const [isActive, setIsActive] = useState(product?.is_active ?? true);
  const [displayOrder, setDisplayOrder] = useState(product?.display_order?.toString() ?? "0");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const priceCents = priceRands === "" ? null : Math.round(parseFloat(priceRands) * 100);
    onSave({
      id: product?.id,
      name,
      product_type: productType,
      speed_down: speedDown === "" ? null : parseInt(speedDown),
      speed_up: speedUp === "" ? null : parseInt(speedUp),
      price_cents: priceCents,
      billing_period: billingPeriod,
      description: description || null,
      is_uncapped: isUncapped,
      is_active: isActive,
      display_order: parseInt(displayOrder) || 0,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="card-shadow w-full max-w-lg rounded-2xl border border-surface-variant bg-surface p-6 max-h-[90vh] overflow-y-auto">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-on-surface">
            {product ? "Edit Product" : "Add Product"}
          </h3>
          <button onClick={onCancel} className="rounded-lg p-2 text-on-surface-variant hover:bg-surface-container">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
              Product Name *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="e.g. 50/25 Mbps Fibre"
              className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                Product Type *
              </label>
              <select
                value={productType}
                onChange={(e) => setProductType(e.target.value)}
                className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
              >
                {PRODUCT_TYPES.map((t) => (
                  <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                Billing Period
              </label>
              <select
                value={billingPeriod}
                onChange={(e) => setBillingPeriod(e.target.value)}
                className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
              >
                {BILLING_PERIODS.map((p) => (
                  <option key={p} value={p}>{p === "monthly" ? "Monthly" : "Once-off"}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                Download Speed (Mbps)
              </label>
              <input
                type="number"
                value={speedDown}
                onChange={(e) => setSpeedDown(e.target.value)}
                placeholder="e.g. 50"
                className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                Upload Speed (Mbps)
              </label>
              <input
                type="number"
                value={speedUp}
                onChange={(e) => setSpeedUp(e.target.value)}
                placeholder="e.g. 25"
                className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
              Price (R) — leave empty for &quot;price on request&quot;
            </label>
            <input
              type="number"
              step="0.01"
              value={priceRands}
              onChange={(e) => setPriceRands(e.target.value)}
              placeholder="e.g. 695"
              className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Short description shown to customers"
              rows={2}
              className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                Display Order
              </label>
              <input
                type="number"
                value={displayOrder}
                onChange={(e) => setDisplayOrder(e.target.value)}
                className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
              />
            </div>
            <label className="flex items-center gap-2 pt-6">
              <input
                type="checkbox"
                checked={isUncapped}
                onChange={(e) => setIsUncapped(e.target.checked)}
                className="h-4 w-4 rounded border-outline-variant"
              />
              <span className="text-sm text-on-surface">Uncapped</span>
            </label>
            <label className="flex items-center gap-2 pt-6">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="h-4 w-4 rounded border-outline-variant"
              />
              <span className="text-sm text-on-surface">Active</span>
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg px-4 py-2 text-xs font-semibold text-on-surface-variant transition-all hover:bg-surface-container"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-on-primary shadow-sm transition-all hover:brightness-110"
            >
              {product ? "Save Changes" : "Create Product"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
