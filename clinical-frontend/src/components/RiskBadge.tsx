/**
 * RiskBadge – colour-coded pill for Low / Medium / High risk levels.
 */
import type { RiskLevel } from '../types/clinical';

interface Props {
  level?: string | null;
}

const MAP: Record<string, { bg: string; text: string; label: string }> = {
  Low:    { bg: 'bg-emerald-100', text: 'text-emerald-800', label: 'Low Risk' },
  Medium: { bg: 'bg-amber-100',   text: 'text-amber-800',   label: 'Medium Risk' },
  High:   { bg: 'bg-red-100',     text: 'text-red-800',     label: 'High Risk ⚠' },
};

export function RiskBadge({ level }: Props) {
  const style = MAP[level ?? ''] ?? { bg: 'bg-gray-100', text: 'text-gray-600', label: level ?? 'Unknown' };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${style.bg} ${style.text}`}>
      {style.label}
    </span>
  );
}
