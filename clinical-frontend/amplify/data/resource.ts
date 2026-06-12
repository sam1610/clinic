import { type ClientSchema, a, defineData } from '@aws-amplify/backend';

/**
 * Clinical EHR Data Schema — Hybrid Native AI Architecture
 *
 * Models:
 *   PatientRecord        — Core patient demographics. EHR lookup anchor.
 *   HistoricalInteraction — Post-call enriched record written once per completed
 *                           contact by the Step Functions pipeline processor
 *                           (EventBridge CTR → StepFunctions → Lambda).
 *
 * Removed models (real-time streaming — no longer in architecture):
 *   ClinicalInteraction  — live WebSocket transcript feed (removed)
 *   ClinicalEntities     — live NLP entity stream (removed)
 *   PatientSummary       — live summary subscription (removed)
 *
 * Authorization policy:
 *   MedicalStaff and Psychologist groups have READ-only access to
 *   HistoricalInteraction records. Writes come exclusively from the
 *   backend Lambda (IAM-authenticated) via the Step Functions pipeline.
 */
const schema = a.schema({
  // ─────────────────────────────────────────────────────────────────────────
  // PatientRecord
  // Core patient demographics. Written by admin; read by all medical staff.
  // ─────────────────────────────────────────────────────────────────────────
  PatientRecord: a
    .model({
      patientId:   a.string().required(),
      firstName:   a.string().required(),
      lastName:    a.string().required(),
      dateOfBirth: a.date(),
      phoneNumber: a.string(),
      email:       a.email(),
      region:      a.string(), // "Bahrain" | "KSA"
    })
    .authorization((allow) => [
      allow.group('MedicalStaff').to(['read']),
      allow.group('Psychologist').to(['read']),
    ]),

  // ─────────────────────────────────────────────────────────────────────────
  // HistoricalInteraction
  //
  // Written once per completed call by the post-call Lambda processor.
  // Contains the full enriched output of the async Step Functions pipeline:
  //
  //   1. Raw transcript     (Amazon Transcribe Medical)
  //   2. Medical entities   (AWS Comprehend Medical — DetectEntitiesV2,
  //                          InferICD10CM, InferRxNorm)
  //   3. Diagnostic summary (Amazon Bedrock — Claude structured reasoning)
  //
  // AWSJSON fields let the Lambda write structured objects without a rigid
  // schema evolution burden and are returned to the frontend as parsed objects.
  //
  // Authorization:
  //   - MedicalStaff and Psychologist → read only (no create/update/delete)
  //   - Backend Lambda pipeline        → full write via IAM role (iam auth mode)
  // ─────────────────────────────────────────────────────────────────────────
  HistoricalInteraction: a
    .model({
      // ── Identity ────────────────────────────────────────────────────────
      patientId: a.string().required(),
      // Foreign key → PatientRecord.patientId

      contactId: a.string().required(),
      // Amazon Connect ContactId — unique per call, written by the Lambda

      // ── Timing ──────────────────────────────────────────────────────────
      date: a.datetime().required(),
      // ISO-8601 timestamp of the contact (ConnectedToSystemTimestamp from CTR)

      // ── Source artefacts ────────────────────────────────────────────────
      s3RecordingUrl: a.string(),
      // S3 URI of the call recording (from CTR RecordingLocation field)

      // ── Pipeline outputs ─────────────────────────────────────────────────
      rawTranscript: a.string(),
      // Full plain-text transcript from Amazon Transcribe Medical

      medicalEntities: a.json(),
      // Comprehend Medical output.
      // Shape: {
      //   entities:    Entity[],           // DetectEntitiesV2
      //   icd10Codes:  ICD10CMEntity[],    // InferICD10CM
      //   rxNormCodes: RxNormEntity[],     // InferRxNorm
      //   symptoms:    string[],
      //   medications: string[],
      //   conditions:  string[],
      //   procedures:  string[]
      // }

      diagnosticSummary: a.json(),
      // Bedrock (Claude) structured clinical assessment.
      // Shape: {
      //   diagnosticSummary:      string,
      //   differentialDiagnoses:  string[],
      //   recommendedActions:     string[],
      //   riskAssessment:         string   // "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"
      // }
    })
    .authorization((allow) => [
      // Medical staff can query and read records — no mutations from the frontend
      allow.group('MedicalStaff').to(['read']),
      allow.group('Psychologist').to(['read']),
      // The Step Functions pipeline Lambda writes records via IAM
      allow.authenticated().to(['read']),
    ]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    // Cognito User Pool is the default mode for frontend reads
    defaultAuthorizationMode: 'userPool',
  },
});

/**
 * Frontend usage — READ-ONLY patterns for the EHR dashboard:
 *
 * import { generateClient } from 'aws-amplify/data';
 * import type { Schema } from '@/amplify/data/resource';
 *
 * const client = generateClient<Schema>();
 *
 * // List all historical interactions for a patient (EHR view)
 * const { data: interactions } = await client.models.HistoricalInteraction.list({
 *   filter: { patientId: { eq: 'P-00123' } },
 * });
 *
 * // Access the Bedrock diagnostic summary (typed as `any` — shape is AWSJSON)
 * const summary = interactions[0]?.diagnosticSummary;
 *
 * // Access parsed medical entities
 * const entities = interactions[0]?.medicalEntities;
 *
 * NOTE: Do NOT use subscriptions (onCreate / onUpdate / onDelete) on this model.
 * The frontend is a static historical EHR. Real-time intelligence is owned
 * entirely by Amazon Connect Contact Lens.
 */
