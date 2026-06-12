/**
 * PatientHistory
 *
 * Fetches all HistoricalInteraction records for the selected patient via a
 * standard Amplify LIST query (no subscriptions) and renders one card per
 * visit, ordered newest-first.
 *
 * Each card shows:
 *   ┌──────────────────────────────────────────┐
 *   │  Header: date · contactId · risk badge   │
 *   │  ─────────────────────────────────────── │
 *   │  Audio player  (s3RecordingUrl)          │
 *   │  ▼ Transcript  (collapsible)             │
 *   │  ▼ Medical Entities  (EntityPills)       │
 *   │  ▼ ICD-10 Codes                          │
 *   │  ▼ Diagnostic Summary  (Bedrock)         │
 *   └──────────────────────────────────────────┘
 *
 * AWSJSON fields (medicalEntities, diagnosticSummary) may arrive as either
 * a pre-parsed object or a JSON string — parseJson() handles both cases.
 *
 * NOTE: s3RecordingUrl is an S3 URI (s3://bucket/key). Convert to a
 * presigned HTTPS URL via your backend or CloudFront to enable playback.
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

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Format an ISO-8601 string into a human-readable date+time. */
function formatDate(iso: string): string {
  return new Date(iso).toLocaleString([], {
    year:   'numeric',
    month:  'short',
    day:    'numeric',
    hour:   '2-digit',
    minute: '2-digit',
  });
}

/**
 * Safely parse an AWSJSON field that may arrive as a string or already be
 * a parsed object (AppSync can return either).
 */
function parseJson<T>(value: unknown): T | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object')             return value as T;
  if (typeof value === 'string') {
    try   { return JSON.parse(value) as T; }
    catch { return null; }
  }
  return null;
}

// ── Collapsible section ───────────────────────────────────────────────────────

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
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
        aria-expanded={open}
      >
        <span className="text-sm font-semibold text-gray-700">{title}</span>
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && <div className="px-4 py-3">{children}</div>}
    </div>
  );
}

// ── Audio player ──────────────────────────────────────────────────────────────

function AudioPlayer({ url }: { url?: string | null }) {
  if (!url) {
    return <p className="text-xs text-gray-400 italic">No recording available.</p>;
  }
  if (!url.startsWith('https://')) {
    return (
      <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
        <svg className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 110 20A10 10 0 0112 2z" />
        </svg>
        <p className="text-xs text-amber-700">
          Recording at <code className="font-mono break-all">{url}</code>.{' '}
          Generate a presigned URL to enable in-browser playback.
        </p>
      </div>
    );
  }
  return (
    // eslint-disable-next-line jsx-a11y/media-has-caption
    <audio controls src={url} className="w-full h-10 rounded" aria-label="Call recording" />
  );
}

// ── ICD-10 table ──────────────────────────────────────────────────────────────

function Icd10Table({ codes }: { codes: Icd10Code[] }) {
  if (!codes.length) {
    return <p className="text-xs text-gray-400 italic">No ICD-10 codes mapped.</p>;
  }
  return (
    <ul className="space-y-1.5">
      {codes.map((c) => (
        <li key={c.code} className="flex items-center gap-3">
          <span className="shrink-0 font-mono text-xs font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded px-1.5 py-0.5">
            {c.code}
          </span>
          <span className="text-xs text-gray-700 leading-relaxed flex-1">{c.description}</span>
          <span className="shrink-0 text-xs text-gray-400">
            {(c.confidence * 100).toFixed(0)}%
          </span>
        </li>
      ))}
    </ul>
  );
}

// ── Diagnostic summary card ───────────────────────────────────────────────────

