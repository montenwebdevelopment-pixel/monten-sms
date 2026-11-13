import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { recordSecurityEvent, unregisterCurrentPushDevice } from "../lib/native";
import type { Profile } from "../types";

interface AuthContextType {
  session: any;
  profile: Profile | null;
  loading: boolean;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<any>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshProfile = useCallback(async () => {
    if (!session?.user?.id) return;
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", session.user.id)
      .maybeSingle();
    if (error) {
      console.error("Failed to refresh the user profile.", error);
      return;
    }
    if (data) setProfile(data as Profile);
  }, [session]);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (!mounted) return;
      if (error) console.error("Failed to restore the authentication session.", error);
      setSession(session);
      if (!session || error) setLoading(false);
    }).catch((error: unknown) => {
      console.error("Failed to restore the authentication session.", error);
      if (mounted) setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      setSession(session);
      if (!session) {
        setProfile(null);
        setLoading(false);
      } else if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        if (event === "SIGNED_IN") {
          setTimeout(() => {
            void recordSecurityEvent("login").catch((error: unknown) => {
              console.error("Failed to record the account login alert.", error);
            });
          }, 0);
        }
        (async () => {
          try {
            const { data, error } = await supabase
              .from("profiles")
              .select("*")
              .eq("id", session.user.id)
              .maybeSingle();
            if (error) {
              console.error("Failed to load the user profile.", error);
            } else if (mounted && data) {
              setProfile(data as Profile);
            }
          } catch (error) {
            console.error("Failed to load the user profile.", error);
          } finally {
            if (mounted) setLoading(false);
          }
        })();
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
