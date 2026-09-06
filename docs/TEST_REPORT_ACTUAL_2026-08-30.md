> **v1.7.0 RC3 note.** The full upload is the master at every duration. There is no
> automatic five-minute main cut, and no test or document may assume a fixed source
> length: expectations are derived by probing the actual file.

# LUXX Integrated Hosted v1.3 — Final Actual Test Report

Date: 2026-08-30
Parent source of truth: **LUXX Simplified Revenue Pilot v1.2.1**
Parent SHA-256: `e9d271b68415600f0ec19dc10829dd73f30c4c7e7bcdce25c39279c930d5dc1c`

## Release verdict

**CODE / LOCAL PRODUCTION-MODULE ACCEPTANCE: PASS**

This means the packaged application source, production domain logic, all packaged server endpoints, failure behavior, visible browser controls, media pipeline, persistence model, and the real Creator #001 the full source duration video acceptance case passed in the build environment.

It does **not** mean a live Netlify production URL or the user's physical iPhone Safari has already been certified. Those require deployment to the user's actual Netlify project and are listed in the production gate.

## 1. Inherited LUXX v1.2.1 domain/integrity contract

`tests/DOMAIN_TEST_RESULTS.json`: **30/30 PASS**

Coverage includes baseline capture/lock, fail-closed tracking, SOURCE/ACTION/INTERNAL attribution ceilings, ACTION candidate binding, authorization/availability/platform/historical gates, Pornhub/ManyVids readiness, CTA/timing evidence labels, prescription revision/decline/approval, execution/effort, measurement/corrections, revenue/custom orders, brand-shoot lifecycle, historical-video review/prospective update, candidate-specific learning, import/export, and append-only/frozen-history tamper blocking.

## 2. Server/API functions

`tests/API_TEST_RESULTS.json`: **21/21 PASS**

Functions exercised: health, session, login, state, assets, upload-chunk, thumbnail, upload-complete, asset-update, image-edit, process-media-job, job, start-media-job, variant-update, download-manifest, media-chunk, hls, action, export-data, import-data, logout.

## 3. Failure / security behavior

`tests/FAILURE_TEST_RESULTS.json`: **41/41 PASS**

Includes unauthorized access, invalid/oversize chunks, missing upload parts, missing assets/variants/jobs, traversal attempts, malformed imports, unknown actions, and method restrictions.

## 4. Visible browser application

`tests/BROWSER_TEST_RESULTS.json`: **PASS**

- **22 visible workflow groups passed**.
- **48/48 inline UI handlers resolve**.
- **0 page errors**.
- **0 console errors**.

Coverage includes TODAY/LIBRARY/RESULTS, baseline, health, Library filters, asset edit/save, photo AUTO BEST, edit-an-edit, original download, upload control, routes, prescribe/change/decline/approve/mark-posted, effort, measurement/correction, revenue/custom order, JSON/CSV exports, JSON import, brand-shoot draft/approval, video edit, video preview/platform fields, and historical-video review/update.

The browser runner is policy-blocked from opening localhost/LAN HTTP in this environment, so visible UI behavior is tested with intercepted API responses while the exact production server modules are independently exercised by the API suite. No live Netlify claim is inferred from this.

## 5. Real Creator #001 media acceptance

`tests/MEDIA_TEST_RESULTS.json`: **PASS**

The user's uploaded real master was used and is **not included in the deployment ZIP**.

- real duration: **the probed source duration sec (~the full source duration)**
- bytes: **39,646,692**
- immutable master SHA-256: `be810c63e5672dde1c41415493794b06392f33b3156649108034664a7b2937f3`
- fresh final media-test runtime: **34.535 sec locally**
- rendered main cut: **300 sec (5:00)** — PASS
- rendered teaser count: **3** — PASS
- HLS preview for main and teasers — PASS
- edit of already-rendered MAIN-CUT into second-generation derivative — PASS
- master hash unchanged after processing/re-read — PASS

The segment-selection label remains **TECHNICAL HEURISTIC — not a proven revenue-best segment**. It does not claim to infer desire/attractiveness or statistically proven conversion lift.

## 6. Photo/media persistence acceptance

- multi-chunk payload: **7,321,123 bytes / 3 chunks** — PASS
- reassembled hash match — PASS
- immutable image master hash — PASS
- AUTO BEST derivative — PASS
- edit of AUTO BEST derivative — PASS
- restart/re-read hash preservation — PASS

## 7. Build/static release checks

- consolidated `npm test`: **PASS (44 checks/groups)**
- `npm run build`: PASS
- production JS syntax: PASS
- inline frontend JS syntax: PASS
- exact 3-item primary navigation: PASS
- required visible controls: PASS
- LUXX-only contamination sweep: PASS

## 8. Live deployment boundary

The following must be tested after deployment before calling the system **live/device certified**:
- Netlify build/bundling on the user's project;
- production site-wide Netlify Blobs persistence;
- background media processing on Netlify;
- physical iPhone Safari login;
- real iPhone HEIC upload/thumbnail;
- real iPhone MOV/HEVC processing;
- close/reopen persistence on iPhone;
- persistence after a second production redeploy.

Run `LIVE_IPHONE_ACCEPTANCE.txt` immediately after the first deployment.


## v1.3.1 automatic destination regression
- 34/34 domain/integrity tests PASS.
- 21/21 server/API functions PASS.
- 41/41 failure/security cases PASS.
- 22/22 visible browser workflow groups PASS; 49 inline handlers resolve; zero page/console errors.
- Legacy blank-eligibility migration test PASS: an AUTHORIZED/AVAILABLE image saved under v1.3.0 with empty platform eligibility automatically migrates to LUXX_AUTO with OnlyFans Free primary and OnlyFans Paid secondary.
- X is fail-closed unless face-safe review is explicitly confirmed.
