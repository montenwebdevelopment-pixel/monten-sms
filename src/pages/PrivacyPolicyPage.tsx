import { useEffect } from "react";
import { Link } from "react-router-dom";
import { InfoSection, PublicInfoLayout } from "../components/PublicInfoLayout";

export function PrivacyPolicyPage() {
  useEffect(() => {
    document.title = "Privacy Policy | MONTEN SMS";
    return () => {
      document.title = "MONTEN SMS - OTP Verification Platform";
    };
  }, []);

  return (
    <PublicInfoLayout
      title="Privacy Policy"
      description="This policy explains what information MONTEN SMS processes when you use our website and app, how it supports the service, and how to contact us about your information."
    >
      <p className="text-sm leading-7 text-slate-500">Last updated: November 3, 2026</p>

      <InfoSection title="About MONTEN SMS">
        <p>
          MONTEN SMS provides accounts for purchasing temporary virtual phone numbers and receiving SMS verification messages. The website and Android app use a shared wallet, with wallet deposits currently in Nigerian naira (NGN).
        </p>
        <p>
          For privacy questions, contact <a className="font-semibold text-royal-600 hover:text-royal-700" href="mailto:support@montensms.com">support@montensms.com</a>. CAC company registration is pending; this policy does not state a registered company name, number, or address.
        </p>
      </InfoSection>

      <InfoSection title="Information processed">
        <ul className="list-disc space-y-2 pl-5">
          <li><strong>Account information:</strong> name, username, email address, profile information, email-verification status, and authentication credentials used to sign in.</li>
          <li><strong>Wallet and payment information:</strong> wallet balance, deposit and purchase amounts, transaction references and statuses, payment type, and related timestamps. Payments are initiated and verified through Flutterwave; the app currently accepts NGN deposits.</li>
          <li><strong>Virtual-number and message information:</strong> number order identifiers, phone number, destination country, selected service and operator, order status, and the SMS text and code returned for an order.</li>
          <li><strong>Support and service information:</strong> support messages, recent chat history sent when contacting the in-app support assistant, support-ticket details, and service notifications.</li>
          <li><strong>Verification and operational information:</strong> email-verification code records and request timestamps used to deliver and protect account verification and recovery flows.</li>
        </ul>
      </InfoSection>

      <InfoSection title="How we use information">
        <p>
          We process this information to create and secure accounts, provide the wallet and number-purchase features, deliver and display SMS/OTP messages, record and reconcile payments and refunds, send verification and recovery emails, provide notifications, and respond to support requests.
        </p>
        <p>
          When you contact support, recent conversation messages may be sent to our support service so it can respond to account or service questions. Support records may be created when a request is escalated.
        </p>
      </InfoSection>

      <InfoSection title="Service providers and sharing">
        <p>
          MONTEN SMS uses service providers to operate its features. Information is shared with them as needed for the service:
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li><strong>Supabase</strong> provides authentication, database, and backend services for account and service data.</li>
          <li><strong>Flutterwave</strong> processes wallet deposits. The payment flow sends customer name, email, amount, and currency information and uses provider transaction details to verify and record payment.</li>
          <li><strong>5SIM</strong> supplies virtual numbers. Number requests include country, service, and operator selection; 5SIM returns number-order and SMS information that is shown in your account.</li>
          <li><strong>Resend</strong> delivers account-verification and password-recovery emails using the relevant email address and message content.</li>
        </ul>
        <p>
          We do not claim that these providers store information only for MONTEN SMS or that they immediately erase their copies when an account request is made. Their own handling is subject to their terms and privacy practices. We may also disclose information when required by applicable law or to address security, fraud, payment disputes, or support issues.
        </p>
      </InfoSection>

      <InfoSection title="Notifications, clipboard, and external services">
        <p>
          The app may ask for notification permission so it can tell you when an SMS code is ready. Notification text does not include the OTP code. When you choose to copy a code, the app uses your device or browser clipboard.
        </p>
        <p>
          The website and app link to third-party social and support services. If you follow those links, those services handle information under their own policies.
        </p>
        <p>
          The deployed website has been observed loading a third-party badge script. Its purpose and data handling have not yet been confirmed. We will update this notice if that review identifies additional collection or sharing.
        </p>
      </InfoSection>

      <InfoSection title="Storage and security">
        <p>
          Account, wallet, order, SMS/OTP, notification, and support records are stored in the service database. In particular, received SMS text and codes are saved with number-order records; this project does not define a fixed automatic deletion period for them.
        </p>
        <p>
          The application uses authenticated sessions, database access controls, HTTPS for its external payment and email service calls, and server-side payment verification. These measures do not guarantee that all risks are eliminated. Further details about hosting locations, encryption at rest, backups, and provider access have not been confirmed and are not promised here.
        </p>
      </InfoSection>

      <InfoSection title="Retention and account-deletion requests">
        <p>
          MONTEN SMS has not established fixed retention periods for all categories of information. Records may need to be retained or limited for legitimate payment reconciliation, accounting, security, fraud prevention, customer disputes, or legal compliance purposes, as applicable. Any applicable retention period is subject to confirmation and legal requirements.
        </p>
        <p>
          There is not currently an automatic account-deletion feature in the app or an operational self-service deletion process. You can email <a className="font-semibold text-royal-600 hover:text-royal-700" href="mailto:support@montensms.com?subject=MONTEN%20SMS%20account%20deletion%20request">support@montensms.com</a> to request account deletion. See our <Link className="font-semibold text-royal-600 hover:text-royal-700" to="/delete-account">Account Deletion page</Link> for what to include. A request is not an immediate deletion confirmation; support will review it and explain next steps.
        </p>
        <p>
          A deletion request does not require you to spend your remaining wallet balance. An unused-wallet refund request is a separate process and a pending refund does not prevent you from submitting a deletion request. Some transaction or payment records may need to be retained for legitimate purposes, subject to applicable requirements. We cannot promise immediate deletion of information held by third-party providers.
        </p>
      </InfoSection>

      <InfoSection title="Unused-wallet refunds">
        <p>
          To request a refund of unused wallet funds, email <a className="font-semibold text-royal-600 hover:text-royal-700" href="mailto:support@montensms.com?subject=MONTEN%20SMS%20unused%20wallet%20refund%20request">support@montensms.com</a> with your registered email address and username. We may request additional account or transaction details reasonably needed to verify the request. After the required information is received and verified, refunds are to be processed within 2–3 working days.
        </p>
        <p>
          Do not email your password, one-time verification codes, login links, or payment-card details. A refund request and an account-deletion request are separate; you do not have to spend your wallet balance before requesting deletion.
        </p>
      </InfoSection>

      <InfoSection title="Contact and updates">
        <p>
          For privacy questions, data requests, or help with this policy, email <a className="font-semibold text-royal-600 hover:text-royal-700" href="mailto:support@montensms.com">support@montensms.com</a>. This policy may be updated as the service and its data practices change. The date at the top indicates when this page was last revised.
        </p>
      </InfoSection>
    </PublicInfoLayout>
  );
}
