# Scan Technical Breakdown

This document explains the live `/scan` system as it exists now.

Current source of truth:

- Live route: [src/App.tsx](../../src/App.tsx) -> [src/pages/ScanPage.tsx](../../src/pages/ScanPage.tsx)
- API contract: [src/lib/attendanceSync.ts](../../src/lib/attendanceSync.ts), [server/index.ts](../../server/index.ts), [src/lib/scanAttendance.server.ts](../../src/lib/scanAttendance.server.ts)
- Schema source of truth: [supabase/migrations/](../../supabase/migrations/)

## Live System Map

| Layer | Live file / contract | Purpose |
| --- | --- | --- |
| Route | [src/App.tsx](../../src/App.tsx) | `/scan` uses `ScanPage` behind `DeviceScanRoute` |
| Scanner UI | [src/pages/ScanPage.tsx](../../src/pages/ScanPage.tsx) | camera startup, worker decode loop, UI, watchdog, heartbeat |
| Offline queue | [src/lib/attendanceSync.ts](../../src/lib/attendanceSync.ts) | request builder, IndexedDB queue, sync replay |
| QR parser | [src/lib/studentQr.ts](../../src/lib/studentQr.ts) | client and server QR validation |
| Decode worker | [src/workers/scanDecoder.worker.ts](../../src/workers/scanDecoder.worker.ts) | worker-side ROI decode, BarcodeDetector primary, jsQR fallback |
| Offline verified cache | [src/lib/offlineVerifiedStudentCache.ts](../../src/lib/offlineVerifiedStudentCache.ts) | recent successful users for offline verification feedback |
| HTTP API | [server/index.ts](../../server/index.ts) | `POST /api/attendance/scan` and alias `POST /api/scan-attendance` |
| Scan service | [src/lib/scanAttendance.server.ts](../../src/lib/scanAttendance.server.ts) | device validation, QR validation, RPC orchestration |
| Device heartbeat | [src/lib/deviceHeartbeat.ts](../../src/lib/deviceHeartbeat.ts) | scanner presence and health reporting |
| Device commands | [src/lib/deviceCommands.ts](../../src/lib/deviceCommands.ts) | remote refresh / message / maintenance commands |

## 1. Scanner Setup

### Libraries and versions

- Camera preview/runtime layer: `html5-qrcode@^2.3.8`
- Worker fallback decoder: `jsqr@^1.4.0`
- Worker primary decoder: native `BarcodeDetector` API when supported

The live decode engine is now worker-first. `html5-qrcode` keeps camera startup, pause/resume, and track controls stable, while actual QR detection is handled by the worker pipeline.

### Camera access model

The scanner uses direct browser camera APIs, the scanner library, and a dedicated decode worker:

1. `chooseRearCameraSource()` calls `navigator.mediaDevices.getUserMedia(...)` as a warmup step.
2. It optionally uses `enumerateDevices()` to find the best rear camera device id.
3. `Html5Qrcode.start(...)` starts the live camera preview and device-control session.
4. A `requestAnimationFrame(...)` loop captures only the scan ROI and sends it to [src/workers/scanDecoder.worker.ts](../../src/workers/scanDecoder.worker.ts).
5. The worker runs `BarcodeDetector` first and falls back to `jsQR` when needed.

So camera access is still browser `getUserMedia`, `html5-qrcode` is now the preview/runtime layer, and the decode engine lives in the worker.

### Camera profiles

Live camera profiles in [src/pages/ScanPage.tsx](../../src/pages/ScanPage.tsx):

| Profile | Resolution target | Frame rate target |
| --- | --- | --- |
| Sharp rear camera | `1280x720` ideal | `15` ideal, `24` max |
| Balanced rear camera | `960x540` ideal | `12` ideal, `20` max |
| Performance rear camera | `640x480` ideal | `10` ideal, `15` max |

Camera runtime config:

- `fps: 2` inside `html5-qrcode` to keep preview overhead low
- `aspectRatio: 1`
- `disableFlip: false`
- QR-only format support
- `useBarCodeDetectorIfSupported: false`

Worker decode config:

- center ROI only
- downscaled crop target around `360px`
- `BarcodeDetector` primary when available
- `jsQR` fallback with grayscale / contrast / threshold enhancement

### Continuous or single scan

Live `/scan` is continuous scan with controlled pause:

`continuous decode -> QR detect -> pause scanner -> verify attendance -> show result -> resume scanner`

Important detail:

- the scanner is paused on detection
- it is not fully destroyed on every normal scan
- it resumes only after API processing and result hold complete

## 2. QR Detection Flow

### Primary detection path

The first detection path is now the scan worker.

When the worker receives a cropped frame:

