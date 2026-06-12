/**
 * Amplify Data Client
 *
 * Typed AppSync GraphQL client for the clinical EHR dashboard.
 * Supports READ-ONLY queries against PatientRecord and HistoricalInteraction.
 *
 * No subscriptions — the frontend is a static historical EHR.
 * Real-time call handling is owned entirely by Amazon Connect.
 *
 * Usage:
 * ```typescript
 * import { client } from '@/lib/amplify-client';
 *
 * // Look up a patient
 * const { data: patient } = await client.models.PatientRecord.list({
 *   filter: { patientId: { eq: 'PAT-12345' } },
 * });
 *
 * // List all historical interactions for a patient (EHR timeline)
 * const { data: interactions } = await client.models.HistoricalInteraction.list({
 *   filter: { patientId: { eq: 'PAT-12345' } },
 * });
 *
 * // Read a single interaction by ID
 * const { data: interaction } = await client.models.HistoricalInteraction.get({
 *   id: 'HI-abc123',
 * });
 *
 * // Access typed AWSJSON fields (returned as parsed objects)
 * const summary   = interaction?.diagnosticSummary;   // Bedrock output
 * const entities  = interaction?.medicalEntities;     // Comprehend Medical output
 * ```
 */

import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../amplify/data/resource';

/** Typed Amplify Data client — scoped to the clinical EHR schema */
export const client = generateClient<Schema>();

/** Re-export the schema type for use in component prop types */
export type { Schema } from '../../amplify/data/resource';
