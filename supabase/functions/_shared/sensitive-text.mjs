export function redactSensitiveText(text) {
  return text
    .replace(/\b(otp|sms(?:\s+verification)?|verification(?:\s+code)?|one[-\s]?time(?:\s+password)?|code)\b(?:[^\d]{0,40})\d{4,8}\b/gi, "$1 [redacted]")
    .replace(/\b(password|passcode|pin|secret|api key|access token|refresh token|bank account|account number)\s*(?:is|:|=)\s*[^\s,;]+/gi, "$1 [redacted]")
    .replace(/\b(?:cvv|cvc|security code)\s*(?:is|:|=)?\s*\d{3,4}\b/gi, "[redacted security code]")
    .replace(/\b(?:credit card|debit card|card number)\s*(?:is|:|=)?\s*(?:\d[ -]?){13,19}\b/gi, "[redacted card number]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
    .replace(/\b(?:AIza[0-9A-Za-z_-]{20,}|sk-[A-Za-z0-9_-]{20,})\b/g, "[redacted API key]");
}
