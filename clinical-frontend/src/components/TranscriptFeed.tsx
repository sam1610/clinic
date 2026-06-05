/**
 * TranscriptFeed
 *
 * Renders a live-updating list of ClinicalInteraction transcripts.
 * New items prepended to the top with a fade-in effect.
 */
import type { ClinicalInteraction } from '../types/clinical';

interface Props {
  interactions: ClinicalInteraction[];
}

function channelIcon(channel?: string | null) {
  switch (channel) {
    case 'WhatsApp': return '💬';
    case 'WebChat':  return '🌐';
    case 'Voice':
    default:         return '📞';
  }
}

function formatTime(iso?: string | null) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function TranscriptFeed({ interactions }: Props) {
  if (!interactions.length) {
    return (
      <div className="flex items-center justify-center h-32 text-gray-400 text-sm">
        Waiting for interactions…
      </div>
    );
  }

  return (
    <ul className="space-y-3 overflow-y-auto max-h-[400px] pr-1">
      {interactions.map((item) => (
        <li
          key={item.id}
          className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm animate-fade-in"
        >
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <span className="text-base" aria-label={item.channel ?? 'Voice'}>
                {channelIcon(item.channel)}
              </span>
              <span className="text-xs font-medium text-gray-500">
                {item.channel ?? 'Voice'}
              </span>
              {item.connectContactId && (
                <span className="text-xs text-gray-400 font-mono">
                  #{item.connectContactId.slice(0, 8)}
                </span>
              )}
            </div>
            <span className="text-xs text-gray-400">
              {formatTime(item.createdAt ?? item.startTime)}
            </span>
          </div>

          {item.transcriptText ? (
            <p className="text-sm text-gray-700 leading-relaxed line-clamp-4">
              {item.transcriptText}
            </p>
          ) : (
            <p className="text-xs text-amber-600 italic">Transcription in progress…</p>
          )}
        </li>
      ))}
    </ul>
  );
}
