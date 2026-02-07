import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { request } from "@/lib/api";
import { clearTokens, getAccessToken, getRefreshToken, setTokens } from "@/lib/auth-tokens";

export type User = {
  id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  created_at?: string | null;
};

type AuthContextValue = {
  user: User | null;
  isAuthed: boolean;
  authLoading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName?: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshSession: () => Promise<void>;
  updateProfile: (updates: {
    display_name?: string;
    avatar_url?: string;
    password_current?: string;
    password_new?: string;
  }) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  const isAuthed = !!user;

  const refreshSession = async () => {
    const accessToken = await getAccessToken();
    const refreshToken = await getRefreshToken();
    if (!accessToken && !refreshToken) {
      await clearTokens();
      setUser(null);
      return;
    }
    try {
      const data = await request<{ user: User }>("/api/me");
      setUser(data.user);
    } catch {
      await clearTokens();
      setUser(null);
    }
  };

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        await refreshSession();
      } finally {
        if (active) setAuthLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    const data = await request<{ access_token: string; refresh_token: string; user: User }>(
      "/api/auth/login",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
        timeoutMs: 12000,
      }
    );
    await setTokens(data.access_token, data.refresh_token);
    setUser(data.user);
  };

  const signUp = async (email: string, password: string, displayName?: string) => {
    const payload: { email: string; password: string; display_name?: string } = { email, password };
    if (displayName) payload.display_name = displayName;
    const data = await request<{ access_token: string; refresh_token: string; user: User }>(
      "/api/auth/register",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        timeoutMs: 12000,
      }
    );
    await setTokens(data.access_token, data.refresh_token);
    setUser(data.user);
  };

  const signOut = async () => {
    const refreshToken = await getRefreshToken();
    try {
      if (refreshToken) {
        await request("/api/auth/logout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: refreshToken }),
          timeoutMs: 8000,
        });
      }
    } finally {
      await clearTokens();
      setUser(null);
    }
  };

  const updateProfile = async (updates: {
    display_name?: string;
    avatar_url?: string;
    password_current?: string;
    password_new?: string;
  }) => {
    const data = await request<{ user: User }>("/api/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
      timeoutMs: 12000,
    });
    setUser(data.user);
  };

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAuthed,
      authLoading,
      signIn,
      signUp,
      signOut,
      refreshSession,
      updateProfile,
    }),
    [user, isAuthed, authLoading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
