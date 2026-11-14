import { redactSensitiveText } from "../_shared/sensitive-text.mjs";

/**
 * @typedef {"identity" | "customer_name" | "email_otp_issue" | "otp_issue" | "deposit_issue" | "account_statement" | "spending_summary" | "profile_info" | "notifications" | "ticket_status" | "balance" | "order_lookup" | "number_issue" | "buy_number" | "email_purchase" | "pricing" | "regions" | "services" | "navigation" | "login_issue" | "password_issue" | "registration_issue" | "refund" | "payment_failed" | "complaint" | "how_it_works" | "safety_privacy" | "escalate" | "general"} SupportIntent
 * @typedef {{ role: "user" | "assistant", text: string }} Turn
 */

/** @param {string} message
 *  @returns {SupportIntent}
 */
export function supportIntent(message) {
  const m = message.toLowerCase().trim();
  if (/\b(?:what(?:'s| is) your name|who are you|are you (?:a bot|an? ai|human)|are you real)\b/i.test(m)) return "identity";
  if (/\b(?:what(?:'s| is) my name|do you know my name|what should you call me|who am i)\b/i.test(m)) return "customer_name";
  if (/\b(?:how (?:do i|can i|to) fund|where (?:do i|can i) fund)\b.{0,30}\bwallet\b/i.test(m)) return "navigation";
  if (/\bemail\b.*\b(?:otp|code|verification|not received|haven't received|didn't receive|missing|waiting)\b|\b(?:otp|code)\b.*\bemail\b/i.test(m)) return "email_otp_issue";
  if (/\b(?:haven't|have not|didn't|did not|not)\s+(?:received|receive|got|gotten|get).{0,40}\b(?:otp|code|sms)\b|\b(?:otp|code|sms)\b.{0,40}\b(?:not received|not arrived|missing|delayed|still waiting|haven't|didn't)\b|\bno (?:otp|code|sms)\b/i.test(m)) return "otp_issue";
  if (/\b(?:charged|paid)\b.{0,40}\b(?:no|not|didn't|did not)\b.{0,20}\b(?:number|order|otp)\b/i.test(m)) return "number_issue";
  if (/\b(?:deposit|deposited)\b.{0,40}\b(?:not credited|missing|failed|not received|didn't|did not|pending)\b|\bwallet\b.{0,40}\b(?:not credited|not updated|missing|zero|didn't|did not|pending)\b|\bpayment\b.{0,40}\b(?:wallet|deposit|credit)\b|\bcredited\b.{0,20}\bwallet\b/i.test(m)) return "deposit_issue";
  if (/\b(?:angry|annoying|annoyed|frustrated|upset|ridiculous|unacceptable|fed up|terrible|worst)\b/i.test(m)) return "complaint";
  if (/\b(?:otp|sms|verification code)\b.{0,40}\b(?:not|missing|delay|late|waiting)\b|\b(?:number|order)\b.{0,40}\b(?:delay|delayed|late|not arrived|not assigned|failed|expired|not working)\b/i.test(m)) return "number_issue";
  if (/\b(?:statement|transaction history|transaction list|my transactions|recent transactions|all my transactions|show me my transactions|what have i (?:done|bought|spent)|history)\b/i.test(m)) return "account_statement";
  if (/\b(?:spending|spent|total spent|money spent|how much have i (?:spent|used)|spending summary|spending history)\b/i.test(m)) return "spending_summary";
  if (/\b(?:my profile|my account (?:details|info)|profile (?:info|details)|my username|account (?:overview|summary|info)|tell me about my (?:account|profile))\b/i.test(m)) return "profile_info";
  if (/\b(?:notification|notifications|unread|alerts|any (?:new )?notifications|check.*notifications)\b/i.test(m)) return "notifications";
  if (/\b(?:my (?:ticket|tickets|case|cases)|ticket status|case status|support (?:ticket|case)|check.*(?:ticket|case)|my support|open (?:ticket|case))\b/i.test(m)) return "ticket_status";
  if (/\b(?:balance|wallet|how much (?:money|funds)|current (?:balance|wallet)|my (?:balance|wallet|funds))\b/i.test(m)) return "balance";
  if (/\b(?:check|look up|track|status of|where is|how is).{0,30}\border\b|\border\b.{0,30}\b(?:check|status|track|delayed|late)\b/i.test(m)) return "order_lookup";
  if (/\b(?:my (?:number|numbers|order|orders)|number|order).{0,40}\b(?:fail|cancel|expired|not work|broken|dead|inactive|list|show|what|delay|delayed|late)\b|\b(?:expired|not working number|show.*number|list.*number)\b/i.test(m)) return "number_issue";
  if (/\b(?:how.*buy|how.*get|buy.*number|purchase.*number|new number|order number)\b/i.test(m)) return "buy_number";
  if (/\b(?:buy|purchase|rent|get).{0,30}\bemail\b|\bemail\b.{0,30}\b(?:buy|purchase|rent)\b|\bemail otp service\b/i.test(m)) return "email_purchase";
  if (/\b(?:pricing|how much.{0,30}(?:cost|number|otp|sms)|cost of|price of|fees?|charges?|expensive|cheap|afford)\b/i.test(m)) return "pricing";
  if (/\b(?:country|countries|supported|available (?:countries|services))\b/i.test(m)) return "regions";
  if (/\b(?:what|which)\b.{0,50}\b(?:services?|products?)\b|\bwhat does monten(?: sms)? offer\b/i.test(m)) return "services";
  if (/\b(?:where (?:do i|can i) (?:find|go)|where is|how do i get to|open the)\b.{0,50}\b(?:wallet|profile|transaction|number|email|notification|setting|developer)\b/i.test(m)) return "navigation";
  if (/\b(?:login|sign in|signin|can't log|cannot log|locked out)\b/i.test(m)) return "login_issue";
  if (/\b(?:password|reset password|forgot password|change password|recover)\b/i.test(m)) return "password_issue";
  if (/\b(?:register|sign ?up|signup|create account|verify email|verification (?:code|email|otp)|email (?:verification|verified))\b/i.test(m)) return "registration_issue";
  if (/\b(?:refund|money back|reimburse|chargeback|wrong charge|overcharg)\b/i.test(m)) return "refund";
  if (/\b(?:payment|card|flutterwave|transaction)\b.{0,30}\b(?:fail|declin|reject|error)\b|\b(?:payment fail|payment issue|payment error|payment declined|card declined)\b/i.test(m)) return "payment_failed";
  if (/\b(?:ticket|case|reference number|escalat|human|agent|talk to (?:someone|human|support))\b/i.test(m)) return "escalate";
  if (/\b(?:how.*(?:work|use)|getting started|guide|tutorial|what.*monten|what is monten|how.*sms|how.*otp|how.*virtual)\b/i.test(m)) return "how_it_works";
  if (/\b(?:safe|secure|security|privacy|private|trust|legit|scam|legitimate|reliable|data (?:safe|secure|protected))\b/i.test(m)) return "safety_privacy";
  return "general";
}

/** @param {string} message */
export function isFollowUp(message) {
  const m = message.toLowerCase().trim();
  return /^(?:yes|yeah|yep|yup|sure|ok|okay|please do|go ahead|do it|escalate it|yes please|check it|check again)\b/i.test(m) ||
    (/\b(?:it|that|this|they|them)\b/i.test(m) && m.length < 80 && !/\b(?:deposit|wallet|balance|number|otp|payment|refund|ticket|case|transaction|price|fee)\b/i.test(m));
}

/**
 * @param {string} message
 * @param {Turn[]} history
 * @returns {SupportIntent}
 */
export function resolveSupportIntent(message, history) {
  const intent = supportIntent(message);
  if (intent !== "general" || history.length === 0) return intent;

  const lastAssistant = [...history].reverse().find((turn) => turn.role === "assistant")?.text ?? "";
  const awaitingOrderDetails = /(?:share|send|provide).{0,30}(?:order reference|phone number|service and country)/i.test(lastAssistant);
  const awaitingPaymentDetails = /(?:share|send|provide).{0,40}(?:transaction id|transaction reference|amount.*payment)/i.test(lastAssistant);
  if (!isFollowUp(message) && !awaitingOrderDetails && !awaitingPaymentDetails) return intent;

  if (/escalate|support case|create a support case/i.test(lastAssistant)) return "escalate";
  if (/email/i.test(lastAssistant) && /otp|order|reference/i.test(lastAssistant)) return "email_otp_issue";
  if (/otp|sms|number|order/i.test(lastAssistant)) return "otp_issue";
  if (/pending|wallet|deposit/i.test(lastAssistant)) return "deposit_issue";
  if (/balance/i.test(lastAssistant)) return "balance";
  if (/ticket|case/i.test(lastAssistant)) return "ticket_status";
  if (/transaction/i.test(lastAssistant)) return "account_statement";
  if (awaitingPaymentDetails) return "deposit_issue";
  if (awaitingOrderDetails) return "order_lookup";
  return intent;
}

/**
 * @param {string} message
 * @param {Turn[]} history
 * @returns {string | null}
 */
export function extractTransactionId(message, history = []) {
  const labeled = message.match(/\b(?:flutterwave\s+)?(?:transaction|txn|tx)(?:\s+(?:id|ref(?:erence)?|number))?\s*[:#-]?\s*(\d{6,})\b|\b(?:id|reference|ref)\s*[:#-]\s*(\d{6,})\b/i);
  if (labeled) return labeled[1] ?? labeled[2];

  const bareId = message.match(/^\s*(\d{6,})\s*$/);
  if (!bareId) return null;
  const lastAssistant = [...history].reverse().find((turn) => turn.role === "assistant")?.text ?? "";
  return /(?:flutterwave|transaction|txn|payment).{0,40}(?:id|reference|ref|number)|(?:id|reference|ref|number).{0,40}(?:flutterwave|transaction|txn|payment)/i.test(lastAssistant)
    ? bareId[1]
    : null;
}

/** @param {string | null | undefined} fullName */
export function customerNameReply(fullName) {
  const name = typeof fullName === "string" ? fullName.trim() : "";
  return name ? `Your name is ${name}.` : "I don't see a name on your profile yet. What would you like me to call you?";
}

export function identityReply() {
  return "I'm Monten SMS AI Support. I'm here to help with your orders, OTP verification, wallet, payments, and other questions. How can I help you today?";
}

export function buyNumberReply() {
  return "To buy a virtual number, open Buy Numbers from your dashboard, select a country and service, review the currently available offers, and confirm the one you want. Your order and any received OTP will appear on Purchased Numbers.";
}

export function pricingReply() {
  return "Number prices vary by country, service, and current provider availability. Open Buy Numbers, choose a country and service, and the page will show the current offers and prices before you confirm. Which country or service are you interested in?";
}

export function servicesReply() {
  return "MONTEN SMS offers temporary phone numbers for SMS verification and email rentals for email OTP verification. Available countries, services, and offers are shown live in Buy Numbers and Email Purchase.";
}

export function complaintOpening() {
  return "I'm really sorry this is taking longer than expected. I understand how frustrating that is.";
}

export function aiUnavailableReply() {
  return "I'm sorry, I couldn't reach the AI service just now, so I don't want to guess at your question. Please try again in a moment, or contact our human support team if you need help urgently.";
}

/** @param {Record<string, unknown>} order */
export function otpOrderReply(order) {
  const reference = typeof order.id === "string" ? order.id.slice(0, 8) : "";
  const orderLabel = reference ? `Order ${reference}` : "Your order";
  const service = typeof order.service_name === "string" && order.service_name ? order.service_name : "your service";
  const country = typeof order.country_name === "string" && order.country_name ? ` in ${order.country_name}` : "";
  const assigned = order.phone_number ? "A number has been assigned." : "The provider has not assigned a number yet.";
  const status = String(order.status ?? "unknown").toLowerCase();

  if (status === "waiting") {
    return `I'm sorry your OTP hasn't arrived yet. I checked ${orderLabel} for ${service}${country}; its current status is waiting for SMS. ${assigned} No OTP is recorded yet. You can tap “Check SMS” on your Purchased Numbers page to refresh the order.`;
  }
  if (status === "received" || order.sms_code) {
    return `I checked ${orderLabel} for ${service}${country}; the order is marked as received. The OTP is available on your Purchased Numbers page. For security, I won't repeat the code in chat.`;
  }
  if (status === "failed" || status === "canceled") {
    const reason = typeof order.failure_reason === "string" && order.failure_reason.trim()
      ? ` The provider recorded: ${order.failure_reason.trim().slice(0, 64)}.`
      : "";
    return `I checked ${orderLabel} for ${service}${country}; it ended with status “${status}”.${reason} Please check Transaction History for any refund, or share the order reference if you'd like me to help escalate it.`;
  }
  return `I checked ${orderLabel} for ${service}${country}; its current status is “${status}”. ${assigned} Please check Purchased Numbers for the latest update.`;
}

export function missingOtpOrderReply() {
  return "I'm sorry your OTP hasn't arrived yet. I don't see a matching active number order in your account. Could you share the order reference, phone number, or the service and country so I can check the right order?";
}

/** @param {number} count */
export function ambiguousOtpOrdersReply(count) {
  return `I'm sorry the OTP is delayed. I found ${count} active number orders waiting for SMS. Which one should I check? Please share the phone number or the service and country shown on Purchased Numbers.`;
}

/** @param {Array<Record<string, unknown>>} orders */
export function orderLookupReply(orders) {
  if (orders.length === 0) {
    return "I couldn't find a number order in your account. Please check the reference on Purchased Numbers, or send me the phone number or service and country so I can look again.";
  }
  const lines = orders.slice(0, 5).map((order) => {
    const ref = typeof order.id === "string" ? order.id.slice(0, 8) : "order";
    const service = typeof order.service_name === "string" && order.service_name ? order.service_name : "service unavailable";
    const country = typeof order.country_name === "string" && order.country_name ? ` in ${order.country_name}` : "";
    const assigned = order.phone_number ? "number assigned" : "no number assigned";
    return `${ref} — ${service}${country}: ${String(order.status ?? "unknown")} (${assigned})`;
  });
  return `I checked your recent number orders:\n${lines.join("\n")}\n\nIf you mean a different order, send its phone number or reference and I'll check that one.`;
}

/** @param {{ amount?: number | null, reference?: string | null, txId?: string | null }} details */
export function missingDepositReply(details = {}) {
  const amount = details.amount ? ` for NGN ${details.amount.toLocaleString("en-NG")}` : "";
  const reference = details.reference || details.txId;
  const followup = reference
    ? ` I couldn't match reference ${reference} to a wallet deposit. Please confirm the amount and approximate payment time.`
    : " Could you share the amount, approximate payment time, or Flutterwave transaction ID so I can check the exact payment?";
  return `I'm sorry your wallet hasn't been credited. I checked your account's deposit records${amount}, but couldn't find a matching wallet credit.${followup} I won't mark the payment successful unless I can verify it.`;
}

/**
 * @param {Turn[] | null} storedTurns
 * @param {string} latestMessage
 * @returns {Turn[]}
 */
export function buildModelTurns(storedTurns, latestMessage) {
  const prior = storedTurns ?? [];
  const turns = prior.slice(-24).map((turn) => ({
    role: turn.role,
    text: redactSensitiveText(turn.text),
  }));
  const last = turns[turns.length - 1];
  if (last?.role === "user" && last.text.trim() === redactSensitiveText(latestMessage).trim()) {
    turns.pop();
  }
  turns.push({ role: "user", text: redactSensitiveText(latestMessage) });
  return turns;
}
