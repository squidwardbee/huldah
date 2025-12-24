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
  
  // Actions
  setSession: (token: string, user: User) => void;
  clearSession: () => void;
  updateUser: (user: Partial<User>) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      isAuthenticated: false,

      setSession: (token, user) =>
        set({
          token,
          user,
          isAuthenticated: true,
        }),

      clearSession: () =>
        set({
          token: null,
          user: null,
          isAuthenticated: false,
        }),

      updateUser: (updates) =>
        set((state) => ({
          user: state.user ? { ...state.user, ...updates } : null,
        })),
    }),
    {
      name: 'huldah-auth',
      partialize: (state) => ({
        token: state.token,
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);