1. `requestAnimationFrame(...)` loop captures only the center scan ROI
2. frame is downscaled before decode
3. worker tries native `BarcodeDetector`
4. if `BarcodeDetector` returns a QR, it emits `qr-detected`
5. `handleScanResultRef.current(rawValue, "barcode_detector")` runs

### Fallback detection path

If `BarcodeDetector` misses, the worker falls back to `jsQR`:

1. same ROI frame is re-used inside the worker
2. `jsQR(...)` runs on:
   - direct ROI image
   - grayscale + contrast pass
   - threshold-enhanced pass
3. if fallback finds a QR, it logs `qr-detected` with `source: "jsqr"`
4. `handleScanResultRef.current(rawValue, "jsqr")` runs

If worker `OffscreenCanvas` is unavailable, the page falls back to the old main-thread cropped `jsQR` path so scanning still works.

### Raw QR data format

Both primary and fallback detection deliver a string.

Accepted live QR shapes:

| QR type | Example shape | Parsed where |
| --- | --- | --- |
| Signed token | `eyJ...` JWT string | client first, server again |
| Signed route URL | `/student/<jwt>` or full URL | client first, server again |
| Structured JSON | `{"studentId":"LIB123","libraryId":"LIB001"}` | client first, server again |
| Legacy QR | `STD-00042` or `/student/STD-00042` | client first, server again |

### Example console logs

The live scanner now emits console logs with prefix `[scan-kiosk]`.

Example detect log:

```txt
[scan-kiosk] qr-detected { source: "barcode_detector", length: 43, preview: "{\"studentId\":\"LIB123\"...\"LIB001\"}", timingMs: 12 }
```

Example fallback detect log:

```txt
[scan-kiosk] qr-detected { source: "jsqr", length: 43, preview: "{\"studentId\":\"LIB123\"...\"LIB001\"}", timingMs: 26 }
```

## 3. Frontend Logic

### Function called after detection

The live pipeline is:

1. worker detects a QR through `BarcodeDetector` or `jsQR`
2. `handleScanResult(rawValue, detectionSource)` runs
3. `pauseScanner(true, "scan-processing")` pauses the live video pipeline
4. client QR validation runs with `parseStudentQrPayload(...)`
5. request payload is built with `createAttendanceQueueEntry(...)`
6. API request is sent immediately
7. result UI is shown
8. `scheduleReturnToScanner()` resumes scanning after the result hold

### Duplicate prevention

Duplicate prevention is now keyed by the parsed scan identifier, not only by raw QR text.

Live guard:

- ref: `lastAcceptedScanRef`
- key: parsed `studentId` or legacy `qrCode`
- window: `DUPLICATE_SCAN_WINDOW_MS = 3000`

If a duplicate scan is suppressed:

- the event is logged as `scan-duplicate-ignored`
- the current processing run is dropped
- scanner resumes without a full restart

### UI updates after scan

Live UI state flow:

1. scanner pauses
2. `setPhase("scanning")`
3. status changes to:
   - `Verifying attendance...`
   - or `Saving offline...`
4. result payload is stored in `scanPayload`
5. phase becomes:
   - `success`
   - `queued`
   - or `error`
6. after `RESULT_HOLD_MS = 1200`, overlay clears and scanner resumes

### Low-light and scan-assist logic

While the camera is live and idle, the scanner also runs preview analysis:

- brightness analysis
- glare ratio analysis
- shadow ratio analysis
- edge score analysis

That drives user guidance such as:

- `Move closer`
- `Hold steady`
- `Adjust angle`
- `Low light detected - turn on torch`

## 4. API Integration

### Endpoint used

Default live endpoint:

- `POST /api/attendance/scan`

Compatible alias:

- `POST /api/scan-attendance`

The frontend default now matches the main server route.

### Request body

The request body is built in [src/lib/attendanceSync.ts](../../src/lib/attendanceSync.ts).

Example live request:

```json
{
  "qr_code": "{\"studentId\":\"LIB123\",\"libraryId\":\"LIB001\"}",
  "student_id": "LIB123",
  "device_id": "LIB_GATE_01",
  "library_id": "0f4f8c4b-1111-2222-3333-444444444444",
  "library_access_key": "LIB-8X29KQ",
  "entry_id": "LIB_GATE_01-2026-04-08T10-34-12.123Z",
  "timestamp": "2026-04-08T10:34:12.123Z",
  "status": "pending"
}
```

Important details:

- raw QR string always goes in `qr_code`
- parsed student identifier is sent as `student_id` when it differs from `qr_code`
- `entry_id` is generated client-side for idempotency and replay safety

### Device identity and token

- device id comes from `VITE_SCAN_DEVICE_ID`, fallback `LIB_GATE_01`
- device name comes from `VITE_SCAN_DEVICE_NAME`
- device token is sent in header `x-device-token` when `VITE_SCAN_DEVICE_TOKEN` exists

