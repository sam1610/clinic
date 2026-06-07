/**
 * PatientHistory
 *
 * Queries HistoricalInteraction records for the active patient and renders
 * a rich post-call analytics card for each visit:
 *
 *   ┌──────────────────────────────────────────┐
 *   │  Header: date · contactId                │
 *   │  Audio player (s3RecordingUrl)           │
 *   │  ▶ Transcript (collapsible)              │
 *   │  Medical Entities (EntityPills)          │
 *   │  ICD-10 Codes                            │
 *   │  Diagnostic Summary (Bedrock)            │
 *   └──────────────────────────────────────────┘
 *
 * Data is fetched once via a standard LIST query — no subscriptions.
 *
 * NOTE: s3RecordingUrl is a raw S3 URI (s3://bucket/key). To make it
 * playable in the browser you must convert it to a presigned HTTPS URL
 * via your backend or CloudFront. The component renders a placeholder
 * when the URL doesn't start with "https://".
 */
import { useState, useEffect } from 'react';
import { client } from '../lib/amplify-client';
import { EntityPills } from './EntityPills';
import { RiskBadge } from './RiskBadge';
import type {
  HistoricalInteraction,
  ComprehendMedicalOutput,
  Icd10Code,
  DiagnosticSummary,
} from '../types/clinical';

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  return new Date(iso).toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Safely parse an AWSJSON field that may arrive as a string or object. */
function parseJson<T>(value: unknown): T | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return value as T;
  if (typeof value === 'string') {
    try { return JSON.parse(value) as T; } catch { return null; }
  }
  return null;
}

// ── Sub-components ──────────────────────────────────────────────────────────

/** Collapsible section with an animated chevron toggle. */
function Collapsible({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="
          w-full flex items-center justify-between px-4 py-2.5
          bg-gray-50 hover:bg-gray-100 transition-colors text-left
        "
        aria-expanded={open}
      >
        <span className="text-sm font-semibold text-gray-700">{title}</span>
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && <div className="px-4 py-3">{children}</div>}
    </div>
  );
}

/** Audio player — renders a native <audio> when URL is HTTPS, or a message otherwise. */
function AudioPlayer({ url }: { url?: string | null }) {
  if (!url) {
    return (
      <p className="text-xs text-gray-400 italic">No recording available.</p>
    );
  }
  if (!url.startsWith('https://')) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
        <svg className="w-4 h-4 text-amber-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 110 20A10 10 0 0112 2z" />
        </svg>
        <p className="text-xs text-amber-700">
          Recording stored at <code className="font-mono break-all">{url}</code>.
          Generate a presigned URL via your backend to enable in-browser playback.
        </p>
      </div>
    );
  }
  return (
    // eslint-disable-next-line jsx-a11y/media-has-caption
    <audio
      controls
      src={url}
      className="w-full h-10 rounded"
      aria-label="Call recording"
    />
  );
}

