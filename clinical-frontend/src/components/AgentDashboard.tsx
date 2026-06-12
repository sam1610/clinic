/**
 * AgentDashboard — Clinical EHR workspace
 *
 * Strict two-column layout:
 *
 *   ┌──────────────────────────────────────────┬─────────────────────┐
 *   │  Main content  (75%)                     │  CCP sidebar  (25%) │
 *   │                                          │                     │
 *   │  ┌─ header: title + patient search ──┐  │  CallControlPanel   │
 *   │  │                                   │  │  (Amazon Connect    │
 *   │  │  PatientProfile                   │  │   CCP iframe)       │
 *   │  │  PatientHistory                   │  │                     │
 *   │  │    ├── Audio player               │  │                     │
 *   │  │    ├── Transcript (collapsible)   │  │                     │
 *   │  │    ├── Medical entity pills       │  │                     │
 *   │  │    ├── ICD-10 codes               │  │                     │
 *   │  │    └── AI Diagnostic Summary      │  │                     │
 *   │  └───────────────────────────────────┘  │                     │
 *   └──────────────────────────────────────────┴─────────────────────┘
 *
 * Architecture rules:
 *   - All data is fetched via standard LIST / GET queries (Amplify client).
 *   - No AppSync subscriptions. No live transcript feeds.
 *   - The CCP sidebar is always visible and never collapsed —
 *     call control is a first-class concern for the agent.
 */
import { useState, useEffect, useRef } from 'react';
import { client } from '../lib/amplify-client';
import { CallControlPanel } from './CallControlPanel';
import { PatientProfile } from './PatientProfile';
import { PatientHistory } from './PatientHistory';
import type { PatientRecord } from '../types/clinical';

// ── Patient search bar ────────────────────────────────────────────────────────

interface SearchBarProps {
  patients:   PatientRecord[];
  selectedId: string | null;
  onSelect:   (id: string) => void;
}

function PatientSearchBar({ patients, selectedId, onSelect }: SearchBarProps) {
  const [query, setQuery]   = useState('');
  const [open, setOpen]     = useState(false);
  const containerRef         = useRef<HTMLDivElement>(null);

  const selected = patients.find((p) => p.id === selectedId);

  const filtered = query.trim()
    ? patients.filter((p) =>
        `${p.firstName} ${p.lastName} ${p.patientId}`
          .toLowerCase()
          .includes(query.toLowerCase())
      )
    : patients;

  // Close dropdown when clicking outside
  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, []);

  return (
    <div ref={containerRef} className="relative w-full max-w-sm">
      <label htmlFor="patient-search" className="sr-only">Search patients</label>
      <div className="relative">
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none"
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
        </svg>
        <input
          id="patient-search"
          type="search"
          autoComplete="off"
          placeholder={
            selected
              ? `${selected.firstName} ${selected.lastName}`
              : 'Search patient…'
          }
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          className="
            w-full pl-9 pr-4 py-2 text-sm rounded-lg border border-gray-300
            bg-white placeholder-gray-400 focus:outline-none focus:ring-2
            focus:ring-indigo-500 focus:border-transparent
          "
        />
      </div>

      {open && filtered.length > 0 && (
        <ul
          role="listbox"
          aria-label="Patient suggestions"
          className="
            absolute z-20 mt-1 w-full bg-white rounded-lg border border-gray-200
            shadow-lg max-h-56 overflow-y-auto
          "
        >
          {filtered.map((p) => (
            <li key={p.id} role="option" aria-selected={p.id === selectedId}>
              <button
                type="button"
                onClick={() => { onSelect(p.id); setQuery(''); setOpen(false); }}
                className={`
                  w-full text-left px-4 py-2.5 text-sm hover:bg-indigo-50 transition-colors
                  ${p.id === selectedId
                    ? 'bg-indigo-50 text-indigo-700 font-medium'
                    : 'text-gray-700'}
                `}
              >
                <span className="font-medium">{p.firstName} {p.lastName}</span>
                <span className="ml-2 text-xs text-gray-400 font-mono">{p.patientId}</span>
                {p.region && (
                  <span className="ml-1 text-xs text-gray-400">· {p.region}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Main dashboard ────────────────────────────────────────────────────────────

export function AgentDashboard() {
  const [patients,   setPatients]   = useState<PatientRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadError,  setLoadError]  = useState<string | null>(null);

  // Single LIST query on mount — no subscription
  useEffect(() => {
    (async () => {
      try {
        const { data, errors } = await client.models.PatientRecord.list();

        if (errors?.length) {
          console.warn('[AgentDashboard] partial patient-list errors', errors);
        }

        const sorted = [...(data ?? [])].sort((a, b) =>
          `${a.lastName}${a.firstName}`.localeCompare(`${b.lastName}${b.firstName}`)
        ) as unknown as PatientRecord[];

        setPatients(sorted);

        // Auto-select first patient if none is selected
        if (sorted.length && !selectedId) {
          setSelectedId(sorted[0].id);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setLoadError(msg);
        console.error('[AgentDashboard] patient load failed', err);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activePatient = patients.find((p) => p.id === selectedId) ?? null;

  return (
    /*
     * Full-height flex row.  Each column manages its own scroll independently.
     * The two-column split is enforced with Tailwind's w-3/4 / w-1/4.
     */
    <div className="flex flex-1 min-h-0 overflow-hidden">

      {/* ── Left: Main content (75%) ──────────────────────────────────── */}
      <div className="flex flex-col w-3/4 min-w-0 border-r border-gray-200">

        {/* Sub-header */}
        <header className="flex items-center justify-between gap-4 px-6 py-4 border-b border-gray-200 bg-white shrink-0 flex-wrap">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Clinical EHR</h1>
            <p className="text-xs text-gray-400 mt-0.5">
              Historical patient records · post-call analytics
            </p>
          </div>
          <PatientSearchBar
            patients={patients}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </header>

        {/* Error banner */}
        {loadError && (
          <div
            role="alert"
            className="mx-6 mt-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700 shrink-0"
          >
            <strong>Error loading patients:</strong> {loadError}
          </div>
        )}

        {/* Scrollable EHR content */}
        <main className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {!activePatient && !loadError && (
            <div className="flex flex-col items-center justify-center py-24 text-gray-400 gap-3">
              <span className="text-4xl" aria-hidden="true">👤</span>
              <p className="text-sm">
                {patients.length === 0
                  ? 'Loading patient roster…'
                  : 'Select a patient to view their EHR record.'}
              </p>
            </div>
          )}

          {activePatient && (
            <>
              <PatientProfile patient={activePatient} />
              <PatientHistory patientId={activePatient.patientId} />
            </>
          )}
        </main>
      </div>

      {/* ── Right: Call Control Panel (25%) ───────────────────────────── */}
      {/*
       * The CCP sidebar is always present and takes exactly 25% width.
       * Removing the collapse toggle keeps call-control permanently accessible —
       * agents must be able to answer/transfer calls without hunting for a toggle.
       * CallControlPanel fills 100% of this column via h-full w-full.
       */}
      <aside
        className="flex flex-col w-1/4 shrink-0 bg-white overflow-hidden"
        aria-label="Call Control Panel"
      >
        <CallControlPanel />
      </aside>

    </div>
  );
}
