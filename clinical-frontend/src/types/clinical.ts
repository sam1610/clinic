/**
 * Shared TypeScript types for the Clinical EHR.
 *
 * Mirrors the Amplify Gen 2 schema: PatientRecord + HistoricalInteraction.
 * The old real-time streaming types (ClinicalInteraction, ClinicalEntities,
 * PatientSummary) have been removed along with the schema models they mapped to.
 */

// ── Patient demographics ────────────────────────────────────────────────────

export interface PatientRecord {
  id: string;
  patientId: string;
  firstName: string;
  lastName: string;
  dateOfBirth?: string | null;
  phoneNumber?: string | null;
  email?: string | null;
  region?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

// ── Post-call pipeline output ───────────────────────────────────────────────

/**
 * Shape of one entry in the medicalEntities AWSJSON field.
 * Mirrors the Comprehend Medical DetectEntitiesV2 entity object.
 */
export interface ComprehendEntity {
  Id?: number;
  Text: string;
  Category: string;   // e.g. "MEDICATION" | "MEDICAL_CONDITION" | "TEST_TREATMENT_PROCEDURE"
  Type: string;       // e.g. "BRAND_NAME" | "DX_NAME"
  Score: number;
  BeginOffset?: number;
  EndOffset?: number;
  Traits?: Array<{ Name: string; Score: number }>;
  Attributes?: Array<{ Type: string; Text: string; Score: number }>;
}

export interface ComprehendMedicalOutput {
  entities: ComprehendEntity[];
  unmappedAttributes?: unknown[];
}

/**
 * One ICD-10 code from the icd10Codes AWSJSON field.
 */
export interface Icd10Code {
  code: string;         // e.g. "F32.1"
  description: string;  // e.g. "Major depressive disorder, single episode, moderate"
  confidence: number;   // 0–1
}

/**
 * Shape of the diagnosticSummary AWSJSON field — Bedrock agent output.
 */
export interface DiagnosticSummary {
  summary: string;
  riskLevel?: 'Low' | 'Medium' | 'High' | string | null;
  recommendations?: string[];
}

/**
 * HistoricalInteraction — one completed call, post-pipeline.
 */
export interface HistoricalInteraction {
  id: string;
  patientId: string;
  contactId: string;
  interactionDate: string;          // ISO-8601
  s3RecordingUrl?: string | null;   // S3 URI → converted to presigned URL for playback
  rawTranscript?: string | null;
  medicalEntities?: ComprehendMedicalOutput | null;
  icd10Codes?: Icd10Code[] | null;
  diagnosticSummary?: DiagnosticSummary | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

// ── Utility types ───────────────────────────────────────────────────────────

export type RiskLevel = 'Low' | 'Medium' | 'High';
