# Billing & Subscription Production Verdict — Libriofy

> Audited: May 2026 | Role: Senior SaaS Billing Architect

---

## VERDICT: PARTIALLY PRODUCTION-READY

The billing system has solid foundations but critical gaps in enforcement and automation.

---

## 1. What EXISTS (Positive Findings)

### Razorpay Integration ✅
- **Order creation:** `supabase/functions/create-razorpay-order/index.ts` — creates Razorpay orders with proper amount calculation, GST, coupon support
- **Payment verification:** `supabase/functions/verify-razorpay-payment/index.ts` — HMAC-SHA256 signature verification against `RAZORPAY_KEY_SECRET`
- **Webhook handler:** `supabase/functions/razorpay-webhook/index.ts` — processes `payment.captured` events with signature validation
- **Idempotency:** RPC `process_subscription_payment_capture` handles duplicate captures gracefully (`already_captured` flag)
- **Observability:** Payment events logged with correlation IDs, trace metadata

### Subscription Enforcement ✅
- **ProtectedRoute:** Checks `evaluateSubscriptionAccess()` on every library dashboard route
- **Redirect to billing:** Expired subscriptions redirect to `/dashboard/billing`
- **Billing page bypass:** Users can always access billing page to renew
- **Super admin bypass:** Super admins skip subscription checks entirely

### Subscription State Machine ✅ (in `src/lib/subscription.ts`)
- States: `trial`, `active_plan`, `trial_expired`, `subscription_expired`, `account_disabled`, `inactive`
- Trial detection with configurable duration
- Plan expiry calculation from `library_subscriptions` table
- Grace period support (configurable days)

### Financial Structure ✅
- GST calculation (18% default, configurable)
- Invoice generation via admin panel
- Refund tracking
- Revenue adjustments with audit trail
- Commission system per library

---

## 2. What's MISSING (Critical Gaps)

### A. No Automated Renewal System ❌

| Gap | Impact |
|-----|--------|
| No scheduled renewal job | Subscriptions expire silently |
| No payment retry on failure | Single failed payment = lost customer |
| No dunning emails | Customer doesn't know payment failed |
| No pre-expiry reminders | No "your plan expires in 3 days" email |
| No auto-suspend after grace period | Expired libraries stay accessible until page refresh |

**Revenue Impact:** At 100 customers with 5% monthly churn from failed payments, ~5 customers/month silently lose access without any recovery attempt.

### B. No Backend Subscription Enforcement ❌

| Gap | Impact |
|-----|--------|
| QR scan API doesn't check subscription | Expired libraries can still scan attendance |
| Device heartbeat doesn't check subscription | Kiosks work indefinitely after expiry |
| No server-side middleware for subscription | Frontend-only enforcement (bypassable) |
| No API-level plan validation | All API endpoints accessible regardless of plan |

**Risk:** A technically savvy customer could use the API directly after subscription expires. QR scanning (the core product) works forever without payment.

### C. No Webhook Failure Recovery ❌

| Gap | Impact |
|-----|--------|
| No webhook retry queue | If Supabase edge function fails, payment is lost |
| No reconciliation job | No way to detect missed webhooks |
| No payment status polling | Relies entirely on webhook delivery |
| No manual capture fallback | Admin must manually verify in Razorpay dashboard |

**Risk:** Razorpay webhook delivery is ~99.5% reliable. At 100 customers × 12 payments/year = 1,200 webhooks/year. ~6 missed webhooks/year = 6 customers who paid but don't get activated.

### D. No Self-Service Billing ❌

| Gap | Impact |
|-----|--------|
| No cancel subscription flow | Must contact admin |
| No upgrade/downgrade | Must create new payment |
| No payment method update | Stuck if card expires |
| No billing history page | Only admin can see payment history |
| No invoice download for customers | Must request from admin |

---

## 3. Revenue Leakage Analysis (100 Customers)

| Leakage Source | Monthly Impact | Annual Impact |
|----------------|---------------|---------------|
| Failed payments with no retry | 2-5 customers × ₹999 | ₹24,000-60,000 |
| Missed webhooks (no reconciliation) | 0.5 customers × ₹999 | ₹6,000 |
| Expired libraries still scanning | 3-5 customers × ₹999 | ₹36,000-60,000 |
| No pre-expiry reminders (churn) | 2-3 customers × ₹999 | ₹24,000-36,000 |
| **Total estimated leakage** | | **₹90,000-162,000/year** |

At ₹999/month × 100 customers = ₹12 lakh/year revenue, this represents **7.5-13.5% revenue leakage**.

---

## 4. What Works Well Under Load

| Component | 100 Customers | 500 Customers | Notes |
|-----------|---------------|---------------|-------|
| Razorpay order creation | ✅ | ✅ | Edge function, scales independently |
| Payment verification | ✅ | ✅ | Single DB lookup + RPC |
| Webhook processing | ✅ | ✅ | Idempotent, handles duplicates |
| Subscription state check | ✅ | ✅ | Single row lookup per library |
| Frontend enforcement | ✅ | ✅ | Client-side, no server load |
| Admin billing dashboard | ⚠️ | ❌ | Loads all payments (now limited to 200) |

---

## 5. Priority Fixes for Launch

### P0 — Must Fix Before Accepting Money

1. **Add subscription check to scan API** — `scanAttendance.server.ts` should verify library subscription is active before allowing attendance recording
2. **Add payment reconciliation job** — Daily job that checks Razorpay for payments not reflected in DB
3. **Add pre-expiry email** — 7 days and 1 day before expiry

### P1 — Fix Within First Month

4. **Add payment retry** — Retry failed payments 3 times over 7 days
5. **Add dunning emails** — "Payment failed, please update" sequence
6. **Add auto-suspend** — After grace period, restrict access server-side
7. **Add webhook failure alerting** — Notify admin of missed webhooks

### P2 — Fix Within First Quarter

8. **Add self-service cancel** — Let customers cancel from billing page
9. **Add invoice download** — PDF generation for customers
10. **Add upgrade/downgrade** — Plan switching with proration

---

## 6. Honest Answer

> "If 100 customers paid Libriofy monthly, where would money leak or billing chaos happen first?"

**The QR scanning system would continue working for expired customers indefinitely.** The scan API (`/api/attendance/scan`) has zero subscription validation — it only checks `library_access_keys` and `entry_devices`. A library that stops paying can continue scanning attendance forever as long as their device remains bound.

**Second failure:** ~6 payments per year would succeed on Razorpay but fail to activate in Libriofy due to missed webhooks. Without a reconciliation job, these customers would pay but not get service — leading to support tickets and refund requests.

**Third failure:** No automated renewal means every subscription requires the customer to manually go to the billing page and pay again. There's no "auto-debit" or recurring payment. This creates massive churn from simple forgetfulness.

**The billing system is a one-time payment system, not a subscription system.** It handles the initial purchase well but has no lifecycle management after that.

---

## 7. Architecture Recommendation

```
Current (Manual):
Customer → Pays once → Gets access → Expires → Must manually repay

Required (Automated):
Customer → Subscribes → Auto-renews monthly → Failed? → Retry 3x → 
Dunning emails → Grace period → Suspend → Cancel

With:
- Razorpay Subscriptions API (not just Orders)
- Scheduled renewal jobs (BullMQ or Supabase cron)
- Server-side enforcement middleware
- Reconciliation job (daily)
- Dunning email sequence (automated)
```

---

*End of billing audit.*
