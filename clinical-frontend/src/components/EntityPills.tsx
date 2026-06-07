/**
 * EntityPills
 *
 * Renders Comprehend Medical entities as colour-coded pill badges.
 *
 * Category → colour mapping:
 *   MEDICATION / BRAND_NAME        → blue
 *   MEDICAL_CONDITION / DX_NAME    → red
 *   TEST_TREATMENT_PROCEDURE       → green
 *   ANATOMY                        → purple
 *   PROTECTED_HEALTH_INFORMATION   → gray
 *   (anything else)                → amber
 */
import type { ComprehendEntity } from '../types/clinical';

// ── Colour map ──────────────────────────────────────────────────────────────

const CATEGORY_STYLES: Record<string, { pill: string; label: string }> = {
  MEDICATION:                      { pill: 'bg-blue-100 text-blue-800 border-blue-200',       label: 'Medication' },
  MEDICAL_CONDITION:               { pill: 'bg-red-100 text-red-800 border-red-200',          label: 'Condition' },
  TEST_TREATMENT_PROCEDURE:        { pill: 'bg-green-100 text-green-800 border-green-200',    label: 'Procedure' },
  ANATOMY:                         { pill: 'bg-purple-100 text-purple-800 border-purple-200', label: 'Anatomy' },
  PROTECTED_HEALTH_INFORMATION:    { pill: 'bg-gray-100 text-gray-700 border-gray-200',       label: 'PHI' },
};

function pillStyle(category: string): { pill: string; label: string } {
  return (
    CATEGORY_STYLES[category] ??
    { pill: 'bg-amber-100 text-amber-800 border-amber-200', label: category }
  );
}

// ── Group header ────────────────────────────────────────────────────────────

interface GroupProps {
  groupLabel: string;
  entities: ComprehendEntity[];
  pillClass: string;
}

function EntityGroup({ groupLabel, entities, pillClass }: GroupProps) {
  if (!entities.length) return null;
  return (
    <div>
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
        {groupLabel}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {entities.map((e, i) => (
          <span
            key={`${e.Text}-${i}`}
            title={`${e.Type} · confidence ${(e.Score * 100).toFixed(0)}%`}
            className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium ${pillClass}`}
          >
            {e.Text}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Public component ────────────────────────────────────────────────────────

interface Props {
  entities: ComprehendEntity[];
}

export function EntityPills({ entities }: Props) {
  if (!entities.length) {
    return (
      <p className="text-xs text-gray-400 italic">No medical entities detected.</p>
    );
  }

  // Group by category
  const groups = new Map<string, ComprehendEntity[]>();
  for (const e of entities) {
    const key = e.Category ?? 'OTHER';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(e);
  }

  return (
    <div className="space-y-3">
      {[...groups.entries()].map(([category, items]) => {
        const { pill, label } = pillStyle(category);
        return (
          <EntityGroup
            key={category}
            groupLabel={label}
            entities={items}
            pillClass={pill}
          />
        );
      })}
    </div>
  );
}
