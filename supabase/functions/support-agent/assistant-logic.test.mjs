import assert from "node:assert/strict";
import test from "node:test";
import {
  aiUnavailableReply,
  ambiguousOtpOrdersReply,
  buyNumberReply,
  buildModelTurns,
  complaintOpening,
  customerNameReply,
  extractTransactionId,
  identityReply,
  missingDepositReply,
  missingOtpOrderReply,
  orderLookupReply,
  otpOrderReply,
  pricingReply,
  resolveSupportIntent,
  servicesReply,
  supportIntent,
} from "./assistant-logic.mjs";
import { redactSensitiveText } from "../_shared/sensitive-text.mjs";

const questions = [
  ["What is your name?", "identity"],
  ["Who are you?", "identity"],
  ["What is my name?", "customer_name"],
  ["I haven't received my OTP yet.", "otp_issue"],
  ["My payment was successful but my wallet has not been credited.", "deposit_issue"],
  ["How do I buy a phone number?", "buy_number"],
  ["How much does a number cost?", "pricing"],
  ["I'm angry because my order is delayed.", "complaint"],
  ["Can you check my order?", "order_lookup"],
  ["What services does Monten SMS offer?", "services"],
  ["How do I fund my wallet?", "navigation"],
];

for (const [question, expectedIntent] of questions) {
  test(`${question} routes to ${expectedIntent}`, () => {
    assert.equal(supportIntent(question), expectedIntent);
  });
}

test("identity and profile-name replies are direct and never invent a name", () => {
  assert.match(identityReply(), /Monten SMS AI Support/);
  assert.equal(customerNameReply("Amina Ade"), "Your name is Amina Ade.");
  assert.match(customerNameReply(null), /What would you like me to call you/);
});

test("the other tested questions receive topic-specific fallback replies", () => {
  assert.match(missingDepositReply({ amount: 1500 }), /wallet hasn't been credited/);
  assert.match(buyNumberReply(), /Buy Numbers/);
  assert.match(pricingReply(), /prices vary by country, service/);
  assert.match(`${complaintOpening()} ${orderLookupReply([])}`, /sorry.*frustrating.*couldn't find a number order/i);
  assert.match(orderLookupReply([{ id: "12345678", service_name: "Telegram", status: "waiting" }]), /Telegram: waiting/);
  assert.match(servicesReply(), /phone numbers.*email rentals/i);
  assert.match(aiUnavailableReply(), /couldn't reach the AI service/);
});

test("OTP responses use the order status and never disclose its code", () => {
  const reply = otpOrderReply({
    id: "12345678-abcd",
    status: "waiting",
    service_name: "WhatsApp",
    country_name: "Ghana",
    phone_number: "+233000000000",
    sms_code: null,
  });
  assert.match(reply, /waiting for SMS/);
  assert.match(reply, /number has been assigned/);
  assert.doesNotMatch(reply, /\+233000000000/);
  assert.match(reply, /waiting for SMS/);
  assert.match(missingOtpOrderReply(), /share the order reference/);
  assert.match(ambiguousOtpOrdersReply(2), /2 active number orders/);
  assert.match(otpOrderReply({ id: "order-id", status: "received", sms_code: "654321" }), /won't repeat the code/);
});

test("payment and order lookups state only records actually supplied to the response formatter", () => {
  assert.match(missingDepositReply({ amount: 1500 }), /couldn't find a matching wallet credit/);
  assert.match(missingDepositReply({ txId: "12345678" }), /couldn't match reference 12345678/);
  assert.match(orderLookupReply([]), /couldn't find a number order/);
  assert.match(orderLookupReply([{ id: "12345678", service_name: "Telegram", status: "waiting" }]), /Telegram: waiting/);
});

test("model turns keep roles and latest user message in chronological order", () => {
  const turns = buildModelTurns(
    [{ role: "user", text: "My order is delayed." }, { role: "assistant", text: "I can check it." }],
    "Can you check my order?",
  );
  assert.deepEqual(turns.map((turn) => turn.role), ["user", "assistant", "user"]);
  assert.equal(turns.at(-1).text, "Can you check my order?");
});

test("OTP codes are redacted before conversation history reaches Gemini", () => {
  const turns = buildModelTurns(null, "My verification code is 654321");
  assert.match(turns.at(-1).text, /\[redacted\]/);
  assert.doesNotMatch(turns.at(-1).text, /654321/);
});

test("sensitive values are redacted before support history is stored or displayed", () => {
  const safe = redactSensitiveText("OTP: 654321; password is hunter2; CVV: 123; card number 4111 1111 1111 1111; API key: sk-test");
  assert.doesNotMatch(safe, /654321|hunter2|123|4111|sk-test/);
  assert.match(safe, /password \[redacted\]/);
  assert.match(safe, /\[redacted card number\]/);
});

test("follow-up questions inherit the prior order context", () => {
  assert.equal(supportIntent("How long will it take?"), "general");
  assert.equal(resolveSupportIntent("How long will it take?", [
    { role: "user", text: "I haven't received my OTP." },
    { role: "assistant", text: "I checked your order. Its status is waiting for SMS." },
  ]), "otp_issue");
  assert.equal(resolveSupportIntent("ABCD-1234", [
    { role: "assistant", text: missingOtpOrderReply() },
  ]), "otp_issue");
  assert.equal(resolveSupportIntent("I paid just now", [
    { role: "assistant", text: missingDepositReply({}) },
  ]), "deposit_issue");
  const turns = buildModelTurns(
    [{ role: "user", text: "I haven't received my OTP." }, { role: "assistant", text: "I can check your order." }],
    "How long will it take?",
  );
  assert.equal(turns[0].text, "I haven't received my OTP.");
  assert.equal(turns.at(-1).text, "How long will it take?");
});

test("payment amounts are not mistaken for transaction IDs", () => {
  assert.equal(extractTransactionId("I deposited 120000 but my wallet is still empty."), null);
  assert.equal(extractTransactionId("Flutterwave transaction ID: 12345678"), "12345678");
  assert.equal(extractTransactionId("12345678", [
    { role: "assistant", text: "Please share your Flutterwave transaction ID." },
  ]), "12345678");
  assert.equal(extractTransactionId("12345678", [
    { role: "assistant", text: "I found your recent deposit. Does that match the payment?" },
  ]), null);
});
