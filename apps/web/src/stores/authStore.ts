import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface User {
  id: number;
  eoaAddress: string;
  proxyAddress: string | null;
  username: string | null;
  proxyDeployed: boolean;
  totalOrders: number;
  totalVolume: number;
  realizedPnl: number;
}

interface AuthState {
  // Session
  token: string | null;
  user: User | null;
  isAuthenticated: boolean;

  // Trading credentials
  hasCredentials: boolean;
  credentialsChecked: boolean;

  // Actions
  setSession: (token: string, user: User) => void;
  clearSession: () => void;
  updateUser: (user: Partial<User>) => void;
  setHasCredentials: (has: boolean) => void;
  setCredentialsChecked: (checked: boolean) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      isAuthenticated: false,
      hasCredentials: false,
      credentialsChecked: false,

      setSession: (token, user) =>
        set({
          token,
          user,
          isAuthenticated: true,
          // Reset credentials check on new session
          credentialsChecked: false,
        }),

      clearSession: () =>
        set({
          token: null,
          user: null,
          isAuthenticated: false,
          hasCredentials: false,
          credentialsChecked: false,
        }),

      updateUser: (updates) =>
        set((state) => ({
          user: state.user ? { ...state.user, ...updates } : null,
        })),

      setHasCredentials: (has) =>
        set({
          hasCredentials: has,
          credentialsChecked: true,
        }),

      setCredentialsChecked: (checked) =>
        set({ credentialsChecked: checked }),
    }),
    {
      name: 'huldah-auth',
      partialize: (state) => ({
        token: state.token,
        user: state.user,
        isAuthenticated: state.isAuthenticated,
        // Don't persist credentials status - check on each session
      }),
    }
  )
);


