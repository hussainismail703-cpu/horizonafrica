import { LeadScore } from "@/lib/types";

const styles: Record<LeadScore, string> = {
  HOT: "bg-secondary-container text-on-secondary-container",
  WARM: "bg-secondary-fixed text-on-secondary-fixed",
  COLD: "bg-surface-variant text-on-surface-variant",
};

export function ScoreBadge({ score }: { score: LeadScore }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold ${styles[score]}`}
    >
      {score}
    </span>
  );
}
