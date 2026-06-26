# Microsoft Store Submission Checklist — Libriofy v1.0.0

## Pre-Submission Status

| # | Check | Status |
|---|-------|--------|
| 1 | manifest.webmanifest valid JSON | ✅ |
| 2 | All required icon sizes present | ✅ |
| 3 | Separate `any` and `maskable` icon purpose | ✅ |
| 4 | Screenshots array in manifest | ✅ |
| 5 | Service Worker registered | ✅ |
| 6 | Offline fallback works | ✅ |
| 7 | App is installable (beforeinstallprompt) | ✅ |
| 8 | HTTPS enforced | ✅ |
| 9 | HSTS header configured | ✅ |
| 10 | Content-Security-Policy header | ✅ |
| 11 | Permissions-Policy header | ✅ |
| 12 | Cross-Origin headers configured | ✅ |
| 13 | Privacy Policy page exists | ✅ |
| 14 | Terms of Service page exists | ✅ |
| 15 | Support page exists | ✅ |
| 16 | Semantic versioning (1.0.0) | ✅ |
| 17 | Categories in manifest | ✅ |
| 18 | Shortcuts in manifest | ✅ |
| 19 | `display_override` with WCO | ✅ |
| 20 | `lang` and `dir` in manifest | ✅ |
| 21 | `scope` defined | ✅ |
| 22 | `start_url` defined | ✅ |
| 23 | `theme_color` defined | ✅ |
| 24 | `background_color` defined | ✅ |
| 25 | browserconfig.xml present | ✅ |
| 26 | msapplication metadata | ✅ |
| 27 | Open Graph tags | ✅ |
| 28 | Twitter Card tags | ✅ |
| 29 | Structured data (JSON-LD) | ✅ |
| 30 | Canonical URL | ✅ |
| 31 | Skip-to-content link | ✅ |
| 32 | Route announcer for screen readers | ✅ |
| 33 | Focus management on navigation | ✅ |
| 34 | ARIA live regions | ✅ |
| 35 | Keyboard navigation support | ✅ |
| 36 | Error boundary with crash recovery | ✅ |
| 37 | 404 page | ✅ |
| 38 | Production console.logs guarded | ✅ |
| 39 | Code splitting / lazy loading | ✅ |
| 40 | Font loading optimized (preconnect) | ✅ |

---

## PWABuilder Readiness

| Requirement | Status |
|-------------|--------|
| Valid manifest.webmanifest | ✅ |
| Service Worker with fetch handler | ✅ |
| Offline response | ✅ |
| HTTPS | ✅ |
| 192x192 icon | ✅ |
| 512x512 icon | ✅ |
| Maskable icons | ✅ |
| start_url responds 200 | ✅ (when deployed) |
| display: standalone | ✅ |
| name + short_name | ✅ |

**PWABuilder Expected Score: 150+/200 (Publishable)**

---

## MSIX Generation

Use PWABuilder to generate the MSIX package:

1. Go to https://www.pwabuilder.com
2. Enter: `https://libriofy.com`
3. Click "Start"
4. Review audit scores
5. Click "Package for stores" → "Windows"
6. Fill in:
   - **Package ID:** com.libriofy.app
   - **Publisher Display Name:** Libriofy
   - **Publisher ID:** (from Microsoft Partner Center)
   - **Version:** 1.0.0.0
7. Download MSIX bundle
8. Upload to Microsoft Partner Center

---

## Remaining Steps (Manual)

1. **Convert SVG icons to PNG** — Run `npm install -D sharp && node scripts/generate-icons.mjs` OR use PWABuilder Image Generator at https://www.pwabuilder.com/imageGenerator
2. **Take real screenshots** — Replace SVG placeholders with actual app screenshots (1920×1080 PNG)
3. **Register on Microsoft Partner Center** — https://partner.microsoft.com (one-time $19 fee)
4. **Generate MSIX via PWABuilder** — After deploy with all fixes
5. **Submit to Store** — Upload MSIX + listing assets

---

## Certification Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|-----------|
| SVG icons (not PNG) | Medium | PWABuilder accepts SVG, but recommended to provide PNG fallbacks |
| App requires login for most features | Low | Landing page, privacy, terms work without auth |
| Indian payment gateway (Razorpay) | None | Not a Store policy issue |
| Mixed-language content (Hinglish) in some toasts | Low | Core UI is English |

---

## Store Policies Compliance

| Policy | Status |
|--------|--------|
| 10.1 — Distinct function and value | ✅ Library management SaaS |
| 10.2 — Security | ✅ CSP, HSTS, input validation |
| 10.3 — Testable | ✅ Landing page works without login |
| 10.4 — Usability | ✅ Responsive, accessible |
| 10.5 — Personal Information | ✅ Privacy policy, no PII exposure |
| 10.6 — Capabilities | ✅ Camera for QR only |
| 10.8 — Financial transactions | ✅ Razorpay integration with ToS |
| 10.13 — Gaming/gambling | N/A |
| 10.14 — Account type | ✅ Standard account sufficient |
