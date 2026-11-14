import { createContext, useContext, useEffect, useState, useRef, ReactNode, useCallback } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { recordSecurityEvent, unregisterCurrentPushDevice } from "../lib/native";
import type { Profile } from "../types";

interface AuthContextType {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshProfile = useCallback(async () => {
    const userId = session?.user?.id;
    if (!userId) return;
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();
    if (error) {
      console.error("Failed to refresh the user profile.", error);
      return;
    }
    if (sessionRef.current?.user.id === userId) setProfile(data as Profile | null);
  }, [session]);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (!mounted) return;
      if (error) console.error("Failed to restore the authentication session.", error);
      sessionRef.current = session;
      setSession(session);
      if (!session || error) setLoading(false);
    }).catch((error: unknown) => {
      console.error("Failed to restore the authentication session.", error);
      if (mounted) setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      const previousUserId = sessionRef.current?.user.id;
      sessionRef.current = session;
      setSession(session);
      if (!session) {
        setProfile(null);
        setLoading(false);
      } else if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        if (previousUserId !== session.user.id) setProfile(null);
        if (event === "SIGNED_IN") {
          setLoading(true);
          setTimeout(() => {
            void recordSecurityEvent("login").catch((error: unknown) => {
              console.error("Failed to record the account login alert.", error);
            });
          }, 0);
        }
      }
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    if (session?.user?.id) {
      void refreshProfile()
        .catch((error: unknown) => console.error("Failed to refresh the user profile.", error))
        .finally(() => {
          if (mounted) setLoading(false);
        });
    }
    return () => { mounted = false; };
  }, [session, refreshProfile]);

  const signOut = async () => {
    try {
      await unregisterCurrentPushDevice();
    } catch (error) {
      console.error("Failed to unregister push devices before sign out.", error);
    }
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    sessionRef.current = null;
    setProfile(null);
    setSession(null);
  };

  return (
    <AuthContext.Provider value={{ session, profile, loading, refreshProfile, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
