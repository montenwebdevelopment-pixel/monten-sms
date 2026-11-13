import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "../lib/supabase";
import type { Session } from "@supabase/supabase-js";

const ADMIN_EMAIL = "montensms@gmail.com";

interface AdminSession {
  email: string;
  userId: string;
}

interface AdminAuthValue {
  admin: AdminSession | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AdminAuthContext = createContext<AdminAuthValue>({
  admin: null,
  loading: true,
  signIn: async () => ({ error: "not ready" }),
  signOut: async () => {},
});

async function verifyAdmin(activeSession?: Session | null): Promise<AdminSession | null> {
  try {
    let session = activeSession;
    if (session === undefined) {
      const { data, error } = await supabase.auth.getSession();
      if (error) {
        console.error("[admin-auth] Could not restore the admin session.", error);
        return null;
      }
      session = data.session;
    }
    if (!session || !session.access_token) return null;
    const token = session.access_token;
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-api/settings`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
    });
    if (!res.ok) return null;
    const user = session.user;
    if (!user || (user.email ?? "").toLowerCase() !== ADMIN_EMAIL) return null;
    return { email: user.email ?? "", userId: user.id };
  } catch {
    console.error("[admin-auth] Server-side admin verification could not be reached.");
    return null;
  }
}

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<AdminSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    void verifyAdmin().then((verified) => {
      if (!mounted) return;
      setAdmin(verified);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      void verifyAdmin(session).then((verified) => {
        if (mounted) setAdmin(verified);
      });
    });
    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    const clean = email.trim().toLowerCase();
    if (clean !== ADMIN_EMAIL) return { error: "This portal is restricted to the authorized administrator." };
    const { error } = await supabase.auth.signInWithPassword({ email: clean, password });
    if (error) return { error: "Incorrect email or password." };
    const verified = await verifyAdmin();
    if (!verified) {
      await supabase.auth.signOut();
      return { error: "Admin verification failed. Please contact support." };
    }
    setAdmin(verified);
    return { error: null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setAdmin(null);
  };

  return (
    <AdminAuthContext.Provider value={{ admin, loading, signIn, signOut }}>
      {children}
    </AdminAuthContext.Provider>
  );
}

export function useAdminAuth() {
  return useContext(AdminAuthContext);
}
