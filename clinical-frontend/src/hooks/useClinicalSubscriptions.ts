/**
 * useClinicalSubscriptions
 *
 * Sets up all three real-time AppSync GraphQL subscriptions:
 *   - ClinicalInteraction.onCreate  → new transcripts
 *   - ClinicalEntities.onCreate     → newly extracted entities
 *   - PatientSummary.onCreate       → new AI summaries
 *
 * Subscriptions are torn down automatically when the component unmounts.
 */

import { useEffect, useRef, useCallback } from 'react';
import { client } from '../lib/amplify-client';
import type {
  ClinicalInteraction,
  ClinicalEntities,
  PatientSummary,
} from '../types/clinical';

export interface SubscriptionCallbacks {
  onNewInteraction?: (record: ClinicalInteraction) => void;
  onNewEntities?: (record: ClinicalEntities) => void;
  onNewSummary?: (record: PatientSummary) => void;
  onError?: (error: Error) => void;
}

export function useClinicalSubscriptions(callbacks: SubscriptionCallbacks) {
  // Use refs so stale closures never capture an old callback reference
  const cbRef = useRef(callbacks);
  useEffect(() => {
    cbRef.current = callbacks;
  });

  const onError = useCallback((err: unknown) => {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error('[subscription error]', error);
    cbRef.current.onError?.(error);
  }, []);

  useEffect(() => {
    // ── 1. ClinicalInteraction ───────────────────────────────────────────
    const interactionSub = (client.models.ClinicalInteraction as any)
      .onCreate()
      .subscribe({
        next: (record: ClinicalInteraction) => {
          console.log('[sub] new ClinicalInteraction', record.id);
          cbRef.current.onNewInteraction?.(record);
        },
        error: onError,
      });

    // ── 2. ClinicalEntities ──────────────────────────────────────────────
    const entitiesSub = (client.models.ClinicalEntities as any)
      .onCreate()
      .subscribe({
        next: (record: ClinicalEntities) => {
          console.log('[sub] new ClinicalEntities', record.id);
          cbRef.current.onNewEntities?.(record);
        },
        error: onError,
      });

    // ── 3. PatientSummary ────────────────────────────────────────────────
    const summarySub = (client.models.PatientSummary as any)
      .onCreate()
      .subscribe({
        next: (record: PatientSummary) => {
          console.log('[sub] new PatientSummary', record.id);
          cbRef.current.onNewSummary?.(record);
        },
        error: onError,
      });

    return () => {
      interactionSub.unsubscribe();
      entitiesSub.unsubscribe();
      summarySub.unsubscribe();
    };
  }, [onError]);
}
