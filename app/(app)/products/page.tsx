import { ProductManager } from "@/components/product-manager";

export const dynamic = "force-dynamic";

export default function ProductsPage() {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-on-surface-variant">
          Shopify catalog — sizes, prices, and live stock synced from easternwearbykersh.com.
          Availability is checked in real-time before Layla confirms any order.
        </p>
      </div>
      <ProductManager />
    </div>
  );
}