function DiagnosticBlock({ summary }: { summary: DiagnosticSummary }) {
  return (
    <div className="space-y-3">
      {/* Risk level */}
      {summary.riskAssessment && (
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            Risk level:
          </span>
          <RiskBadge level={summary.riskAssessment} />
        </div>
      )}

      {/* Narrative summary */}
      {summary.diagnosticSummary && (
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
            Summary
          </p>
          <p className="text-sm text-gray-800 leading-relaxed">
            {summary.diagnosticSummary}
          </p>
        </div>
      )}

      {/* Differential diagnoses */}
      {summary.differentialDiagnoses?.length ? (
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
            Differential diagnoses
          </p>
          <ul className="space-y-1">
            {summary.differentialDiagnoses.map((d, i) => (
              <li key={i} className="text-xs text-gray-700 flex gap-2">
                <span className="text-indigo-400 font-bold shrink-0">·</span>
                {d}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Recommended actions */}
      {summary.recommendedActions?.length ? (
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
            Recommended actions
          </p>
          <ul className="space-y-1">
            {summary.recommendedActions.map((r, i) => (
              <li key={i} className="text-xs text-gray-700 flex gap-2">
                <span className="text-emerald-500 font-bold shrink-0">✓</span>
                {r}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

// ── Single interaction card ───────────────────────────────────────────────────

function InteractionCard({ interaction }: { interaction: HistoricalInteraction }) {
  const entities = parseJson<ComprehendMedicalOutput>(interaction.medicalEntities);
  const diag     = parseJson<DiagnosticSummary>(interaction.diagnosticSummary);

  // ICD-10 codes live inside medicalEntities (written by comprehend-medical Lambda)
  const icd10    = entities?.icd10Codes ?? [];

  return (
    <article
      className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden"
      aria-label={`Visit on ${formatDate(interaction.date)}`}
    >
      {/* ── Card header ─────────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-5 py-3 bg-gray-50 border-b border-gray-200">
        <div>
          <p className="text-sm font-semibold text-gray-800">
            {formatDate(interaction.date)}
          </p>
          <p className="text-xs text-gray-400 font-mono mt-0.5">
            Contact&nbsp;
            <span title={interaction.contactId}>
              #{interaction.contactId.slice(0, 12)}…
            </span>
          </p>
        </div>
        {diag?.riskAssessment && (
          <RiskBadge level={diag.riskAssessment} />
        )}
      </header>

      {/* ── Card body ───────────────────────────────────────────────── */}
      <div className="px-5 py-4 space-y-4">

        {/* 1. Recording */}
        <section aria-label="Recording">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Recording
          </p>
          <AudioPlayer url={interaction.s3RecordingUrl} />
        </section>

        {/* 2. Transcript — collapsible */}
        <Collapsible title="Transcript">
          {interaction.rawTranscript ? (
            <pre className="text-xs text-gray-700 leading-relaxed whitespace-pre-wrap font-mono">
              {interaction.rawTranscript}
            </pre>
          ) : (
            <p className="text-xs text-gray-400 italic">Transcript not available.</p>
          )}
        </Collapsible>

        {/* 3. Medical entities — open by default (main clinical signal) */}
        <Collapsible title="Medical Entities" defaultOpen>
          <EntityPills entities={entities?.entities ?? []} />
        </Collapsible>

        {/* 4. ICD-10 codes */}
        <Collapsible title="ICD-10 Codes">
          <Icd10Table codes={icd10} />
        </Collapsible>

        {/* 5. Diagnostic summary — open by default */}
        <Collapsible title="AI Diagnostic Summary" defaultOpen>
          {diag ? (
            <DiagnosticBlock summary={diag} />
          ) : (
            <p className="text-xs text-gray-400 italic">
              No diagnostic summary available.
            </p>
          )}
        </Collapsible>

      </div>
    </article>
  );
}

// ── Public component ──────────────────────────────────────────────────────────

interface PatientHistoryProps {
  patientId: string;
}

export function PatientHistory({ patientId }: PatientHistoryProps) {
  const [interactions, setInteractions] = useState<HistoricalInteraction[]>([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState<string | null>(null);

  useEffect(() => {
    if (!patientId) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const { data, errors } = await client.models.HistoricalInteraction.list({
          filter: { patientId: { eq: patientId } },
        });

        if (errors?.length) {
          console.warn('[PatientHistory] partial query errors', errors);
        }

        if (!cancelled) {
          // Sort newest-first by the `date` field
          const sorted = [...(data ?? [])].sort(
            (a, b) => new Date(b.date as string).getTime() - new Date(a.date as string).getTime()
          );
          setInteractions(sorted as unknown as HistoricalInteraction[]);
        }
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : String(err);
          setError(msg);
          console.error('[PatientHistory] load failed', err);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [patientId]);

  // ── Loading ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 gap-3 text-gray-400">
        <div
          className="w-5 h-5 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin"
          aria-hidden="true"
        />
        <span className="text-sm">Loading interaction history…</span>
      </div>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div
        role="alert"
        className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700"
      >
        <strong>Could not load history:</strong> {error}
      </div>
    );
  }

  // ── Empty ────────────────────────────────────────────────────────────
  if (!interactions.length) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-2 text-gray-400">
        <span className="text-3xl" aria-hidden="true">📋</span>
        <p className="text-sm">No interaction history found for this patient.</p>
      </div>
    );
  }

  // ── List ─────────────────────────────────────────────────────────────
  return (
    <section aria-label="Interaction history">
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-4">
        Interaction History&nbsp;
        <span className="text-gray-400 font-normal">({interactions.length})</span>
      </h3>
      <div className="space-y-5">
        {interactions.map((i) => (
          <InteractionCard key={i.id} interaction={i} />
        ))}
      </div>
    </section>
  );
}
