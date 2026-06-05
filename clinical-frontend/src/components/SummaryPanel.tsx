/**
 * SummaryPanel
 *
 * Displays the latest PatientSummary records from the Strands Agents
 * (both summarization-agent and diagnostic-agent output).
 */
import type { PatientSummary } from '../types/clinical';
import { RiskBadge } from './RiskBadge';

interface Props {
  summaries: PatientSummary[];
}

function agentLabel(type?: string | null) {
  switch (type) {
    case 'summarization-agent': return '🩺 Summary';
    case 'diagnostic-agent':    return '🔬 Diagnostic';
    default:                    return '🤖 Agent';
  }
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

export function SummaryPanel({ summaries }: Props) {
  if (!summaries.length) {
    return (
      <div className="flex items-center justify-center h-24 text-gray-400 text-sm">
        Waiting for AI summaries…
      </div>
    );
  }

  return (
    <ul className="space-y-4 overflow-y-auto max-h-[500px] pr-1">
      {summaries.map((item) => (
        <li
          key={item.id}
          className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm animate-fade-in"
        >
          {/* Header row */}
          <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
            <span className="text-sm font-semibold text-gray-700">
              {agentLabel(item.agentType)}
            </span>
            <div className="flex items-center gap-2">
              <RiskBadge level={item.riskLevel} />
              <span className="text-xs text-gray-400">
                {formatTime(item.generatedAt ?? item.createdAt)}
              </span>
            </div>
          </div>

          {/* Summary text */}
          <p className="text-sm text-gray-700 leading-relaxed mb-3">
            {item.summaryText}
          </p>

          {/* Diagnostic suggestions */}
          {item.diagnosticSuggestions?.length ? (
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-1">
                Diagnostic suggestions
              </p>
              <ul className="list-disc list-inside space-y-0.5">
                {item.diagnosticSuggestions.map((s) => (
                  <li key={s} className="text-xs text-gray-600">
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* Similar cases */}
          {item.similarCasesCount != null && (
            <p className="text-xs text-gray-400 mt-2">
              Based on {item.similarCasesCount} similar historical cases
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
