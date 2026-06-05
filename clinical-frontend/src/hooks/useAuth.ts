/**
 * Authentication Hook
 * 
 * Custom React hook for managing authentication state and user groups.
 */

import { useState, useEffect } from 'react';
import { fetchAuthSession, getCurrentUser, signOut } from 'aws-amplify/auth';

export type UserGroup = 'MedicalStaff' | 'Psychologist';

export interface AuthUser {
  username: string;
  email?: string;
  groups: UserGroup[];
  isMedicalStaff: boolean;
  isPsychologist: boolean;
}

export interface UseAuthReturn {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  error: Error | null;
  signOut: () => Promise<void>;
  refreshAuth: () => Promise<void>;
}

/**
 * Hook to manage authentication state
 * 
 * @example
 * ```typescript
 * function MyComponent() {
 *   const { user, isAuthenticated, isLoading, signOut } = useAuth();
 * 
 *   if (isLoading) return <div>Loading...</div>;
 *   if (!isAuthenticated) return <div>Please sign in</div>;
 * 
 *   return (
 *     <div>
 *       <p>Welcome, {user.username}</p>
 *       {user.isMedicalStaff && <p>You are medical staff</p>}
 *       {user.isPsychologist && <p>You are a psychologist</p>}
 *       <button onClick={signOut}>Sign Out</button>
 *     </div>
 *   );
 * }
 * ```
 */
export function useAuth(): UseAuthReturn {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchUser = async () => {
    try {
      setIsLoading(true);
      setError(null);

      // Get current user
      const currentUser = await getCurrentUser();
      
      // Get user session to extract groups
      const session = await fetchAuthSession();
      const groups = (session.tokens?.accessToken.payload['cognito:groups'] as string[]) || [];

      // Map to UserGroup type
      const userGroups = groups.filter(
        (group): group is UserGroup => 
          group === 'MedicalStaff' || group === 'Psychologist'
      );

      setUser({
        username: currentUser.username,
        email: currentUser.signInDetails?.loginId,
        groups: userGroups,
        isMedicalStaff: userGroups.includes('MedicalStaff'),
        isPsychologist: userGroups.includes('Psychologist'),
      });
    } catch (err) {
      console.error('Error fetching user:', err);
      setError(err instanceof Error ? err : new Error('Failed to fetch user'));
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchUser();
  }, []);

  const handleSignOut = async () => {
    try {
      await signOut();
      setUser(null);
    } catch (err) {
      console.error('Error signing out:', err);
      setError(err instanceof Error ? err : new Error('Failed to sign out'));
    }
  };

  return {
    user,
    isLoading,
    isAuthenticated: user !== null,
    error,
    signOut: handleSignOut,
    refreshAuth: fetchUser,
  };
}
