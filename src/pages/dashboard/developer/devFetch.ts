import { supabase, EDGE_FUNCTION_BASE } from "../../../lib/supabase";

export const DEV_API_BASE = `${EDGE_FUNCTION_BASE}/developer-api`;

export async function devFetch<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? "";
  const res = await fetch(`${DEV_API_BASE}/${path}`, {
    ...init,
    method: init?.method ?? (init?.json !== undefined ? "POST" : "GET"),
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      ...(init?.headers as Record<string, string> | undefined),
    },
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as T;
}

export async function copyText(text: string): Promise<boolean> {
  let el: HTMLTextAreaElement | null = null;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    el = document.createElement("textarea");
    el.value = text;
    document.body.appendChild(el);
    el.select();
    try {
      document.execCommand("copy");
      return true;
    } catch {
      return false;
    }
  } finally {
    el?.remove();
  }
}
