# LUXX v1.3.8 — Placement-Specific Routes

This package preserves the verified v1.3.6 Netlify ffmpeg/ffprobe runtime EROFS hotfix and the v1.3.7 monetization-simplification work.

## v1.3.8 change
Tracking routes now encode the exact audience placement. LUXX no longer combines Bio, Pinned Post, regular Post, Video Description, Creator Profile, Message, or Linktree Button into one ambiguous route.

Rule: ONE SOURCE + ONE PLACEMENT + ONE DESTINATION = ONE ROUTE.

The route setup screen now tells the operator the exact tracking-link name to create and the exact placement where it belongs. Placement is fixed by the route and cannot be accidentally changed during verification.

Existing v1.3.7 route records are retained as legacy audit history. When an old route already has a deterministic placement and tracking setup, migration copies that setup into the matching v1.3.8 route before deactivating the legacy route.

Chaturbate remains native-tips only in the active route catalog until a current permitted external-link placement is verified. This prevents LUXX from instructing the operator to place a link where current platform terms may prohibit it.

## Renderer status preserved
The live-runtime resolver does not chmod packaged ffmpeg or ffprobe under Netlify's read-only `/var/task`. Build-time dependency verification remains intact.

## v1.4.0 — Visual Library + Prescription + Learning Upgrade
- Large image-first Library; media itself opens the preview.
- Hero Picks with numeric ranking labels.
- Automatic conservative image optimization/crops on upload; originals preserved.
- Existing-library optimization action.
- Batch authorization for non-quarantined assets.
- SHA-256 exact-duplicate auto-rejection and cleanup.
- Visible Privacy Shield status.
- Results overview with route performance and directional learning.
- Larger CTA engine; three choices shown per prescription.
- Creator / Executive Producer equal-power attribution preserved.
- Placement-specific routes preserved.

## v1.4.0 deployment-gate hotfix — 2026-08-31
Netlify correctly exposed that build-check.mjs still required the obsolete literal UI marker `REVIEW EXISTING`, which was removed when the existing-library workflow became `OPTIMIZE EXISTING PHOTOS` in v1.4.0. The stale marker requirement has been removed. The checker continues to require the actual v1.4.0 existing-library capability (`OPTIMIZE EXISTING PHOTOS`) plus all other current capability markers. No runtime, UI, route, persistence, media, or renderer behavior was changed by this hotfix.

## v1.4.0 deployment-gate hotfix 2 — 2026-08-31
Netlify exposed a second stale build-check requirement: the frontend HTML was still required to contain the literal string `asset-delete`. In v1.4.0 exact duplicate uploads are rejected automatically and the backend delete function remains present, so a frontend `asset-delete` literal is no longer a valid capability check. The checker now validates the current duplicate UI markers (`DELETE DUPLICATE`, `deleteUnusedAsset`) and separately verifies that `netlify/functions/asset-delete.mjs` exists. No app runtime behavior, data model, renderer, routes, or UI was changed.

## v1.4.1 visibility/ranking patch
- Added whole-card OPTIMIZED badge after complete auto-optimized derivative set exists.
- Added visible derivative thumbnail cards and direct-open behavior.
- Added BEST VERSION / RECOMMENDED variant selection using optimization + destination fit.
- Removed misleading default floor score for images without real scoring evidence; now displays NOT SCORED YET.


## v1.4.1 deploy hotfix — Library toolbar restored
- Restored the `mediaHtml()` Library toolbar accidentally dropped during the v1.4.1 best-variant patch.
- Restored visible controls for UPLOAD PHOTOS / VIDEOS, batch AUTHORIZE, OPTIMIZE EXISTING PHOTOS, and IMPORT JSON.
- Kept the build gate requiring OPTIMIZE EXISTING PHOTOS so this regression cannot silently ship again.
- Preserved optimized badges, derivative previews, Best Variant Wins, score-pending behavior, Privacy Shield, placement routes, operator roles, and the Netlify ffmpeg EROFS fix.
- Domain tests: 36/36 PASS. Failure/security tests: 45/45 PASS.


V1.4.2 SUBJECT-BIASED CROP PATCH
- Replaced centered 4:5 / 9:16 crop expressions with subject-biased vertical crop formulas that reduce excess headroom and preserve more of the body.
- Added crop_version: SUBJECT_BIASED_V1 to AUTO_BEST derivatives.
- Optimized/refreshed existing photos can now be re-run so newer crop logic can replace old recommendations.
- Added small UI hints showing subject-biased crop on recommended variants and derivative cards.

V1.4.3 DUPLICATE CLEANUP + VISUAL SCORING PATCH
- Added CLEAN EXACT DUPLICATES toolbar action with safe deletion summary.
- Exact duplicate cleanup groups by master SHA-256, keeps one canonical master, and skips assets protected by history.
- Added progressive visual technical scoring cache in the browser.
- Hero scores now derive from visual metrics when available: brightness, contrast, sharpness, subject coverage, headroom, and balance.
- Added local cache invalidation keyed to recommended variant/thumbnail state.


V1.4.6 ORIENTATION VERIFICATION
- Hard-gated image recommendations to ORIENTATION_VERIFIED_V3 derivatives.
- Added EXIF orientation parser, explicit transpose/flip, output dimension verification, score invalidation, and legacy derivative exclusion.
