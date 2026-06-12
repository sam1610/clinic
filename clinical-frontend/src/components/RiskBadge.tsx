/**
 * RiskBadge
 *
 * Colour-coded pill for the riskAssessment field produced by the
 * bedrock-diagnostic Lambda. Accepted values: LOW | MEDIUM | HIGH | CRITICAL
 * (case-insensitive). Renders a neutral grey pill for any other string.
 */

interface Props {
  level?: string | null;
}

type Style = { bg: string; text: string; border: string; label: string };

const STYLES: Record<string, Style> = {
  LOW:      { bg: 'bg-emerald-50', text: 'text-emerald-800', border: 'border-emerald-200', label: 'Low Risk'      },
  MEDIUM:   { bg: 'bg-amber-50',   text: 'text-amber-800',   border: 'border-amber-200',   label: 'Medium Risk'   },
  HIGH:     { bg: 'bg-orange-50',  text: 'text-orange-800',  border: 'border-orange-200',  label: 'High Risk ⚠'   },
  CRITICAL: { bg: 'bg-red-50',     text: 'text-red-800',     border: 'border-red-200',     label: 'Critical ⛔'   },
};

const FALLBACK: Style = {
  bg: 'bg-gray-50', text: 'text-gray-600', border: 'border-gray-200', label: 'Unknown',
};

export function RiskBadge({ level }: Props) {
  const key   = (level ?? '').toUpperCase().trim();
  const style = STYLES[key] ?? { ...FALLBACK, label: level || 'Unknown' };

  return (
    <span
      className={`
        inline-flex items-center rounded-full border px-2.5 py-0.5
        text-xs font-semibold
        ${style.bg} ${style.text} ${style.border}
      `}
    >
      {style.label}
    </span>
  );
}
