/**
 * PatientProfile
 *
 * Displays core demographics for the selected patient.
 * Shown in the 75%-width main content area of AgentDashboard.
 */
import type { PatientRecord } from '../types/clinical';

interface Props {
  patient: PatientRecord;
}

function Field({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</dt>
      <dd className="mt-0.5 text-sm text-gray-900">{value}</dd>
    </div>
  );
}

function formatDOB(dob?: string | null): string {
  if (!dob) return '';
  try {
    return new Date(dob).toLocaleDateString([], {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return dob;
  }
}

export function PatientProfile({ patient }: Props) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      {/* Avatar + name row */}
      <div className="flex items-center gap-4 mb-5">
        <div
          className="w-14 h-14 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-xl font-bold shrink-0"
          aria-hidden="true"
        >
          {patient.firstName[0]}{patient.lastName[0]}
        </div>
        <div>
          <h2 className="text-lg font-bold text-gray-900">
            {patient.firstName} {patient.lastName}
          </h2>
          <p className="text-sm text-gray-500 font-mono">{patient.patientId}</p>
        </div>

        {/* Region badge */}
        {patient.region && (
          <span className="ml-auto inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            {patient.region}
          </span>
        )}
      </div>

      {/* Demographics grid */}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
        <Field label="Date of Birth"  value={formatDOB(patient.dateOfBirth)} />
        <Field label="Phone"          value={patient.phoneNumber} />
        <Field label="Email"          value={patient.email} />
      </dl>
    </div>
  );
}
