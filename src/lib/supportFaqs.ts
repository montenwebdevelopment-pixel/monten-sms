// MONTEN SMS Support FAQ Knowledge Base
// To add or update FAQs, edit the array below. Each entry has:
// - keywords: words/phrases that trigger this answer (matched against the user's message)
// - question: the short label shown as a quick-reply button
// - answer: the full response shown in the chat

export interface FaqEntry {
  id: string;
  keywords: string[];
  question: string;
  answer: string;
}

export const faqEntries: FaqEntry[] = [
  {
    id: "buy-number",
    keywords: ["buy", "purchase", "get number", "how to buy", "order number", "rent number", "new number"],
    question: "How to buy a virtual number",
    answer:
      "To buy a virtual number:\n1. Go to 'Buy Numbers' from your dashboard.\n2. Select a country from the list.\n3. Search for the service you need (e.g. WhatsApp, Telegram, Gmail).\n4. Browse the available offers and pick one that fits your budget.\n5. Click 'Buy' and the number is instantly added to your 'Purchased Numbers' page.\n\nMake sure your wallet has enough balance before purchasing.",
  },
  {
    id: "receive-sms",
    keywords: ["receive sms", "receive otp", "get otp", "get code", "how to receive", "sms code", "verification code"],
    question: "How to receive SMS/OTP",
    answer:
      "Once you buy a number, SMS codes arrive automatically:\n1. Go to 'Purchased Numbers' from your dashboard.\n2. Find the number you purchased.\n3. The status shows 'Waiting' until an SMS arrives.\n4. When an SMS is received, the OTP code appears next to the number.\n5. You can also click 'Check SMS' to manually refresh the status.\n6. Copy the code and use it on the service you're verifying.",
  },
  {
    id: "otp-not-received",
    keywords: ["otp not received", "no otp", "didn't receive", "no code", "no sms", "never received", "not received", "haven't received", "didnt get"],
    question: "OTP not received",
    answer:
      "If your OTP hasn't arrived:\n1. Wait a few minutes — some services take longer to send codes.\n2. Click 'Check SMS' on your purchased number to manually refresh.\n3. Make sure you used the correct number on the service you're verifying.\n4. Check that the number status is still 'Waiting' — if it shows 'Expired' or 'Canceled', you'll need a new number.\n5. Some services block virtual numbers. Try a different country or service offer.\n\nIf it still doesn't work after 5-10 minutes, contact human support.",
  },
  {
    id: "number-expired",
    keywords: ["expired", "not working", "broken", "dead", "stopped working", "number expired", "inactive"],
    question: "Number expired or not working",
    answer:
      "If your number expired or stopped working:\n- Each number has a limited rental window (usually 5-20 minutes depending on the offer).\n- Once the window passes, the number is marked 'Expired' or 'Canceled' and can no longer receive SMS.\n- You'll need to purchase a new number for another attempt.\n- If you were charged but the number never worked, contact human support with your transaction details.",
  },
  {
    id: "payment-failed",
    keywords: ["payment failed", "payment issue", "card declined", "payment not working", "transaction failed", "fund failed", "deposit failed", "can't fund", "cannot fund", "flutterwave"],
    question: "Payment failed or payment issues",
    answer:
      "If your payment fails while funding your wallet:\n1. Check that your card supports online payments and has sufficient funds.\n2. Try a different payment method — Flutterwave supports card, bank transfer, and USSD.\n3. Make sure you're entering the correct details.\n4. If you were charged but your wallet wasn't credited, wait a few minutes — deposits are confirmed automatically.\n5. If your wallet still isn't credited after 10 minutes, contact human support with your transaction reference.\n\nMinimum deposit is ₦100.",
  },
  {
    id: "balance-account",
    keywords: ["balance", "wallet", "account", "funds", "how much", "credit", "my balance", "wallet balance"],
    question: "Balance and account questions",
    answer:
      "Your wallet balance is shown at the top of your dashboard and in the sidebar.\n- To add funds, go to 'Fund Wallet' and pay via Flutterwave.\n- To see all your transactions, go to 'Transaction History'.\n- Your balance updates automatically after a successful deposit or purchase.\n- If a deposit is confirmed but your balance doesn't update, try refreshing the page or contact support.",
  },
  {
    id: "transaction-history",
    keywords: ["transaction", "transactions", "history", "statement", "record", "records", "log", "activity", "what did i buy", "what have i done"],
    question: "Transaction history",
    answer:
      "You can see your full transaction history on the 'Transactions' page from your dashboard. It shows every deposit, purchase, and refund with the date, amount, and status. If you're signed in, I can also pull up your recent transactions right here — just ask me to show your transaction history or account statement.",
  },
  {
    id: "spending-summary",
    keywords: ["spending", "spent", "how much spent", "total spent", "money spent", "how much have i spent", "spending summary", "how much did i spend"],
    question: "Spending summary",
    answer:
      "If you're signed in, I can summarize your total deposits, total spending on numbers, and refunds. Just ask me for a spending summary and I'll break it down for you. You can also see the details on your Transactions page.",
  },
  {
    id: "refund",
    keywords: ["refund", "money back", "reimburse", "chargeback", "get my money", "wrong charge", "overcharged"],
    question: "Refund questions",
    answer:
      "Refund policy:\n- If you cancel a number before receiving any SMS, the cost is automatically refunded to your wallet.\n- If a number times out without receiving an SMS, the cost is automatically refunded to your wallet.\n- If you were charged incorrectly due to a system error, contact human support with your transaction reference and we'll review it.\n- Wallet funds are non-transferable and can only be used for number purchases on MONTEN SMS.",
  },
  {
    id: "supported-countries",
    keywords: ["country", "countries", "which countries", "supported", "available countries", "what countries", "regions"],
    question: "Supported countries and services",
    answer:
      "MONTEN SMS supports:\n- 190+ countries worldwide, including Nigeria, USA, UK, India, Germany, France, and many more.\n- 700+ services including WhatsApp, Telegram, Gmail, Google, TikTok, Instagram, Facebook, Signal, Discord, and hundreds of others.\n- To see the full list for your needs, go to 'Buy Numbers', select a country, and search for your service.",
  },
  {
    id: "how-to-use",
    keywords: ["how to use", "getting started", "how does it work", "guide", "tutorial", "start", "begin", "new user"],
    question: "How to use MONTEN SMS",
    answer:
      "Getting started with MONTEN SMS is simple:\n1. Create an account with your email and verify it with the OTP code we send you.\n2. Fund your wallet using Flutterwave (card, bank transfer, or USSD).\n3. Go to 'Buy Numbers', pick a country and service, and buy a number.\n4. Use that number on the service you're verifying.\n5. The SMS code arrives on your 'Purchased Numbers' page — copy it and you're done!\n\nThe whole process takes under 2 minutes.",
  },
  {
    id: "pricing",
    keywords: ["pricing", "how much does it cost", "cost", "price", "fee", "fees", "charge", "charges", "expensive", "cheap", "afford"],
    question: "Pricing and fees",
    answer:
      "Pricing on MONTEN SMS:\n- Virtual numbers start from as low as NGN 50, depending on the country and service.\n- Popular services like WhatsApp, Telegram, and Gmail typically range from NGN 50 to NGN 500 per number.\n- Each number rental includes a window to receive one SMS/OTP (usually 5-20 minutes).\n- Minimum wallet deposit is NGN 100.\n- There are no subscription fees or hidden charges — you only pay per number you buy.\n- Wallet funds never expire and can be used anytime.",
  },
  {
    id: "safety-privacy",
    keywords: ["safe", "secure", "security", "privacy", "private", "trust", "legit", "scam", "legitimate", "reliable", "data safe", "data secure"],
    question: "Safety and privacy",
    answer:
      "Your safety and privacy on MONTEN SMS:\n- All transactions are encrypted and processed securely through Flutterwave, a licensed payment processor.\n- Your personal data (email, password) is stored securely and never shared with third parties.\n- Virtual numbers are temporary — they protect your real phone number from spam and unwanted tracking.\n- We don't store the content of SMS messages longer than needed to deliver them to you.\n- Wallet funds are tied to your account and cannot be accessed by anyone else.\n- MONTEN SMS is a legitimate service used by thousands of customers for SMS verification worldwide.",
  },
  {
    id: "general-faq",
    keywords: ["faq", "questions", "help", "what is", "how do", "can i", "is it", "general"],
    question: "General frequently asked questions",
    answer:
      "Common questions:\n\n• Is MONTEN SMS safe? — Yes, all transactions are encrypted and your data stays private.\n• How fast are OTPs delivered? — Usually within seconds, though some services may take a few minutes.\n• Can I use one number for multiple services? — No, each number is for one service only.\n• Do numbers expire? — Yes, each number has a rental window shown at purchase.\n• Can I get a refund? — Only if you cancel before receiving any SMS. See the refund section for details.\n• Is there a minimum deposit? — Yes, ₦100.\n• Is there a subscription? — No, you only pay per number you buy.\n• Do wallet funds expire? — No, they can be used anytime.\n\nFor anything else, use the quick-reply buttons or contact human support.",
  },
];

export const quickReplyTopics: string[] = [
  "buy-number",
  "receive-sms",
  "otp-not-received",
  "number-expired",
  "payment-failed",
  "balance-account",
  "transaction-history",
  "spending-summary",
  "refund",
  "supported-countries",
  "how-to-use",
  "pricing",
  "safety-privacy",
  "general-faq",
];

export function findFaqAnswer(message: string): FaqEntry | null {
  const lower = message.toLowerCase();
  let bestMatch: FaqEntry | null = null;
  let bestScore = 0;

  for (const entry of faqEntries) {
    let score = 0;
    for (const keyword of entry.keywords) {
      if (lower.includes(keyword)) {
        score += keyword.length;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = entry;
    }
  }

  return bestScore > 0 ? bestMatch : null;
}

export function getFaqById(id: string): FaqEntry | undefined {
  return faqEntries.find((e) => e.id === id);
}
