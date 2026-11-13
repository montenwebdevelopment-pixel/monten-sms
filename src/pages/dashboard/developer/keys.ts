export interface DevKey {
  id: string;
  name: string;
  key_prefix: string;
  environment: "test" | "production";
  active: boolean;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export interface DevWebhook {
  id: string;
  url: string;
  active: boolean;
  created_at: string;
}

export interface DevDelivery {
  id: string;
  webhook_id: string;
  event: string;
  status: "pending" | "delivered" | "failed";
  attempts: number;
  response_status: number | null;
  last_error: string | null;
  created_at: string;
  delivered_at: string | null;
}

export interface DevStats {
  totalRequests: number;
  successful: number;
  failed: number;
  phonePurchases: number;
  emailPurchases: number;
  totalSpent: number;
  walletBalance: number;
}

export interface DevTxn {
  order_ref: string;
  order_id: string | null;
  kind: "phone" | "email";
  amount: number | string;
  status: string;
  service: string | null;
  created_at: string;
}

export interface DevActivity {
  endpoint: string;
  method: string;
  status_code: number;
  response_ms: number | null;
  created_at: string;
}
