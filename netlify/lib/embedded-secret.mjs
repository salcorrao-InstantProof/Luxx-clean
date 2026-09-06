// Pilot credentials are NOT shipped in source any more.
//
// v1.4.6 hardcoded the live passcode and, more seriously, the session signing secret here.
// Anyone holding the deployment ZIP could forge a valid session cookie for the live site.
// Both values must now come from the environment:
//
//   LUXX_PASSCODE          the passcode the creator types
//   LUXX_SESSION_SECRET    a long random string used to sign session cookies
//
// Set both in Netlify under Site configuration > Environment variables, then redeploy.
// If either is missing the app fails closed: /api/session reports configured:false and the
// login screen explains what to set, rather than silently running on a public secret.
//
// Generate a session secret with:  node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
export const EMBEDDED_PASSCODE='';
export const EMBEDDED_SESSION_SECRET='';
