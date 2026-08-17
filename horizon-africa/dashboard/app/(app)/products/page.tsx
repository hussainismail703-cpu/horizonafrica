import { ProductManager } from "@/components/product-manager";

export const dynamic = "force-dynamic";

export default function ProductsPage() {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-on-surface-variant">
          Manage product catalog — prices, packages, and availability. Changes are reflected in Layla&apos;s responses in real-time.
        </p>
      </div>
      <ProductManager />
    </div>
  );
}
