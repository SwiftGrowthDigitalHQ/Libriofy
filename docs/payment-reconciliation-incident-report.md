# Payment Reconciliation Incident Report

## Summary

A Razorpay checkout completed successfully, but the subscription did not activate automatically. The payment session stayed in `pending`, the billing page continued to show the trial state, and the customer was incorrectly prompted to purchase again. We reconciled the captured payment, restored the subscription, and added safeguards to prevent the same failure mode from lingering unnoticed.

## Root Cause

The incident was caused by a missing automated recovery path for pending payment rows after checkout. The system depended on the browser verify callback or Razorpay webhook to complete activation, but that callback path was not reliable enough on its own.

There were also two production drift issues that made recovery harder:

1. The live `subscription_payments` status constraint had drifted from the application code and rejected the wrong insert status.
2. The live `process_subscription_payment_capture` function had drifted from the repository version and failed during manual recovery until it was patched.

## Impact

- A successful payment remained unactivated.
- The billing page still showed:
  - `Status: Billing only`
  - `Payment: Trial`
  - `Trial expired`
- The user was asked to buy the plan again even though Razorpay had already captured the charge.
- Dashboard access stayed blocked until reconciliation completed.

## Timeline

- June 1, 2026: Razorpay checkout completed successfully for `order_SwOerpN8V0IUpQ`.
- June 1, 2026: The payment record remained `pending` and the subscription stayed in trial.
- June 1, 2026: Manual reconciliation confirmed the payment had been captured as `pay_SwOfK8Pd1Orltg`.
- June 1, 2026: Production capture drift was patched and the subscription was activated.
- June 1, 2026: Additional safety protections were added to prevent the same issue from lingering again.

## Fix

- Aligned the subscription payment status constraint with the application lifecycle.
- Fixed the production capture RPC drift so manual and automated reconciliation can complete successfully.
- Added a scheduled reconciliation job that scans `pending` subscription payments older than 5 minutes and replays the capture path when Razorpay already shows the payment as captured.
- Added alerts for:
  - stale pending payments older than 10 minutes
  - Razorpay webhook signature failures
  - verify-payment failures
- Added admin billing metrics for:
  - pending payments
  - failed payments
  - reconciled payments
  - webhook delivery failures
- Added tests covering:
  - successful payment verification
  - missing verify-payment function
  - missing webhook function
  - reconciliation recovery

## Prevention Measures

- Scheduled reconciliation runs every 5 minutes.
- Pending payments older than 10 minutes generate alerts so the team can intervene before a user reports the issue.
- Webhook signature validation failures now alert immediately.
- Billing metrics now expose the health of the payment pipeline in the admin dashboard.
- Reconciliation logic is covered by focused tests so drift is more likely to be caught before production.

## Final Reconciled State

- `subscription_payments.status = paid`
- `library_subscriptions.status = active`
- `library_subscriptions.payment_status = paid`
- `coupon_redemptions.status = captured`
- Dashboard access restored