### Network fallback behavior

If direct fetch fails:

- `404` -> fallback to Supabase Edge Function `scan-attendance`
- `>=500` -> tries Edge Function fallback
- network `TypeError` -> tries Edge Function fallback
- offline / transport failure -> queue in IndexedDB

Offline-first addition:

- recent successful students are cached locally in [src/lib/offlineVerifiedStudentCache.ts](../../src/lib/offlineVerifiedStudentCache.ts)
- if the internet is down, the kiosk can still show an `offline verified` queued result for:
  - any cached student
  - or any valid signed QR token

## 5. Backend Flow

### HTTP entrypoint

`POST /api/attendance/scan` in [server/index.ts](../../server/index.ts) calls:

1. `handleAttendanceScan`
2. `resolveScanAttendanceRequest(process.env, req.body, { deviceToken })`

### Server validation order

The server validates in this order:

1. env contains Supabase URL and service role key
2. request contains `qr_code`, `device_id`, `entry_id`
3. request contains `library_access_key`
4. `library_access_keys` validates the kiosk library
5. `entry_devices` validates device active state and library ownership
6. optional device token hash is checked
7. `parseStudentQrPayload(...)` validates the QR again on the server
8. student target is resolved
9. attendance RPC is called
10. response is normalized and returned

### QR validation

The live system now validates QR on both client and server.

Client-side validation purpose:

- reject obvious invalid scans early
- catch wrong-library or expired QR before request
- build a stable `student_id` for duplicate prevention and request shape

Server-side validation purpose:

- final trust boundary
- device and library enforcement
- signature verification at the actual write boundary

### Attendance write flow

The database attendance flow is still controlled by migrations in [supabase/migrations/](../../supabase/migrations/).

Current behavior:

1. validate device and library
2. resolve student by student id or QR code
3. reject inactive or expired access
4. enforce idempotent `entry_id`
5. if open attendance exists, process check-out
6. otherwise process check-in
7. write `attendance_logs`
8. update related student activity fields

## 6. Error Handling

### If QR is not detected

Behavior:

- no API request fires
- worker decode loop keeps running on `requestAnimationFrame(...)`
- adaptive scan pacing keeps decode fast on healthy devices
- scan-assist hints continue updating

No full restart happens during normal idle scanning.

### If QR is invalid

Client-side invalid scan result:

```json
{
  "status": "error",
  "code": "INVALID_QR",
  "message": "Invalid ID."
}
```

Other possible error codes:

- `WRONG_LIBRARY`
- `EXPIRED`
- `DEVICE_BLOCKED`
- `INVALID_LIBRARY_ID`
- `TOO_FREQUENT`
- `ENTRY_CONFLICT`
- `SERVER_ERROR`

### If API fails

Transport or offline behavior:

- scan queues locally in IndexedDB
- if the student is cached or the QR is a valid signed token, UI shows `offline verified`
- otherwise UI shows the standard queued result
- background sync retries later

Hard API failure behavior:

- UI shows error overlay
- scanner stays paused during result hold
- scanner resumes after hold unless redirect to device setup is required

### If device binding becomes invalid

If the server returns a binding reset code:

- `INVALID_LIBRARY_ID`
- `WRONG_LIBRARY`
- `DEVICE_BLOCKED`

Then the scanner does not resume normal scan flow. It redirects to `/setup-device` after the error display.

## 7. Performance And Limits

### Live timing values

| Behavior | Value |
| --- | --- |
| camera preview runtime | `2 fps` inside `html5-qrcode` |
| worker fast scan interval | adaptive by device tier, typically `28-40 ms` |
| worker balanced interval | adaptive by device tier, typically `44-62 ms` |
| worker slow interval | adaptive by device tier, typically `68-92 ms` |
| ROI target size | adaptive by device tier and lighting, typically `320-448 px` |
| scan-assist interval | `850 ms` |
| duplicate suppression | `3000 ms` |
| result hold | `1200 ms` |
| API timeout | `8000 ms` |
| heartbeat interval | `30000 ms` |

### Detection improvements now active

The live scanner now includes:

- worker-based frame processing
- `BarcodeDetector` primary detection when available
- `jsQR` fallback on cropped frames
- ROI-only downscaled capture
- device-tier-aware ROI sizing
- grayscale / contrast / threshold retry passes, including stronger low-light boost
- guidance hints from live frame analysis
- torch support when camera/browser allows it
- offline verified queue feedback for cached or signed IDs
- pause/resume instead of stop/rebuild on every normal scan
- rolling scan latency metrics exported to `window.__LIBRIOFY_SCAN_METRICS__`
- optional on-device debug overlay with `?scanDebug=1`

### Practical latency expectation

Under normal conditions:

- worker decode usually completes within a few tens of milliseconds
- good QR cards should usually detect within `1 s`
- result overlay intentionally blocks new scans for `1.2 s`
- slow devices can automatically downgrade from `Sharp rear camera` to `Balanced` or `Performance` profiles
- once a downgraded device stays healthy and fast for long enough, the scanner can step back up to a sharper profile during idle time
- real-device tuning should read:
  - `scan-latency` logs for per-scan timings
  - `scan-session-metrics` logs every 5 scans
  - `window.__LIBRIOFY_SCAN_METRICS__` or `?scanDebug=1` overlay for rolling averages

## 8. Watchdog And Recovery Logic

This is the main stability fix.

### What the watchdog now watches

The live watchdog no longer reloads the page on elapsed uptime.

It now checks only real unhealthy states:

- camera stream lost
- no new video frames for `8000 ms`
- verification phase stuck for `15000 ms`

Poll interval:

- `WATCHDOG_POLL_INTERVAL_MS = 2000`

Recovery cooldown:

- `WATCHDOG_RECOVERY_COOLDOWN_MS = 15000`

### Recovery behavior

If the watchdog fires:

- console log `watchdog-trigger` is emitted
- the active scan run is invalidated
- normal stale async results are ignored

Recovery actions:

- `camera_stream_lost` -> soft stop + start scanner
- `no_frames` -> soft stop + start scanner
- `scan_verification_stalled` -> show recovery error, then resume scanner

Important difference from the old behavior:

- no `window.location.reload()`
- no normal idle-scan restart loop
- no elapsed-since-ready restart during healthy scanning

## 9. Debug Logging

Live scanner logs now include:

- `scan-worker-ready`
- `scan-worker-error`
- `scan-capture-failed`
- `scanner-start-requested`
- `scanner-ready`
- `scanner-pause`
- `scanner-stop`
- `scanner-resume-requested`
- `qr-detected`
- `scan-processing-start`
- `scan-submit`
- `scan-submit-result`
- `scan-submit-failed`
- `scan-latency`
- `scan-session-metrics`
- `scan-duplicate-ignored`
- `adaptive-profile-downgrade`
- `adaptive-profile-upgrade`
- `watchdog-trigger`
- `scan-invalidated`

All logs use prefix:

```txt
[scan-kiosk]
```

### Real-device tuning workflow

For live Android or tablet tuning, open:

```txt
/scan?scanDebug=1
```

That enables an in-app debug card showing:

- detected device tier
- rolling average decode / verify / total latency
- last ROI capture size
- last worker loop interval
- last camera profile
- whether low-light assist was active on the last scan

Recommended field test loop:

1. Present the QR immediately after the scanner shows `Ready to scan`.
2. Run 10 scans in normal light.
3. Run 10 scans in low light with torch off.
4. Run 10 scans in low light with torch on, if supported.
5. Compare `avg decode`, `avg verify`, and `avg total`.
6. If decode climbs too high on a weak device, confirm the camera profile downgraded and ROI shrank.
7. If low-light false negatives remain high, look for `low-light assist` in the overlay and verify the torch prompt is appearing.

## 10. Real Test Data

Accepted raw QR fixture already in repo:

```json
{"studentId":"LIB123","libraryId":"LIB001"}
```

Example successful API response shape:

```json
{
  "status": "success",
  "success": true,
  "action": "check-in",
  "name": "Aman Kumar",
  "studentName": "Aman Kumar",
  "seat": "A-12",
  "time": "10:10 AM",
  "message": "Checked in successfully"
}
```

Example queued response shape:

```json
{
  "status": "queued",
  "message": "Offline verified. Attendance is saved locally and will sync automatically.",
  "time": "10:10 AM",
  "entry_id": "LIB_GATE_01-2026-04-08T10-10-00.000Z",
  "verifiedOffline": true,
  "studentName": "Aman Kumar",
  "seat": "A-12"
}
```

## Current Remaining Risks

The scanner is much more reliable now, but a few limits still exist:

- `html5-qrcode` still owns the preview element, so camera lifecycle is not fully custom yet
- camera quality still depends on real device autofocus and browser support
- if the signing public key is missing or wrong, client and server will both reject signed QR validation
- large bundle size warnings still exist in production build, although scanner build is green

## Current Fix Status

The scanner mismatch and stability issues are now addressed:

1. `/scan` now uses [src/pages/ScanPage.tsx](../../src/pages/ScanPage.tsx)
2. worker-based `BarcodeDetector` + `jsQR` hybrid decode is live
3. scan flow is pause -> verify -> result -> resume
4. duplicate prevention and offline verified queueing are active without full restart
5. watchdog now recovers only on stream loss, no-frame stalls, or verification stalls
6. debug logging is live for worker, detect, start/stop, adaptive profile, and watchdog events
