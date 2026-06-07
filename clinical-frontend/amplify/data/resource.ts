import { type ClientSchema, a, defineData } from '@aws-amplify/backend';

/**
 * Clinical AI Assistant Data Schema
 *
 * This schema supports the asynchronous Step Functions medical pipeline:
 *
 * - PatientRecord:        Core patient demographics. Acts as the EHR anchor.
 * - HistoricalInteraction: Post-call record written by the pipeline processor
 *                          (EventBridge → Lambda). Contains the full enriched
 *                          payload: transcript, Comprehend Medical entities,
 *                          ICD-10 codes, and Bedrock diagnostic summary.
 *
 * Real-time streaming models (ClinicalInteraction, ClinicalEntities,
 * PatientSummary) have been removed — real-time intelligence is handled
 * natively by Amazon Connect AI / Contact Lens.
 */
const schema = a.schema({
  /**
   * PatientRecord
   * Stores patient demographics. Serves as the EHR lookup key for staff.
   */
  PatientRecord: a
    .model({
      patientId: a.string().required(),
      firstName: a.string().required(),
      lastName: a.string().required(),
      dateOfBirth: a.date(),
      phoneNumber: a.string(),
      email: a.email(),
      region: a.string(), // "Bahrain" | "KSA"
    })
    .authorization((allow) => [
      allow.group('MedicalStaff'),
      allow.group('Psychologist'),
    ]),

  /**
   * HistoricalInteraction
   *
   * Written once per completed contact by the post-call Lambda processor.
   * Contains the full enriched output of the Step Functions pipeline:
   *   1. Raw transcript (Amazon Transcribe Medical)
   *   2. Medical entities (AWS Comprehend Medical)
   *   3. ICD-10 mapped conditions
   *   4. Diagnostic summary (Amazon Bedrock agent structured reasoning)
   *
   * All JSON fields use AWSJSON so the Lambda can write arbitrary
   * structured objects without a rigid schema evolution burden.
   */
  HistoricalInteraction: a
    .model({
      // --- Identity ---
      patientId: a.string().required(),       // FK to PatientRecord.patientId
      contactId: a.string().required(),       // Amazon Connect ContactId (unique per call)

      // --- Timing ---
      interactionDate: a.datetime().required(), // ISO-8601 timestamp of the contact

      // --- Source artefacts ---
      s3RecordingUrl: a.string(),             // S3 URI of the call recording

      // --- Pipeline outputs ---
      rawTranscript: a.string(),              // Full text transcript from Transcribe Medical

      medicalEntities: a.json(),              // Comprehend Medical DetectEntitiesV2 response
                                              // Shape: { entities: [...], unmappedAttributes: [...] }

      icd10Codes: a.json(),                   // Mapped ICD-10 conditions
                                              // Shape: [{ code: "F32.1", description: "...", confidence: 0.92 }]

      diagnosticSummary: a.json(),            // Bedrock agent structured reasoning
                                              // Shape: { summary: "...", riskLevel: "...", recommendations: [...] }
    })
    .authorization((allow) => [
      allow.group('MedicalStaff'),
      allow.group('Psychologist'),
    ]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'userPool',
  },
});

/**
 * Frontend usage examples:
 *
 * import { generateClient } from "aws-amplify/data";
 * import type { Schema } from "@/amplify/data/resource";
 *
 * const client = generateClient<Schema>();
 *
 * // List all historical interactions for a patient
 * const { data: interactions } = await client.models.HistoricalInteraction.list({
 *   filter: { patientId: { eq: "P-00123" } },
 * });
 *
 * // Access the Bedrock diagnostic summary (typed as `any` — shape is AWSJSON)
 * const summary = interactions[0].diagnosticSummary;
 */
