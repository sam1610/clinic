/**
 * Authentication Example Component
 * 
 * Demonstrates how to use the useAuth hook and check user groups.
 */

import { useAuth } from '../hooks/useAuth';

export function AuthExample() {
  const { user, isAuthenticated, isLoading, signOut } = useAuth();

  if (isLoading) {
    return (
      <div className="p-4 bg-gray-100 rounded">
        <p>Loading authentication...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="p-4 bg-yellow-100 rounded">
        <p>Please sign in to access the application.</p>
      </div>
    );
  }

  return (
    <div className="p-4 bg-green-100 rounded">
      <h2 className="text-xl font-bold mb-2">Authentication Status</h2>
      
      <div className="mb-4">
        <p><strong>Username:</strong> {user.username}</p>
        {user.email && <p><strong>Email:</strong> {user.email}</p>}
      </div>

      <div className="mb-4">
        <p><strong>User Groups:</strong></p>
        <ul className="list-disc list-inside">
          {user.groups.map((group) => (
            <li key={group}>{group}</li>
          ))}
        </ul>
      </div>

      <div className="mb-4">
        <p><strong>Permissions:</strong></p>
        <ul className="list-disc list-inside">
          {user.isMedicalStaff && <li>✅ Medical Staff Access</li>}
          {user.isPsychologist && <li>✅ Psychologist Access</li>}
        </ul>
      </div>

      <button
        onClick={signOut}
        className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600"
      >
        Sign Out
      </button>
    </div>
  );
}
