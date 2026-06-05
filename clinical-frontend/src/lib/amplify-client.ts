/**
 * Amplify Data Client
 * 
 * This module provides a typed client for interacting with the AppSync GraphQL API.
 * Import this client in your React components to perform CRUD operations on the data models.
 */

import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../amplify/data/resource';

/**
 * Typed Amplify Data client
 * 
 * Usage:
 * ```typescript
 * import { client } from '@/lib/amplify-client';
 * 
 * // Create a patient record
 * const patient = await client.models.PatientRecord.create({
 *   patientId: 'PAT-12345',
 *   firstName: 'Ahmed',
 *   lastName: 'Al-Mansoori',
 *   // ... other fields
 * });
 * 
 * // List all interactions for a patient
 * const { data: interactions } = await client.models.ClinicalInteraction.list({
 *   filter: { patientRecordId: { eq: 'patient-id' } }
 * });
 * 
 * // Subscribe to real-time updates
 * const subscription = client.models.PatientSummary.onCreate().subscribe({
 *   next: (data) => console.log('New summary:', data),
 * });
 * ```
 */
export const client = generateClient<Schema>();

/**
 * Type exports for use in components
 */
export type {
  Schema,
} from '../../amplify/data/resource';
