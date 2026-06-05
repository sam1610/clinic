/**
 * EntityPills – renders arrays of medical entities as colour-coded pills.
 */
interface PillGroupProps {
  label: string;
  items?: string[] | null;
  colour: string;
}

function PillGroup({ label, items, colour }: PillGroupProps) {
  if (!items?.length) return null;
  return (
    <div className="flex flex-wrap gap-1 items-center">
      <span className="text-xs font-semibold text-gray-500 mr-1">{label}:</span>
      {items.map((item) => (
        <span
          key={item}
          className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${colour}`}
        >
          {item}
        </span>
      ))}
    </div>
  );
}

interface Props {
  symptoms?: string[] | null;
  medications?: string[] | null;
  conditions?: string[] | null;
  procedures?: string[] | null;
}

export function EntityPills({ symptoms, medications, conditions, procedures }: Props) {
  const hasAny = [symptoms, medications, conditions, procedures].some((a) => a?.length);
  if (!hasAny) {
    return <p className="text-xs text-gray-400 italic">No entities extracted yet.</p>;
  }
  return (
    <div className="space-y-1">
      <PillGroup label="Symptoms"    items={symptoms}    colour="bg-red-50 text-red-700" />
      <PillGroup label="Medications" items={medications} colour="bg-blue-50 text-blue-700" />
      <PillGroup label="Conditions"  items={conditions}  colour="bg-purple-50 text-purple-700" />
      <PillGroup label="Procedures"  items={procedures}  colour="bg-green-50 text-green-700" />
    </div>
  );
}
