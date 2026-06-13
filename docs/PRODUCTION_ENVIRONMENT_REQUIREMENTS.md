# Production Environment Requirements

Scope:

- Current production readiness gate in [`src/lib/observability/runtimeGovernance.server.ts`](/c:/Users/SHOP4/OneDrive/Desktop/Libriofy/src/lib/observability/runtimeGovernance.server.ts)
- Live production billing and QR-signing consumers in [`src/lib/superAdmin/service.server.ts`](/c:/Users/SHOP4/OneDrive/Desktop/Libriofy/src/lib/superAdmin/service.server.ts), [`src/lib/studentQr.server.ts`](/c:/Users/SHOP4/OneDrive/Desktop/Libriofy/src/lib/studentQr.server.ts), and [`src/App.tsx`](/c:/Users/SHOP4/OneDrive/Desktop/Libriofy/src/App.tsx)

## Readiness Verdict

- Verdict: `A) readiness gate is correct`
- Reason: the missing values are consumed by live production paths, and `validateRuntimeConfiguration()` fails readiness when any of them is absent or looks like a placeholder.
- Important nuance: if billing is intentionally switched to Stripe in production, the Razorpay trio should be reclassified. The current code defaults to Razorpay unless `BILLING_PROVIDER` is exactly `stripe`.

## Requirements

| Variable | Required? | Feature dependency | Active in production? | Production impact if missing | Source evidence |
| --- | --- | --- | --- | --- | --- |
| `RAZORPAY_KEY_ID` | Required | Razorpay billing provider | Yes. Billing diagnostics and the billing console are live paths, and the runtime defaults to Razorpay when `BILLING_PROVIDER` is not `stripe`. | Readiness fails, Razorpay config diagnostics stay degraded, and billing actions cannot be treated as production-ready. | [`runtimeGovernance.server.ts:351-389`](/c:/Users/SHOP4/OneDrive/Desktop/Libriofy/src/lib/observability/runtimeGovernance.server.ts#L351), [`service.server.ts:996-1016`](/c:/Users/SHOP4/OneDrive/Desktop/Libriofy/src/lib/superAdmin/service.server.ts#L996), [`App.tsx:396-402`](/c:/Users/SHOP4/OneDrive/Desktop/Libriofy/src/App.tsx#L396) |
| `RAZORPAY_KEY_SECRET` | Required | Razorpay billing provider | Yes. Same active billing path as above. | Readiness fails and Razorpay payment verification is incomplete. | [`runtimeGovernance.server.ts:367-376`](/c:/Users/SHOP4/OneDrive/Desktop/Libriofy/src/lib/observability/runtimeGovernance.server.ts#L367), [`service.server.ts:996-1016`](/c:/Users/SHOP4/OneDrive/Desktop/Libriofy/src/lib/superAdmin/service.server.ts#L996) |
| `RAZORPAY_WEBHOOK_SECRET` | Required | Razorpay billing webhooks | Yes. The billing service reads the webhook secret for diagnostics and webhook handling. | Readiness fails and production webhook validation cannot be trusted. | [`runtimeGovernance.server.ts:379-382`](/c:/Users/SHOP4/OneDrive/Desktop/Libriofy/src/lib/observability/runtimeGovernance.server.ts#L379), [`service.server.ts:996-1016`](/c:/Users/SHOP4/OneDrive/Desktop/Libriofy/src/lib/superAdmin/service.server.ts#L996) |
| `STUDENT_QR_PRIVATE_KEY` | Required | Signed student QR generation | Yes. The QR code pages and student profile route fetch signed tokens when students are eligible. | Readiness fails and `/api/student-qr` returns a config error when token signing is requested. | [`runtimeGovernance.server.ts:386-389`](/c:/Users/SHOP4/OneDrive/Desktop/Libriofy/src/lib/observability/runtimeGovernance.server.ts#L386), [`studentQr.server.ts:194-223`](/c:/Users/SHOP4/OneDrive/Desktop/Libriofy/src/lib/studentQr.server.ts#L194), [`App.tsx:307-430`](/c:/Users/SHOP4/OneDrive/Desktop/Libriofy/src/App.tsx#L307), [`QRCodesPage.tsx:180-194`](/c:/Users/SHOP4/OneDrive/Desktop/Libriofy/src/pages/QRCodesPage.tsx#L180), [`StudentIdProfilePage.tsx:172-189`](/c:/Users/SHOP4/OneDrive/Desktop/Libriofy/src/pages/StudentIdProfilePage.tsx#L172) |

## Exact Value Generation Instructions

### Razorpay keys

1. Open the Razorpay Dashboard for the live production account.
2. Go to `Settings` -> `API Keys`.
3. Generate or reveal the live key pair.
4. Copy the live `key_id` into `RAZORPAY_KEY_ID`.
5. Copy the live `key_secret` into `RAZORPAY_KEY_SECRET`.
6. Go to `Webhooks` and create or edit the production webhook endpoint.
7. Copy the webhook signing secret into `RAZORPAY_WEBHOOK_SECRET`.
8. Store all three values in the Vercel production environment, not in preview or development.
9. Do not use test keys. The readiness gate treats placeholder values as failures.

### Student QR private key

1. Generate a new RSA private key in PKCS#8 PEM format:

```bash
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out student_qr_private_key.pem
```

2. Use the full PEM block as the environment value for `STUDENT_QR_PRIVATE_KEY`.
3. Preserve the `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----` lines.
4. Do not escape the newlines as literal `\n` text. The loader strips PEM whitespace, but it still expects a real PEM value.
5. If the key is rotated, update any matching signing/verification material in the same release window.

## Why These Are Hard Requirements

- [`validateRuntimeConfiguration()`](/c:/Users/SHOP4/OneDrive/Desktop/Libriofy/src/lib/observability/runtimeGovernance.server.ts#L298) adds a `fail` check for each missing secret.
- [`buildRuntimeReadinessReport()`](/c:/Users/SHOP4/OneDrive/Desktop/Libriofy/src/lib/observability/runtimeGovernance.server.ts#L741) sets readiness to failed when any check fails.
- The billing console and QR code routes are already part of the deployed application shell, so these are not dead-code dependencies.