/** ICD-10 code table. */
function Icd10Table({ codes }: { codes: Icd10Code[] }) {
  if (!codes.length) {
    return <p className="text-xs text-gray-400 italic">No ICD-10 codes mapped.</p>;
  }
  return (
    <ul className="space-y-1.5">
      {codes.map((c) => (
        <li key={c.code} className="flex items-start gap-3">
          <span className="shrink-0 font-mono text-xs font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded px-1.5 py-0.5">
            {c.code}
          </span>
          <span className="text-xs text-gray-700 leading-relaxed">{c.description}</span>
          <span className="ml-auto shrink-0 text-xs text-gray-400">
            {(c.confidence * 100).toFixed(0)}%
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Bedrock diagnostic summary card. */
function DiagnosticBlock({ summary }: { summary: DiagnosticSummary }) {
  return (
    <div className="space-y-3">
      {/* Risk level */}
      {summary.riskLevel && (
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-gray-500">Risk level:</span>
          <RiskBadge level={summary.riskLevel} />
        </div>
      )}

      {/* Narrative summary */}
      <div>
        <p className="text-xs font-semibold text-gray-500 mb-1">Summary</p>
        <p className="text-sm text-gray-800 leading-relaxed">{summary.summary}</p>
      </div>

      {/* Recommendations */}
      {summary.recommendations?.length ? (
        <div>
          <p className="text-xs font-semibold text-gray-500 mb-1">Recommendations</p>
          <ul className="list-disc list-inside space-y-1">
            {summary.recommendations.map((r, i) => (
              <li key={i} className="text-xs text-gray-700">{r}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

// ── Interaction card ─────────────────────────────────────────────────────────

function InteractionCard({ interaction }: { interaction: HistoricalInteraction }) {
  const entities = parseJson<ComprehendMedicalOutput>(interaction.medicalEntities);
  const icd10    = parseJson<Icd10Code[]>(interaction.icd10Codes) ?? [];
  const diag     = parseJson<DiagnosticSummary>(interaction.diagnosticSummary);

  return (
    <article className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      {/* Card header */}
      <div className="flex items-center justify-between px-5 py-3 bg-gray-50 border-b border-gray-200">
        <div>
          <p className="text-sm font-semibold text-gray-800">
            {formatDate(interaction.interactionDate)}
          </p>
          <p className="text-xs text-gray-400 font-mono mt-0.5">
            Contact #{interaction.contactId.slice(0, 12)}…
          </p>
        </div>
        {diag?.riskLevel && <RiskBadge level={diag.riskLevel} />}
      </div>

      <div className="px-5 py-4 space-y-4">

        {/* 1. Audio player */}
        <section aria-label="Call recording">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Recording
          </p>
          <AudioPlayer url={interaction.s3RecordingUrl} />
        </section>

        {/* 2. Transcript — collapsible */}
        <Collapsible title="Transcript">
          {interaction.rawTranscript ? (
            <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap font-mono text-xs">
              {interaction.rawTranscript}
            </p>
          ) : (
            <p className="text-xs text-gray-400 italic">Transcript not available.</p>
          )}
        </Collapsible>

        {/* 3. Medical entities */}
        <Collapsible title="Medical Entities" defaultOpen>
          <EntityPills entities={entities?.entities ?? []} />
        </Collapsible>

        {/* 4. ICD-10 codes */}
        <Collapsible title="ICD-10 Codes">
          <Icd10Table codes={icd10} />
        </Collapsible>

        {/* 5. Diagnostic summary */}
        <Collapsible title="Diagnostic Summary (Bedrock)" defaultOpen>
          {diag ? (
            <DiagnosticBlock summary={diag} />
          ) : (
            <p className="text-xs text-gray-400 italic">No diagnostic summary available.</p>
          )}
        </Collapsible>

      </div>
    </article>
  );
}

// ── Public component ─────────────────────────────────────────────────────────

interface Props {
  patientId: string;
}

export function PatientHistory({ patientId }: Props) {
  const [interactions, setInteractions] = useState<HistoricalInteraction[]>([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState<string | null>(null);

  useEffect(() => {
    if (!patientId) return;

    setLoading(true);
    setError(null);

    async function load() {
      try {
        const { data, errors } = await client.models.HistoricalInteraction.list({
          filter: { patientId: { eq: patientId } },
        });

        if (errors?.length) {
          console.error('[PatientHistory] query errors', errors);
        }

        // Sort newest first
        const sorted = [...(data ?? [])].sort(
          (a, b) =>
            new Date(b.interactionDate).getTime() -
            new Date(a.interactionDate).getTime()
        );

        setInteractions(sorted as unknown as HistoricalInteraction[]);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        console.error('[PatientHistory] load failed', err);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [patientId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 gap-3 text-gray-400">
        <div className="w-5 h-5 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin" />
        <span className="text-sm">Loading interaction history…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        <strong>Could not load history:</strong> {error}
      </div>
    );
  }

  if (!interactions.length) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-2 text-gray-400">
        <span className="text-3xl">📋</span>
        <p className="text-sm">No interaction history found for this patient.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
        Interaction History ({interactions.length})
      </h3>
      {interactions.map((i) => (
        <InteractionCard key={i.id} interaction={i} />
      ))}
    </div>
  );
}
