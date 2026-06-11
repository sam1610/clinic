/**
 * CallControlPanel
 *
 * Fills 100% of whatever container it is placed in.
 * Sizing and collapse behaviour are owned by the parent (AgentDashboard).
 *
 * Prerequisites in Amazon Connect console:
 *   1. Approved origins → add http://localhost:5173 (+ your prod domain)
 *   2. (For full SSO) Security profiles → Enable SAML → point to your
 *      Cognito User Pool as the IdP.
 */
import { useRef } from 'react';
import { useAuthenticator } from '@aws-amplify/ui-react';
import { useConnectCCP } from '../hooks/useConnectCCP';

const CCP_URL = import.meta.env.VITE_CONNECT_CCP_URL as string | undefined;

export function CallControlPanel() {
  const containerRef = useRef<HTMLDivElement>(null);
  const { user } = useAuthenticator((ctx) => [ctx.user]);

  const ccpUrl    = CCP_URL?.trim() ?? '';
  const hasCcpUrl = ccpUrl.length > 0;

  const { isInitialised, agentState, contact, error } = useConnectCCP(containerRef, {
    ccpUrl,
    loginPopup: true,
    loginPopupAutoClose: true,
    softphone: { allowFramedSoftphone: true },
  });

  // Status dot colour
  const dotColour =
    contact?.status === 'connected'     ? 'bg-green-500'  :
    agentState?.name === 'Available'    ? 'bg-emerald-400' :
    agentState?.name === 'Offline'      ? 'bg-gray-400'   :
                                          'bg-amber-400';

  return (
    <div className="flex flex-col h-full w-full overflow-hidden">

      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="px-4 py-3 bg-indigo-700 text-white shrink-0">
        <div className="flex items-center gap-2 mb-1">
          <span className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${hasCcpUrl ? dotColour : 'bg-gray-400'}`} />
          <h2 className="text-sm font-semibold tracking-wide">Call Control Panel</h2>
          {agentState && (
            <span className="ml-auto text-xs text-indigo-200">{agentState.name}</span>
          )}
        </div>

        {user && (
          <div className="flex items-center gap-1.5 mt-1">
            <svg className="w-3 h-3 text-indigo-300 shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
            </svg>
            <span className="text-xs text-indigo-200 truncate max-w-[160px]">{user.username}</span>
            {agentState ? (
              <span className="text-xs text-green-300 ml-auto font-medium">✓ Connect active</span>
            ) : (
              <span className="text-xs text-amber-300 ml-auto">Sign in to Connect ↓</span>
            )}
          </div>
        )}
      </div>

      {/* ── Active contact banner ───────────────────────────────────── */}
      {contact && (
        <div className="px-4 py-2 bg-green-50 border-b border-green-100 text-xs text-green-800 shrink-0">
          <div className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <strong>{contact.channel}</strong> contact active
            {contact.queue && <span className="text-green-600">· {contact.queue}</span>}
          </div>
          <p className="text-green-600 mt-0.5 font-mono text-xs">
            #{contact.contactId.slice(0, 12)}…
          </p>
        </div>
      )}

      {/* ── Not configured placeholder ──────────────────────────────── */}
      {!hasCcpUrl && (
        <div className="flex flex-col items-center justify-center flex-1 gap-3 p-6 text-center">
          <div className="text-4xl">📞</div>
          <p className="text-sm font-medium text-gray-600">Amazon Connect not configured</p>
          <pre className="text-xs bg-gray-50 border border-gray-200 rounded p-3 w-full text-left text-gray-600 whitespace-pre-wrap break-all">
{`# .env.local
VITE_CONNECT_CCP_URL=https://<instance>.my.connect.aws/ccp-v2`}
          </pre>
          <p className="text-xs text-gray-400">Then restart the dev server.</p>
        </div>
      )}

      {/* ── Runtime error ───────────────────────────────────────────── */}
      {hasCcpUrl && error && (
        <div className="m-3 p-3 bg-red-50 border border-red-200 rounded text-xs text-red-700">
          <strong>Connect error:</strong> {error}
          <p className="mt-1 text-red-500">
            Ensure <code>http://localhost:5173</code> is in your Connect instance's{' '}
            <strong>Approved origins</strong>.
          </p>
        </div>
      )}

      {/* ── CCP iframe ──────────────────────────────────────────────── */}
      {hasCcpUrl && (
        <div ref={containerRef} id="ccp-container" className="flex-1 min-h-0" />
      )}

      {/* ── Loading overlay ─────────────────────────────────────────── */}
      {hasCcpUrl && !isInitialised && !error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-white/90 pointer-events-none">
          <div className="w-8 h-8 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin" />
          <p className="text-sm text-gray-500 animate-pulse">Connecting to Amazon Connect…</p>
          <p className="text-xs text-gray-400">
            Signing in as <strong>{user?.username}</strong>
          </p>
        </div>
      )}
    </div>
  );
}
