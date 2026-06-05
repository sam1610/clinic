/**
 * EntitiesPanel
 *
 * Shows the most recently extracted ClinicalEntities record with full
 * Comprehend Medical entity breakdown.
 */
import type { ClinicalEntities } from '../types/clinical';
import { EntityPills } from './EntityPills';

interface Props {
  entities: ClinicalEntities[];
}

function formatTime(iso?: string | null) {
  if (!iso) return '';
  return new Date(iso).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function EntitiesPanel({ entities }: Props) {
  if (!entities.length) {
    return (
      <div className="flex items-center justify-center h-24 text-gray-400 text-sm">
        No entities extracted yet.
      </div>
    );
  }

  return (
    <ul className="space-y-3 overflow-y-auto max-h-[400px] pr-1">
      {entities.map((item) => (
        <li
          key={item.id}
          className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm animate-fade-in"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-gray-500 font-mono">
              {item.entityId}
            </span>
            <span className="text-xs text-gray-400">
              {formatTime(item.extractedAt ?? item.createdAt)}
            </span>
          </div>
          <EntityPills
            symptoms={item.symptoms}
            medications={item.medications}
            conditions={item.conditions}
            procedures={item.procedures}
          />
        </li>
      ))}
    </ul>
  );
}
