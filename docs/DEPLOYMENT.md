# LUXX v1.7.0 RC3 — ZERO-SURPRISE RELEASE — Netlify Manual Deployment

Launch date: Monday, September 7, 2026. Deploy to the EXISTING LUXX site only.

No GitHub connection is required.

## Preferred one-time deployment
1. Sign in directly to Netlify on a computer.
2. Open `https://app.netlify.com/drop`.
3. Drag/drop the final LUXX project ZIP.
4. Stay logged in. Netlify's current Drag & Drop flow can accept a project that still needs a build step and run that build before publishing.
5. Wait for the deployment to complete.
6. Open the generated `https://<site>.netlify.app` URL.
7. Enter the passcode you set in the `LUXX_PASSCODE` environment variable.
8. Open that same HTTPS URL in iPhone Safari and choose **Share → Add to Home Screen**.

## Persistence design
LUXX uses site-wide Netlify Blob stores for:
- state;
- asset records;
- processing jobs;
- immutable original chunks;
- thumbnails/posters;
- HLS preview files;
- rendered MP4 derivative chunks.

The code deployment and the media/state stores are separate. A normal code redeploy should not replace site-wide Blob data. The production acceptance checklist explicitly verifies this with a second deploy.

## Large videos
The browser slices large media into 3.5 MB chunks so a single function request does not contain the full source video. The original is fully persisted before processing begins. A background processing function reassembles the master, verifies the SHA-256, performs technical analysis, renders a main cut and teaser derivatives, creates previews, and saves all outputs back to durable storage.

## Credentials
The passcode and session secret are NOT embedded. `LUXX_PASSCODE` and `LUXX_SESSION_SECRET` must both be set as Netlify environment variables before the first deploy, or the app fails closed step. Keep the source ZIP private. Netlify environment variables `LUXX_PASSCODE` and `LUXX_SESSION_SECRET` can override those embedded values later to rotate credentials.

## First production test
Do not import the full library immediately. Run `docs/ACCEPTANCE_TESTS.md` Section B first with one real photo and the real the full source duration test video.


## Update deployment

Redeploy this source ZIP to the SAME Netlify site. Site-wide Blob stores remain
associated with that site, so existing state and media survive an application
update. After redeploy, open LIBRARY once; any legacy asset with blank eligibility
and no manual override is automatically migrated to LUXX_AUTO destination planning.

## Release-candidate handling for v1.7.0 RC3

This package is a release candidate for independent review. Do not deploy it until
it has been inspected.

After deployment, two SETUP steps must be completed before the Monday pilot:

1. **CAM AVAILABILITY.** The creator's exact weekday availability is entered in
   SETUP. Nothing is hard-coded. Until it is set, TODAY shows
   `SETUP REQUIRED — CAM AVAILABILITY NOT FINALIZED`, schedules no LIVE job and
   assumes no time. Saturday and Sunday cannot be enabled from anywhere.

2. **IMPORT BASELINE → REVIEW → CAPTURE BASELINE → LOCK BASELINE.** The import
   populates the existing baseline review fields and stops. It never captures,
   never locks, and refuses to overwrite a locked baseline. A metric the operator
   could not obtain is stored as NOT AVAILABLE and is never converted to zero.

PRODUCE ships OFF. A shoot is prescribed only once a Library or funnel gap has been
documented with counted evidence against the reviewed Library.
