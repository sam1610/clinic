/**
 * Shared TypeScript types for clinical data models.
 * These mirror the Amplify Gen 2 schema types for convenient use in components.
 */

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

export interface ClinicalInteraction {
  id: string;
  interactionId: string;
  patientRecordId: string;
  audioS3Uri?: string | null;
  transcriptText?: string | null;
  channel?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  duration?: number | null;
  connectContactId?: string | null;
  agentId?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface ClinicalEntities {
  id: string;
  entityId: string;
  clinicalInteractionId: string;
  entitiesJson?: Record<string, unknown> | null;
  symptoms?: string[] | null;
  medications?: string[] | null;
  conditions?: string[] | null;
  procedures?: string[] | null;
  extractedAt?: string | null;
  comprehendJobId?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface PatientSummary {
  id: string;
  summaryId: string;
  patientRecordId: string;
  summaryText: string;
  diagnosticSuggestions?: string[] | null;
  riskLevel?: string | null;
  agentType?: string | null;
  agentVersion?: string | null;
  generatedAt?: string | null;
  embeddingId?: string | null;
  similarCasesCount?: number | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export type RiskLevel = 'Low' | 'Medium' | 'High';
export type Channel = 'Voice' | 'WhatsApp' | 'WebChat';
