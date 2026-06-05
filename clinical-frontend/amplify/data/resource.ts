import { type ClientSchema, a, defineData } from '@aws-amplify/backend';

/**
 * Clinical AI Assistant Data Schema
 * 
 * This schema defines the core data models for the Multi-Modal Clinical AI Assistant:
 * - PatientRecord: Basic patient demographics
 * - ClinicalInteraction: Audio recordings and transcripts from patient interactions
 * - ClinicalEntities: Structured medical entities extracted by AWS Comprehend Medical
 * - PatientSummary: AI-generated summaries and diagnostic suggestions from Strands Agents
 * 
 * All models are restricted to authenticated users in MedicalStaff or Psychologist groups.
 */
const schema = a.schema({
  /**
   * PatientRecord: Stores basic patient demographics and metadata
   */
  PatientRecord: a
    .model({
      patientId: a.string().required(),
      firstName: a.string().required(),
      lastName: a.string().required(),
      dateOfBirth: a.date(),
      phoneNumber: a.string(),
      email: a.email(),
      region: a.string(), // Bahrain or KSA
      createdAt: a.datetime(),
      updatedAt: a.datetime(),
      // Relationships
      interactions: a.hasMany('ClinicalInteraction', 'patientRecordId'),
      summaries: a.hasMany('PatientSummary', 'patientRecordId'),
    })
    .authorization((allow) => [
      allow.group('MedicalStaff'),
      allow.group('Psychologist'),
    ]),

  /**
   * ClinicalInteraction: Stores audio recordings, transcripts, and interaction metadata
   */
  ClinicalInteraction: a
    .model({
      interactionId: a.string().required(),
      patientRecordId: a.id().required(),
      // Audio and transcript data
      audioS3Uri: a.string(), // S3 URI for the call recording
      transcriptText: a.string(), // Raw transcript from Amazon Transcribe Medical
      // Interaction metadata
      channel: a.string(), // Voice, WhatsApp, WebChat
      startTime: a.datetime(),
      endTime: a.datetime(),
      duration: a.integer(), // Duration in seconds
      // Connect metadata
      connectContactId: a.string(),
      agentId: a.string(), // Medical staff or psychologist who handled the call
      // Relationships
      patientRecord: a.belongsTo('PatientRecord', 'patientRecordId'),
      entities: a.hasMany('ClinicalEntities', 'clinicalInteractionId'),
    })
    .authorization((allow) => [
      allow.group('MedicalStaff'),
      allow.group('Psychologist'),
    ]),

  /**
   * ClinicalEntities: Stores structured medical entities extracted by AWS Comprehend Medical
   */
  ClinicalEntities: a
    .model({
      entityId: a.string().required(),
      clinicalInteractionId: a.id().required(),
      // Comprehend Medical output (stored as JSON string)
      entitiesJson: a.json().required(), // Full JSON output from Comprehend Medical
      // Extracted entity summary
      symptoms: a.string().array(), // List of symptoms detected
      medications: a.string().array(), // List of medications mentioned
      conditions: a.string().array(), // List of medical conditions
      procedures: a.string().array(), // List of procedures mentioned
      // Metadata
      extractedAt: a.datetime(),
      comprehendJobId: a.string(),
      // Relationships
      interaction: a.belongsTo('ClinicalInteraction', 'clinicalInteractionId'),
    })
    .authorization((allow) => [
      allow.group('MedicalStaff'),
      allow.group('Psychologist'),
    ]),

  /**
   * PatientSummary: Stores AI-generated summaries and diagnostic suggestions from Strands Agents
   */
  PatientSummary: a
    .model({
      summaryId: a.string().required(),
      patientRecordId: a.id().required(),
      // AI-generated content
      summaryText: a.string().required(), // Generated summary from Strands Agents
      diagnosticSuggestions: a.string().array(), // Suggested diagnoses
      riskLevel: a.string(), // Low, Medium, High (for psychological risk assessment)
      // Agent metadata
      agentType: a.string(), // summarization-agent, diagnostic-agent
      agentVersion: a.string(),
      generatedAt: a.datetime(),
      // Vector search metadata
      embeddingId: a.string(), // Reference to OpenSearch vector embedding
      similarCasesCount: a.integer(), // Number of similar historical cases found
      // Relationships
      patientRecord: a.belongsTo('PatientRecord', 'patientRecordId'),
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
 * Usage in React Frontend:
 * 
 * import { generateClient } from "aws-amplify/data";
 * import type { Schema } from "@/amplify/data/resource";
 * 
 * const client = generateClient<Schema>();
 * 
 * // Example: List all patient records
 * const { data: patients } = await client.models.PatientRecord.list();
 * 
 * // Example: Create a new clinical interaction
 * await client.models.ClinicalInteraction.create({
 *   interactionId: "INT-12345",
 *   patientRecordId: "patient-id",
 *   audioS3Uri: "s3://bucket/recording.wav",
 *   transcriptText: "Patient reports headache...",
 *   channel: "Voice",
 *   startTime: new Date().toISOString(),
 * });
 */

// return <ul>{todos.map(todo => <li key={todo.id}>{todo.content}</li>)}</ul>
