import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const SITE_URL = "https://montensms.com";

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

export const EDGE_FUNCTION_BASE = `${supabaseUrl}/functions/v1`;

export type EmailFunctionResult = { ok: true } | { ok: false; status: number; error: string; code?: string };

export async function callEmailFunction(payload: Record<string, unknown>): Promise<EmailFunctionResult> {
  try {
    const res = await fetch(`${EDGE_FUNCTION_BASE}/send-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${supabaseAnonKey}` },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body?.success) return { ok: true };
    return {
      ok: false,
      status: res.status,
      error: typeof body?.error === "string" ? body.error : "Something went wrong. Please try again shortly.",
      code: typeof body?.code === "string" ? body.code : undefined,
    };
  } catch {
    return { ok: false, status: 0, error: "We couldn't reach the server. Check your connection and try again." };
  }
}
