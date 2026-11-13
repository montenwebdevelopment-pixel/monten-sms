import { supabase, EDGE_FUNCTION_BASE } from "./supabase";
import type { Country, Offer, Service } from "../types";

export interface PurchaseNumberRequest {
  country: string;
  service: string;
  operator: string;
}

export interface PurchaseNumberResult {
  id: string;
  phone: string;
  operator: string;
  purchasedId?: string;
  expiresAt?: string | number;
}

export interface SmsCheckResult {
  status: "waiting" | "received" | "canceled" | "failed";
  smsCode?: string | null;
  expiresAt?: number;
}

export class VerificationApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "VerificationApiError";
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  requiresAuth = true,
): Promise<T> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new VerificationApiError("Unable to verify your session.", 0);

  const headers = new Headers(options.headers);
  headers.set("apikey", import.meta.env.VITE_SUPABASE_ANON_KEY);
  if (data.session?.access_token) {
    headers.set("Authorization", `Bearer ${data.session.access_token}`);
  } else if (requiresAuth) {
    throw new VerificationApiError("Your session has expired. Please sign in again.", 401);
  }
  if (options.body) headers.set("Content-Type", "application/json");

  let response: Response;
  try {
    response = await fetch(`${EDGE_FUNCTION_BASE}/fivesim-proxy/${path}`, { ...options, headers });
  } catch {
    throw new VerificationApiError("Unable to reach the verification service.", 0);
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof payload === "object" &&
      payload !== null &&
      "error" in payload &&
      typeof payload.error === "string"
        ? payload.error
        : "The verification service request failed.";
    throw new VerificationApiError(message, response.status);
  }
  if (payload === null) {
    throw new VerificationApiError("The verification service returned an invalid response.", response.status);
  }
  return payload as T;
}

export const verificationApi = {
  async getCountries(): Promise<Country[]> {
    const result = await request<{ countries: Country[] }>("countries", {}, false);
    return result.countries;
  },

  async getServices(country: string): Promise<Service[]> {
    const result = await request<{ services: Service[] }>(`services/${encodeURIComponent(country)}`);
    return result.services;
  },

  async getOffers(country: string, service: string): Promise<Offer[]> {
    const result = await request<{ offers: Offer[] }>(
      `offers/${encodeURIComponent(country)}/${encodeURIComponent(service)}`,
    );
    return result.offers;
  },

  purchaseNumber(input: PurchaseNumberRequest): Promise<PurchaseNumberResult> {
    return request<PurchaseNumberResult>("purchase", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  checkSms(id: string): Promise<SmsCheckResult> {
    return request<SmsCheckResult>(`sms/${encodeURIComponent(id)}`);
  },

  async cancelNumber(id: string): Promise<void> {
    await request<unknown>(`cancel/${encodeURIComponent(id)}`, { method: "POST" });
  },
};
