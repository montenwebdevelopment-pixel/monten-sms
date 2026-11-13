export interface Profile {
  id: string;
  full_name: string;
  username: string;
  wallet_balance: number;
  email_verified: boolean;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface Transaction {
  id: string;
  user_id: string;
  type: "deposit" | "purchase" | "refund";
  amount: number;
  status: "pending" | "completed" | "failed";
  reference: string | null;
  description: string | null;
  created_at: string;
}

export interface PurchasedNumber {
  id: string;
  user_id: string;
  fivesim_id: string | null;
  phone_number: string | null;
  country_code: string | null;
  country_name: string | null;
  service_name: string | null;
  operator_name: string | null;
  cost_price: number | null;
  selling_price: number | null;
  status: "waiting" | "received" | "canceled" | "failed";
  sms_text: string | null;
  sms_code: string | null;
  created_at: string;
  updated_at: string;
}

export interface Notification {
  id: string;
  user_id: string;
  type: string;
  title: string;
  message: string | null;
  read: boolean;
  created_at: string;
}

export interface Country {
  code: string;
  name: string;
}

export interface Service {
  code: string;
  name: string;
}

export interface Offer {
  operator: string;
  stock: number;
  price: number;
  rate: number;
}
