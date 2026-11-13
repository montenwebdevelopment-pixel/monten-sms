export type AccountStatus = "active" | "suspended";

export interface DeveloperDefaults {
  rate_limit_per_min: number;
  phone_margin_naira: number;
  email_price_naira: number;
  enabled: boolean;
}

export interface DeveloperRow {
  user_id: string;
  email: string;
  full_name: string;
  username: string;
  registered_at: string | null;
  account_status: AccountStatus;
  rate_limit_per_min: number | null;
  phone_margin_naira: number | null;
  email_price_naira: number | null;
  keys_total: number;
  keys_active: number;
  webhooks_active: number;
  api_requests: number;
  api_success: number;
  api_failed: number;
  phone_success: number;
  phone_pending: number;
  phone_failed: number;
  phone_cancelled: number;
  email_success: number;
  email_pending: number;
  email_failed: number;
  email_cancelled: number;
  successful_otp_orders: number;
  spent_success: number;
  spent_pending: number;
  last_api_at: string | null;
  last_order_at: string | null;
  last_login_at: string | null;
}

export interface DeveloperListResponse {
  developers: DeveloperRow[];
  defaults: DeveloperDefaults;
}

export interface OrderRow {
  id: string;
  order_ref: string;
  kind: "phone" | "email";
  service: string;
  country: string | null;
  amount: number;
  status: string;
  created_at: string;
  phone: string | null;
  address: string | null;
  error: string | null;
}

export interface SeriesPoint {
  date: string;
  n: number;
}

export interface ApiDayPoint {
  date: string;
  requests: number;
  ok: number;
  failed: number;
}

export interface NameCount {
  name: string;
  count: number;
}

export interface EndpointRow {
  method: string;
  endpoint: string;
  requests: number;
  failed: number;
  last_at: string | null;
}

export interface ApiKeyRow {
  id: string;
  name: string;
  key_prefix: string;
  environment: string;
  active: boolean;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export interface WebhookRow {
  id: string;
  url: string;
  active: boolean;
  created_at: string;
}

export interface LedgerRow {
  id: string;
  type: string;
  amount: number;
  status: string;
  reference: string | null;
  description: string | null;
  created_at: string;
}

export interface TicketRow {
  id: string;
  case_ref: string | null;
  subject: string;
  category: string | null;
  status: string;
  priority: string | null;
  escalated: boolean;
  created_at: string;
  updated_at: string;
}

export interface DeveloperProfileResponse {
  developer: {
    user_id: string;
    email: string;
    full_name: string;
    username: string;
    registered_at: string | null;
    last_sign_in_at: string | null;
    last_login_at: string | null;
    last_api_at: string | null;
    account_status: AccountStatus;
    status_reason: string | null;
    status_updated_at: string | null;
    rate_limit_per_min: number | null;
    phone_margin_naira: number | null;
    email_price_naira: number | null;
  };
  defaults: DeveloperDefaults;
  summary: { keys_total: number; keys_active: number; webhooks_active: number };
  phone: {
    stats: { total: number; success: number; pending: number; failed: number; cancelled: number; spent_success: number; spent_pending: number };
    countries: NameCount[];
    services: NameCount[];
    history: OrderRow[];
  };
  email: {
    stats: { total: number; success: number; pending: number; failed: number; cancelled: number };
    history: OrderRow[];
  };
  api: {
    totals: { requests: number; ok: number; failed: number; last_at: string | null };
    endpoints: EndpointRow[];
    keys: ApiKeyRow[];
    webhooks: {
      endpoints: WebhookRow[];
      counts: { total: number; delivered: number; pending: number; failed: number };
    };
  };
  finance: {
    wallet_balance: number;
    deposits: { completed_amount: number; completed_count: number; pending_count: number; failed_count: number };
    api_charged: { amount: number; count: number };
    api_refunded: { amount: number; count: number };
    orders: { completed_amount: number; pending_amount: number; completed_count: number; pending_count: number; failed_count: number; cancelled_count: number };
    ledger: LedgerRow[];
  };
  charts: {
    numbersDaily: SeriesPoint[];
    numbersWeekly: SeriesPoint[];
    numbersMonthly: SeriesPoint[];
    spendDaily: SeriesPoint[];
    apiDaily: ApiDayPoint[];
  };
  support: TicketRow[];
  generated_at: string;
}
