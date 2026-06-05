/**
 * AgentDashboard
 *
 * Main clinical workspace component. Wires up:
 *   - generateClient() from aws-amplify/data for initial data fetches
 *   - useClinicalSubscriptions() for real-time AppSync updates
 *   - Three panels: Transcripts | Entities | AI Summaries
 */
import { useState, useEffect, useCallback } from 'react';
import { client } from '../lib/amplify-client';
import { useClinicalSubscriptions } from '../hooks/useClinicalSubscriptions';
import { TranscriptFeed } from './TranscriptFeed';
import { EntitiesPanel } from './EntitiesPanel';
import { SummaryPanel } from './SummaryPanel';
import type {
  ClinicalInteraction,
  ClinicalEntities,
  PatientSummary,
} from '../types/clinical';

const MAX_ITEMS = 50; // keep the most recent N records in memory

function prepend<T extends { id: string }>(prev: T[], next: T): T[] {
  // deduplicate by id, keep cap
  const merged = [next, ...prev.filter((x) => x.id !== next.id)];
  return merged.slice(0, MAX_ITEMS);
}

export function AgentDashboard() {
  const [interactions, setInteractions] = useState<ClinicalInteraction[]>([]);
  const [entities, setEntities]         = useState<ClinicalEntities[]>([]);
  const [summaries, setSummaries]       = useState<PatientSummary[]>([]);
  const [loadError, setLoadError]       = useState<string | null>(null);
  const [activeTab, setActiveTab]       = useState<'transcripts' | 'entities' | 'summaries'>('transcripts');

  // ── Initial data load ──────────────────────────────────────────────────
  useEffect(() => {
    async function loadInitialData() {
      try {
        const [intRes, entRes, sumRes] = await Promise.all([
          (client.models.ClinicalInteraction as any).list({ limit: MAX_ITEMS }),
          (client.models.ClinicalEntities as any).list({ limit: MAX_ITEMS }),
          (client.models.PatientSummary as any).list({ limit: MAX_ITEMS }),
        ]);

        // Sort newest first — createdAt is auto-set by Amplify
        const byNewest = (a: { createdAt?: string | null }, b: { createdAt?: string | null }) =>
          new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime();

        setInteractions([...(intRes.data ?? [])].sort(byNewest));
        setEntities([...(entRes.data ?? [])].sort(byNewest));
        setSummaries([...(sumRes.data ?? [])].sort(byNewest));
      } catch (err) {
        // Only surface errors that aren't auth-related noise after login
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes('jwt') && !msg.includes('federated')) {
          setLoadError(msg);
        }
        console.error('[AgentDashboard] initial load failed:', err);
      }
    }
    loadInitialData();
  }, []);

  // ── Real-time subscription callbacks ──────────────────────────────────
  const onNewInteraction = useCallback((record: ClinicalInteraction) => {
    setInteractions((prev) => prepend(prev, record));
  }, []);

  const onNewEntities = useCallback((record: ClinicalEntities) => {
    setEntities((prev) => prepend(prev, record));
  }, []);

  const onNewSummary = useCallback((record: PatientSummary) => {
    setSummaries((prev) => prepend(prev, record));
  }, []);

  const onError = useCallback((err: Error) => {
    console.error('[subscription error]', err);
  }, []);

  useClinicalSubscriptions({ onNewInteraction, onNewEntities, onNewSummary, onError });

  // ── Derived counts for tab badges ────────────────────────────────────
  const tabs = [
    { key: 'transcripts', label: 'Transcripts',  count: interactions.length, icon: '📞' },
    { key: 'entities',    label: 'Entities',     count: entities.length,     icon: '🧬' },
    { key: 'summaries',   label: 'AI Summaries', count: summaries.length,    icon: '🩺' },
  ] as const;

  return (
    <div className="flex flex-col h-full">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="px-6 py-4 border-b border-gray-200 bg-white shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Clinical AI Dashboard</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Real-time patient interaction monitoring
            </p>
          </div>
          {/* Live indicator */}
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
            </span>
            <span className="text-xs text-green-600 font-medium">Live</span>
          </div>
        </div>
      </header>

      {/* ── Error banner ───────────────────────────────────────────────── */}
      {loadError && (
        <div className="mx-6 mt-4 p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800">
          <strong>Warning:</strong> Could not load initial data. Subscriptions are still active.
          <br />
          <span className="text-xs text-amber-600 mt-1 block">{loadError}</span>
        </div>
      )}

      {/* ── Tab bar ────────────────────────────────────────────────────── */}
      <div className="flex border-b border-gray-200 bg-white px-6 shrink-0">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`
              flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors
              ${activeTab === tab.key
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }
            `}
          >
            <span>{tab.icon}</span>
            {tab.label}
            {tab.count > 0 && (
              <span
                className={`
                  text-xs rounded-full px-1.5 py-0.5 font-semibold
                  ${activeTab === tab.key
                    ? 'bg-indigo-100 text-indigo-700'
                    : 'bg-gray-100 text-gray-600'
                  }
                `}
              >
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Panel content ──────────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto p-6">
        {activeTab === 'transcripts' && (
          <section aria-label="Transcript feed">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
              Live Transcripts
            </h2>
            <TranscriptFeed interactions={interactions} />
          </section>
        )}

        {activeTab === 'entities' && (
          <section aria-label="Extracted entities">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
              Medical Entities (Comprehend Medical)
            </h2>
            <EntitiesPanel entities={entities} />
          </section>
        )}

        {activeTab === 'summaries' && (
          <section aria-label="AI summaries">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
              AI-Generated Summaries &amp; Diagnostics
            </h2>
            <SummaryPanel summaries={summaries} />
          </section>
        )}
      </main>
    </div>
  );
}
