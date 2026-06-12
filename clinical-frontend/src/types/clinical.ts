/**
 * Shared TypeScript types for the Clinical EHR.
 *
 * Mirrors the Amplify Gen 2 schema: PatientRecord + HistoricalInteraction.
 *
 * Removed streaming types (no longer in architecture):
 *   - ClinicalInteraction
 *   - ClinicalEntities
 *   - PatientSummary
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

// ── Comprehend Medical ──────────────────────────────────────────────────────

/**
 * One entity from DetectEntitiesV2.
 * https://docs.aws.amazon.com/comprehend-medical/latest/dev/API_medical_Entity.html
 */
export interface ComprehendEntity {
  Id?: number;
  Text: string;
  Category: string;     // "MEDICATION" | "MEDICAL_CONDITION" | "TEST_TREATMENT_PROCEDURE" | …
  Type: string;         // "BRAND_NAME" | "DX_NAME" | …
  Score: number;        // 0–1 confidence
  BeginOffset?: number;
  EndOffset?: number;
  Traits?: Array<{ Name: string; Score: number }>;
  Attributes?: Array<{ Type: string; Text: string; Score: number }>;
}

/**
 * Full medicalEntities AWSJSON field — written by comprehend-medical Lambda.
 * Contains entity arrays, convenience groupings, and mapped codes.
 */
export interface ComprehendMedicalOutput {
  entities:    ComprehendEntity[];
  icd10Codes?: Icd10Code[];
  rxNormCodes?: unknown[];
  symptoms?:    string[];
  medications?: string[];
  conditions?:  string[];
  procedures?:  string[];
}

/**
 * ICD-10 code extracted from the medicalEntities.icd10Codes array.
 */
export interface Icd10Code {
  code:        string;   // e.g. "F32.1"
  description: string;   // e.g. "Major depressive disorder, single episode, moderate"
  confidence:  number;   // 0–1
}

// ── Bedrock diagnostic summary ──────────────────────────────────────────────

/**
 * Shape of the diagnosticSummary AWSJSON field — written by bedrock-diagnostic Lambda.
 * Maps to the JSON Claude is prompted to return.
 */
export interface DiagnosticSummary {
  diagnosticSummary:      string;
  differentialDiagnoses?: string[];
  recommendedActions?:    string[];
  riskAssessment?:        string;   // "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"
}

// ── HistoricalInteraction ───────────────────────────────────────────────────

/**
 * One completed call, post-pipeline. Matches the Amplify schema exactly.
 * Field names match resource.ts — `date` (not `interactionDate`).
 */
export interface HistoricalInteraction {
  id:                string;
  patientId:         string;
  contactId:         string;
  date:              string;               // ISO-8601 — from schema field `date`
  s3RecordingUrl?:   string | null;        // S3 URI; convert to presigned HTTPS for playback
  rawTranscript?:    string | null;
  medicalEntities?:  ComprehendMedicalOutput | string | null;  // AWSJSON — may arrive pre-parsed or as string
  diagnosticSummary?: DiagnosticSummary | string | null;       // AWSJSON
  createdAt?:        string | null;
  updatedAt?:        string | null;
}

// ── Utility ─────────────────────────────────────────────────────────────────

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
