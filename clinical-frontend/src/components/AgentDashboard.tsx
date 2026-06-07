/**
 * AgentDashboard — Clinical EHR workspace
 *
 * Layout:
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │  Header                                                          │
 *   ├────────────────────────────────────────┬─────────────────────────┤
 *   │  Main content (75%)                    │  CCP sidebar (25%)      │
 *   │  ┌──────────────────────────────────┐  │  CallControlPanel       │
 *   │  │  Patient search / picker         │  │  (Amazon Connect CCP)   │
 *   │  │  PatientProfile                  │  │                         │
 *   │  │  PatientHistory                  │  │                         │
 *   │  │    ├── Audio player              │  │                         │
 *   │  │    ├── Transcript (collapsible)  │  │                         │
 *   │  │    ├── Medical entity pills      │  │                         │
 *   │  │    ├── ICD-10 codes              │  │                         │
 *   │  │    └── Diagnostic summary        │  │                         │
 *   │  └──────────────────────────────────┘  │                         │
 *   └────────────────────────────────────────┴─────────────────────────┘
 *
 * Data strategy: all reads are standard LIST / GET queries via the Amplify
 * client — no AppSync subscriptions.
 */
import { useState, useEffect, useRef } from 'react';
import { client } from '../lib/amplify-client';
import { CallControlPanel } from './CallControlPanel';
import { PatientProfile } from './PatientProfile';
import { PatientHistory } from './PatientHistory';
import type { PatientRecord } from '../types/clinical';

// ── Patient search bar ───────────────────────────────────────────────────────

interface SearchBarProps {
  patients: PatientRecord[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

function PatientSearchBar({ patients, selectedId, onSelect }: SearchBarProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen]   = useState(false);
  const containerRef      = useRef<HTMLDivElement>(null);

  const filtered = query.trim()
    ? patients.filter((p) =>
        `${p.firstName} ${p.lastName} ${p.patientId}`
          .toLowerCase()
          .includes(query.toLowerCase())
      )
    : patients;

  // Close dropdown on outside click
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const selected = patients.find((p) => p.id === selectedId);

  return (
    <div ref={containerRef} className="relative w-full max-w-sm">
      <label htmlFor="patient-search" className="sr-only">Search patients</label>
      <div className="relative">
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none"
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
        </svg>
        <input
          id="patient-search"
          type="text"
          placeholder={selected ? `${selected.firstName} ${selected.lastName}` : 'Search patient…'}
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
          className="
            absolute z-20 mt-1 w-full bg-white rounded-lg border border-gray-200
            shadow-lg max-h-56 overflow-y-auto
          "
          role="listbox"
          aria-label="Patient list"
        >
          {filtered.map((p) => (
            <li key={p.id} role="option" aria-selected={p.id === selectedId}>
              <button
                onClick={() => { onSelect(p.id); setQuery(''); setOpen(false); }}
                className={`
                  w-full text-left px-4 py-2.5 text-sm hover:bg-indigo-50 transition-colors
                  ${p.id === selectedId ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-gray-700'}
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

// ── Main dashboard ───────────────────────────────────────────────────────────

export function AgentDashboard() {
  const [patients, setPatients]       = useState<PatientRecord[]>([]);
  const [selectedId, setSelectedId]   = useState<string | null>(null);
  const [loadError, setLoadError]     = useState<string | null>(null);

  // Load patient roster on mount (single LIST query — no subscription)
  useEffect(() => {
    async function loadPatients() {
      try {
        const { data, errors } = await client.models.PatientRecord.list();
        if (errors?.length) console.warn('[AgentDashboard] partial errors', errors);

        const sorted = [...(data ?? [])].sort((a, b) =>
          `${a.lastName}${a.firstName}`.localeCompare(`${b.lastName}${b.firstName}`)
        );

        setPatients(sorted as unknown as PatientRecord[]);

        // Auto-select the first patient
        if (sorted.length && !selectedId) {
          setSelectedId((sorted[0] as unknown as PatientRecord).id);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setLoadError(msg);
        console.error('[AgentDashboard] patient load failed', err);
      }
    }
    loadPatients();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activePatient = patients.find((p) => p.id === selectedId) ?? null;

  return (
    /* Full-height flex row — fills the space left by App.tsx's top bar */
    <div className="flex flex-1 min-h-0 overflow-hidden">

      {/* ── Main content: 75% ──────────────────────────────────────────── */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden" style={{ width: '75%' }}>

        {/* Sub-header: title + patient search */}
        <header className="px-6 py-4 border-b border-gray-200 bg-white shrink-0">
          <div className="flex items-center justify-between gap-4 flex-wrap">
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
          </div>
        </header>

        {/* Error banner */}
        {loadError && (
          <div className="mx-6 mt-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700 shrink-0">
            <strong>Error loading patients:</strong> {loadError}
          </div>
        )}

        {/* Scrollable content */}
        <main className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {!activePatient && !loadError && (
            <div className="flex flex-col items-center justify-center py-24 text-gray-400 gap-3">
              <span className="text-4xl">👤</span>
              <p className="text-sm">
                {patients.length === 0
                  ? 'Loading patient roster…'
                  : 'Select a patient to view their record.'}
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

      {/* ── Right sidebar: CCP (25%) ────────────────────────────────────── */}
      <aside
        className="shrink-0 border-l border-gray-200 bg-white overflow-hidden"
        style={{ width: '25%', minWidth: '280px', maxWidth: '400px' }}
        aria-label="Call Control Panel"
      >
        <CallControlPanel />
      </aside>

    </div>
  );
}
