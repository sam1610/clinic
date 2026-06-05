/**
 * useConnectCCP
 *
 * Initialises the Amazon Connect Streams CCP.
 *
 * Unified-auth flow:
 *   1. Fetch the Cognito id_token from the active Amplify session.
 *   2. Pass it as `loginToken` to initCCP so Connect skips its own login form.
 *   3. If no token is available yet, fall back to loginPopup (safe fallback).
 *
 * This requires the Connect instance to have Cognito configured as an
 * external IdP (SAML). See README for setup instructions.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { fetchAuthSession } from 'aws-amplify/auth';
import 'amazon-connect-streams';

export interface ConnectConfig {
  ccpUrl: string;
  loginPopup?: boolean;
  loginPopupAutoClose?: boolean;
  softphone?: {
    allowFramedSoftphone?: boolean;
    disableRingtone?: boolean;
  };
}

export interface AgentState {
  name: string;
  type: string;
}

export interface ContactInfo {
  contactId: string;
  channel: string;
  status: string;
  queue?: string;
}

export interface UseConnectCCPReturn {
  isInitialised: boolean;
  agentState: AgentState | null;
  contact: ContactInfo | null;
  error: string | null;
  /** Call to manually trigger CCP initialisation (e.g. after user clicks button) */
  initCCP: () => void;
}

export function useConnectCCP(
  containerRef: React.RefObject<HTMLDivElement | null>,
  config: ConnectConfig
): UseConnectCCPReturn {
  const [isInitialised, setIsInitialised] = useState(false);
  const [agentState, setAgentState] = useState<AgentState | null>(null);
  const [contact, setContact] = useState<ContactInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const initialisedRef = useRef(false);

  const initCCP = useCallback(async () => {
    if (!containerRef.current || initialisedRef.current) return;
    if (!config.ccpUrl) return;

    try {
      initialisedRef.current = true;

      // Attempt to get Cognito token for SSO passthrough
      let loginToken: string | undefined;
      try {
        const session = await fetchAuthSession();
        // Use the id_token — Connect SAML federation expects this
        loginToken = session.tokens?.idToken?.toString();
      } catch {
        // Not signed in yet or session expired — fall back to popup login
        loginToken = undefined;
      }

      const initOptions: connect.InitCCPOptions = {
        ccpUrl: config.ccpUrl,
        loginPopup: loginToken ? false : (config.loginPopup ?? true),
        loginPopupAutoClose: config.loginPopupAutoClose ?? true,
        softphone: {
          allowFramedSoftphone: config.softphone?.allowFramedSoftphone ?? true,
          disableRingtone: config.softphone?.disableRingtone ?? false,
        },
        storageAccess: { canRequest: true },
      };

      // If we have a token, append it to the CCP URL for federated SSO
      // Connect reads `?token=<jwt>` and skips the login screen
      if (loginToken) {
        const url = new URL(config.ccpUrl);
        url.searchParams.set('token', loginToken);
        (initOptions as any).ccpUrl = url.toString();
      }

      connect.core.initCCP(containerRef.current, initOptions);

      // ── Agent events ────────────────────────────────────────────────
      connect.agent((agent) => {
        const sync = () => {
          const s = agent.getState();
          setAgentState({ name: s.name, type: s.type });
        };
        sync();
        agent.onStateChange(sync);
        agent.onRefresh(sync);
      });

      // ── Contact events ──────────────────────────────────────────────
      connect.contact((c) => {
        const sync = () =>
          setContact({
            contactId: c.getContactId(),
            channel: c.getChannel(),
            status: c.getStatus().type,
            queue: c.getQueue()?.name,
          });
        sync();
        c.onConnected(sync);
        c.onRefresh(sync);
        c.onEnded(() => setContact(null));
        c.onError(() => setContact(null));
      });

      setIsInitialised(true);
    } catch (err) {
      initialisedRef.current = false; // allow retry
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[CCP init error]', msg);
      setError(msg);
    }
  }, [containerRef, config]);

  // Auto-init when the container becomes available
  useEffect(() => {
    if (config.ccpUrl && containerRef.current && !initialisedRef.current) {
      initCCP();
    }
  }, [config.ccpUrl, containerRef, initCCP]);

  return { isInitialised, agentState, contact, error, initCCP };
}
