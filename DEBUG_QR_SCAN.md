# QR Scan Debug Analysis

## Scope

- Live `/scan` route is `src/App.tsx:41`, `src/App.tsx:86`, `src/App.tsx:126`.
- That route renders `src/pages/ScanKioskPage.tsx`, not the older `src/pages/ScanPage.tsx`.
- So the production scanner path is:
  `ScanKioskPage -> ScanController -> CameraService + ScannerEngine -> scanDecoder.worker.ts`

## Root Cause

The live scanner is slow because the runtime pipeline is too heavy for the current configuration:

1. The camera starts with very aggressive high-resolution profiles first (`2560x1440`, then `1920x1080`) instead of starting from a lighter profile.
2. The decode loop runs on a fixed `45 ms` interval, but only one frame can be in flight at a time, so real scan FPS collapses whenever decode takes longer than the interval.
3. The fallback path is expensive: if native `BarcodeDetector` is unavailable, or if `createImageBitmap(...)` fails, decoding falls back to large-frame `jsQR` work with multiple enhancement passes.
4. After every detection, scanning is intentionally paused for verification plus a `2000 ms` result hold, which makes the scanner feel slower even when detection succeeds.

Primary root cause in one sentence:

`/scan` is running a high-resolution, large-crop, single-flight decode pipeline with an expensive `jsQR` fallback and a mandatory post-scan pause.`

## FPS Info

- Decode scheduling uses `setInterval`, not `requestAnimationFrame`: `src/lib/scan/ScannerEngine.ts:278-287`.
- Configured interval is `45 ms`: `src/lib/scan/ScannerEngine.ts:57`, `src/lib/scan/ScannerEngine.ts:286`.
- Theoretical max decode attempt rate is about `22.2 fps`.
- Real decode rate is lower because `workerBusy` blocks concurrent frame work: `src/lib/scan/ScannerEngine.ts:338-355`.
- Preview analysis adds another timer every `250 ms` (`4 Hz`): `src/lib/scan/ScannerEngine.ts:58`, `src/lib/scan/ScannerEngine.ts:289-300`.
- After a code is detected, the scanner is paused before parsing/submission and does not resume until the result hold finishes: `src/pages/ScanKioskPage.tsx:727-733`, `src/pages/ScanKioskPage.tsx:890-891`.
- Result hold alone is `2000 ms`: `src/pages/ScanKioskPage.tsx:55`.

## Camera Config Issues

- Video is not constrained low. It prefers:
  - `2560x1440 @ ideal 36 / max 60`
  - `1920x1080 @ ideal 30 / max 36`
  - `960x540 @ ideal 15 / max 24`
  Reference: `src/lib/scan/CameraService.ts:38-62`
- Profile selection is effectively broken. `selectProfileOrder()` always returns the same order, so low-end devices still try the heaviest profile first: `src/lib/scan/CameraService.ts:124-137`.
- Candidate building always expands devices with that heavy-first profile order: `src/lib/scan/CameraService.ts:283-316`.
- Autofocus is only enabled if the browser exposes `focusMode: "continuous"`; otherwise there is no stronger focus strategy: `src/lib/scan/CameraService.ts:374-395`.
- Exposure and white balance are also only set when those capabilities exist: `src/lib/scan/CameraService.ts:377-389`.
- Initial permission warmup uses `getUserMedia({ video: true })` with no rear-camera hint or resolution control: `src/lib/scan/CameraService.ts:221-232`.

## Scan Library

- The live `/scan` route does not use `html5-qrcode`.
- Current live library stack is:
  - browser `getUserMedia`
  - custom `ScannerEngine`
  - native `BarcodeDetector` when available
  - `jsQR` fallback in `src/workers/scanDecoder.worker.ts`
- `html5-qrcode` is still installed and older codepaths still exist in the repo, but they are not the live `/scan` runtime.
- This also means the docs describing `src/pages/ScanPage.tsx` are stale relative to the current routed implementation.

## Library Limitations

- Native decode is only attempted on the `ImageBitmap` path: `src/workers/scanDecoder.worker.ts:237-255`.
- If `createImageBitmap(...)` is unavailable or throws, the fallback path sends `ImageData` and uses `jsQR` only, skipping `BarcodeDetector` entirely: `src/lib/scan/ScannerEngine.ts:357-379`, `src/lib/scan/ScannerEngine.ts:382-398`, `src/workers/scanDecoder.worker.ts:285-296`.
- `jsQR` fallback can run up to four passes per frame:
  - direct read
  - contrast-enhanced
  - low-light boost
  - thresholded pass
  Reference: `src/workers/scanDecoder.worker.ts:174-233`
- Each fallback frame also computes brightness and edge metrics first: `src/workers/scanDecoder.worker.ts:125-172`.

## Image Quality Findings

- The decode crop is center-only and then resized to a very large decode target of `720-960 px`: `src/lib/scan/ScannerEngine.ts:67-68`, `src/lib/scan/ScannerEngine.ts:351-363`.
- That large target improves chance of recovery on some poor frames, but it also makes each fallback decode much more expensive.
- Continuous autofocus is best-effort only, not guaranteed: `src/lib/scan/CameraService.ts:374-395`.
- There is no adaptive zoom or stronger focus recovery logic in the live route.
- A preview-analysis loop exists, but `ScanKioskPage` does not pass `onAnalysis`, so low-light / blur insights are computed and then discarded: `src/lib/scan/ScanController.ts:62-65`, `src/pages/ScanKioskPage.tsx:946-960`.
- Torch support exists, but there is no automatic low-light response in the live route: `src/lib/scan/CameraService.ts:336-347`.

## Scan Area

- The scanner is not reading the full frame. It only reads the center ROI: `src/lib/scan/ScannerEngine.ts:314-335`.
- Display scan box size is roughly:
  - mobile: `220-260 px`
  - desktop: `250-300 px`
  Reference: `src/lib/scan/ScannerEngine.ts:61-66`, `src/lib/scan/ScannerEngine.ts:73-77`
- The crop math itself looks correct, but the scan area is intentionally strict and center-biased.
- This helps performance, but it can look like scan failure if the QR is slightly outside the center box.

## Performance Bottlenecks

- Decode is offloaded to a worker, but frame capture is still on the main thread through `createImageBitmap(video, ...)` or canvas readback: `src/lib/scan/ScannerEngine.ts:357-398`.
- On the heavier fallback path, each frame can involve:
  - ROI crop
  - resize to `720-960`
  - image analysis
  - up to three enhanced image copies
  - up to four `jsQR` attempts
- Preview analysis runs every `250 ms` even though the live page does not consume it: `src/lib/scan/ScannerEngine.ts:289-300`, `src/pages/ScanKioskPage.tsx:946-960`.
- UI work is not the main bottleneck. There are normal rerenders and overlay animations, but I did not find any per-frame React rerender tied directly to the scan loop.

## Exact Problem Points

- `src/App.tsx:41`, `src/App.tsx:86`, `src/App.tsx:126`
  Live `/scan` uses `ScanKioskPage`, so older scanner docs and the older `ScanPage.tsx` optimizations are not the active runtime.

- `src/lib/scan/CameraService.ts:38-62`
  Camera profiles are heavy by default.

- `src/lib/scan/CameraService.ts:124-137`
  `selectProfileOrder()` never changes order by device capability.

- `src/lib/scan/CameraService.ts:221-232`
  Warmup stream is generic and uncontrolled.

- `src/lib/scan/ScannerEngine.ts:57`, `src/lib/scan/ScannerEngine.ts:278-287`
  Scan loop is fixed-interval `setInterval(45 ms)`, not `requestAnimationFrame`.

- `src/lib/scan/ScannerEngine.ts:338-355`
  Single in-flight decode via `workerBusy` throttles actual scan FPS.

- `src/lib/scan/ScannerEngine.ts:351-363`
  Decode target size is large (`720-960 px`) for every captured ROI.

- `src/workers/scanDecoder.worker.ts:174-233`
  `jsQR` fallback is multi-pass and expensive.

- `src/workers/scanDecoder.worker.ts:285-296`
  `ImageData` fallback loses native `BarcodeDetector`.

- `src/pages/ScanKioskPage.tsx:727-733`, `src/pages/ScanKioskPage.tsx:890-891`
  Scanner is paused immediately on detection and resumes only after processing finishes.

- `src/pages/ScanKioskPage.tsx:55`
  Additional fixed `2000 ms` hold after each scan.

## Bottom Line

This is mainly a performance-regression issue in the live `/scan` route, not a single isolated bug.

The strongest contributors are:

- heavy-first camera profile selection
- fixed `45 ms` polling with single-flight decode
- large `720-960 px` ROI decode target
- expensive multi-pass `jsQR` fallback
- loss of `BarcodeDetector` on the `ImageData` fallback path
- intentional post-scan pause plus `2 s` result hold

No fixes were applied in this pass.
