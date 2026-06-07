/**
 * comprehend-medical
 *
 * Step Functions Task — Step 3 of the Post-Call Processing pipeline.
 *
 * Receives the transcript text from the previous state, runs it through
 * AWS Comprehend Medical (DetectEntitiesV2 + InferICD10CM + InferRxNorm),
 * and returns the enriched payload for the diagnostic agent.
 *
 * Input:
 * {
 *   ...previous state output,
 *   transcriptText: string
 * }
 *
 * Output:
 * {
 *   ...input (pass-through),
 *   entities: Entity[],
 *   icd10Codes: ICD10CMConcept[],
 *   rxNormCodes: RxNormConcept[],
 *   symptoms: string[],
 *   medications: string[],
 *   conditions: string[],
 *   procedures: string[]
 * }
 */
import {
  ComprehendMedicalClient,
  DetectEntitiesV2Command,
  InferICD10CMCommand,
  InferRxNormCommand,
  Entity,
} from '@aws-sdk/client-comprehendmedical';

const comprehend = new ComprehendMedicalClient({
  region: process.env.AWS_REGION || 'us-east-1',
});

/** Truncate text to Comprehend Medical's 20KB limit */
function truncate(text: string, maxChars = 20000): string {
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

function byCategory(entities: Entity[], category: string): string[] {
  return entities
    .filter((e) => e.Category === category && (e.Score ?? 0) >= 0.7)
    .map((e) => e.Text ?? '')
    .filter(Boolean);
}

export const handler = async (input: Record<string, unknown>) => {
  const transcriptText = (input.transcriptText as string) || '';
  console.log(`Comprehend Medical: processing ${transcriptText.length} chars`);

  if (!transcriptText.trim()) {
    console.warn('Empty transcript — skipping Comprehend');
    return {
      ...input,
      entities: [],
      icd10Codes: [],
      rxNormCodes: [],
      symptoms: [],
      medications: [],
      conditions: [],
      procedures: [],
    };
  }

  const text = truncate(transcriptText);

  // Run all three Comprehend Medical APIs concurrently
  const [entitiesResult, icd10Result, rxNormResult] = await Promise.all([
    comprehend.send(new DetectEntitiesV2Command({ Text: text })),
    comprehend.send(new InferICD10CMCommand({ Text: text })),
    comprehend.send(new InferRxNormCommand({ Text: text })),
  ]);

  const entities = entitiesResult.Entities ?? [];
  const icd10Codes = icd10Result.Entities ?? [];
  const rxNormCodes = rxNormResult.Entities ?? [];

  const symptoms    = byCategory(entities, 'MEDICAL_CONDITION');
  const medications = byCategory(entities, 'MEDICATION');
  const conditions  = byCategory(entities, 'DX_NAME');
  const procedures  = byCategory(entities, 'PROCEDURE');

  console.log('Extracted:', {
    entities: entities.length,
    icd10: icd10Codes.length,
    rxNorm: rxNormCodes.length,
    symptoms: symptoms.length,
    medications: medications.length,
  });

  return {
    ...input,
    // Serialise full responses for the final write step
    entitiesJson: JSON.stringify({ entities, icd10Codes, rxNormCodes }),
    // Convenience arrays for the diagnostic agent
    entities,
    icd10Codes,
    rxNormCodes,
    symptoms,
    medications,
    conditions,
    procedures,
  };
};
