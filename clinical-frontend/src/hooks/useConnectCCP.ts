import { useEffect, useRef, useState, useCallback } from 'react';
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

  const initCCP = useCallback(() => {
    if (!containerRef.current || initialisedRef.current) return;
    if (!config.ccpUrl) return;

    try {
      initialisedRef.current = true;

      const initOptions: connect.InitCCPOptions = {
        ccpUrl: config.ccpUrl,
        // ALWAYS use the popup for native Connect users (Agent1, psy)
        loginPopup: config.loginPopup ?? true,
        loginPopupAutoClose: config.loginPopupAutoClose ?? true,
        softphone: {
          allowFramedSoftphone: config.softphone?.allowFramedSoftphone ?? true,
          disableRingtone: config.softphone?.disableRingtone ?? false,
        },
        storageAccess: { canRequest: true },
      };

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

  useEffect(() => {
    if (config.ccpUrl && containerRef.current && !initialisedRef.current) {
      initCCP();
    }
  }, [config.ccpUrl, containerRef, initCCP]);

  return { isInitialised, agentState, contact, error, initCCP };
}