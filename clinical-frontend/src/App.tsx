/**
 * App.tsx – Root application shell with unified Cognito authentication.
 *
 * Single sign-on flow:
 *   1. User signs in once via the Amplify Authenticator (Cognito).
 *   2. The dashboard loads immediately — AppSync uses the Cognito JWT.
 *   3. The CCP panel loads alongside the dashboard and passes the same
 *      Cognito id_token to Connect, eliminating the second login.
 *
 * Layout (after sign-in):
 *   ┌──────────────── Dashboard ──────────────────┬───── CCP (360px) ─────┐
 *   │  top-bar (Cognito user + sign-out)          │  Connect panel        │
 *   │  AgentDashboard (tabs: transcripts/entities │  (auto-open, uses     │
 *   │  /summaries, live subscriptions)            │   same Cognito user)  │
 *   └─────────────────────────────────────────────┴───────────────────────┘
 */
import { Authenticator, useAuthenticator } from '@aws-amplify/ui-react';
import { AgentDashboard } from './components/AgentDashboard';
import { CallControlPanel } from './components/CallControlPanel';
import './App.css';

function AuthenticatedApp() {
  const { user, signOut } = useAuthenticator((ctx) => [ctx.user]);

  // Cognito groups from the access token
  const groups: string[] =
    (user?.signInUserSession?.accessToken?.payload?.['cognito:groups'] as string[]) ?? [];

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">

      {/* ── Left: main workspace ──────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Top bar — shows the single unified identity */}
        <div className="flex items-center gap-4 px-6 py-2 bg-white border-b border-gray-200 shrink-0">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            {/* Cognito identity badge */}
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-indigo-50 border border-indigo-100">
              <svg className="w-3.5 h-3.5 text-indigo-500 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
              </svg>
              <span className="text-xs font-medium text-indigo-700 truncate max-w-[180px]">
                {user?.username}
              </span>
            </div>

            {/* Group pills */}
            {groups.map((g) => (
              <span
                key={g}
                className="text-xs px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 font-medium"
              >
                {g}
              </span>
            ))}
          </div>

          {/* SSO status — reassures the user one account covers everything */}
          <div className="flex items-center gap-1.5 text-xs text-gray-400">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400" />
            Single sign-on active
          </div>

          <button
            onClick={signOut}
            className="text-xs px-3 py-1.5 rounded bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors"
          >
            Sign out
          </button>
        </div>

        {/* Dashboard */}
        <AgentDashboard />
      </div>

      {/* ── Right: Amazon Connect CCP ─────────────────────────────────── */}
      <CallControlPanel />

    </div>
  );
}

export default function App() {
  return (
    <Authenticator
      loginMechanisms={['email']}
      variation="modal"
    >
      <AuthenticatedApp />
    </Authenticator>
  );
}
