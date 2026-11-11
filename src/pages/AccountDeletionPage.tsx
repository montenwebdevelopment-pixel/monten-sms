import { useEffect } from "react";
import { Link } from "react-router-dom";
import { InfoSection, PublicInfoLayout } from "../components/PublicInfoLayout";

export function AccountDeletionPage() {
  useEffect(() => {
    document.title = "Account Deletion | MONTEN SMS";
    return () => {
      document.title = "MONTEN SMS - OTP Verification Platform";
    };
  }, []);

  return (
    <PublicInfoLayout
      title="Account Deletion"
      description="MONTEN SMS customers can use this page to request review of their account-deletion request, even if they no longer have access to the app."
    >
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
        Account deletion is not currently an automatic in-app feature, and a self-service backend deletion process is not operational. Sending an email submits a request for review; it does not mean the account has already been deleted.
      </div>

      <InfoSection title="How to request account deletion">
        <ol className="list-decimal space-y-2 pl-5">
          <li>Email <a className="font-semibold text-royal-600 hover:text-royal-700" href="mailto:support@montensms.com?subject=MONTEN%20SMS%20account%20deletion%20request">support@montensms.com</a> with the subject “MONTEN SMS account deletion request.”</li>
          <li>Include your registered email address and MONTEN SMS username so support can identify and verify the request.</li>
          <li>Support may ask for additional account or transaction details reasonably needed to verify that you own the account, then will contact you about the next steps.</li>
        </ol>
        <p>
          Do not send your password, one-time verification codes, login or password-reset links, or payment-card details. If possible, send the request from the email address registered to your account.
        </p>
        <p>
          This page explains how to submit a request. It does not provide an automated deletion operation or a guaranteed completion timeframe. We will review requests manually and explain any additional steps or limitations.
        </p>
      </InfoSection>

      <InfoSection title="Wallet balance and refund requests">
        <p>
          You do not have to spend your remaining wallet balance before requesting account deletion. Account deletion and unused-wallet refunds are separate processes. A pending refund does not prevent you from submitting an account-deletion request.
        </p>
        <p>
          To request a refund for unused wallet funds, email <a className="font-semibold text-royal-600 hover:text-royal-700" href="mailto:support@montensms.com?subject=MONTEN%20SMS%20unused%20wallet%20refund%20request">support@montensms.com</a> with your registered email address and username. Include any additional account or transaction details reasonably required for verification. After the required information is received and verified, refunds are to be processed within 2–3 working days.
        </p>
        <p>
          Do not include passwords, one-time codes, login links, or payment-card details in a refund request. If you also want your account deleted, state that separately; submitting one request does not automatically submit the other.
        </p>
      </InfoSection>

      <InfoSection title="Information that may need review or retention">
        <p>
          A deletion request may involve account details, wallet and transaction history, pending deposits or refunds, virtual-number orders, and stored SMS/OTP content. We need to review related payments and supplier orders so that a request does not silently discard an unresolved transaction or active order.
        </p>
        <p>
          Some transaction or payment information may need to be retained for legitimate legal, accounting, security, fraud-prevention, or dispute-handling purposes, subject to applicable requirements. No fixed retention period is stated here. Deleting information from MONTEN SMS does not necessarily immediately delete information held by Supabase, Flutterwave, 5SIM, Resend, or other service providers; requests to providers may be handled separately where appropriate.
        </p>
        <p>
          For more detail about information handled by the service, read the <Link className="font-semibold text-royal-600 hover:text-royal-700" to="/privacy-policy">MONTEN SMS Privacy Policy</Link>.
        </p>
      </InfoSection>
    </PublicInfoLayout>
  );
}
