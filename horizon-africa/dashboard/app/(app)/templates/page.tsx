import { TemplateManager } from "@/components/template-manager";

export const dynamic = "force-dynamic";

export default function TemplatesPage() {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-on-surface-variant">
          Create, submit, and track WhatsApp message templates for Meta approval
        </p>
      </div>
      <TemplateManager />
    </div>
  );
}
