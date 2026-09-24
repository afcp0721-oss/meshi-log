# Security rollout

Phone/SMS authentication supersedes the invite-code proposal in PR #15. Do not deploy that old PR or configure INVITE_USERS. Follow PHONE-LOGIN-SETUP.md for the replacement.

The new Worker fails closed if FIREBASE_PROJECT_ID, PHONE_USERS or either rate-limit binding is missing. No D1 schema or image-retention change. Gemini calls stay server-side with the key in a header. Personal Discord webhooks remain per-device settings and are sent only to the Worker.

Rate limits: ACCESS_LIMITER 60 requests/minute/IP; AI_LIMITER 6 AI requests/minute/canonical user. They are approximate and local to each Cloudflare location, NOT global daily quotas or a hard spending cap. A request can analyse 3 photos. SMS is sent directly via Firebase, so these Worker limits do NOT limit SMS spending. Use provider-side SMS region restrictions, quotas and budget alerts (alerts do not cap spending).

Pages excludes backend assets, but the GitHub repository and history are still PUBLIC. This patch does not hide published source or make the Gemini instructions a black box to GitHub readers. Privatization remains a separate decision. One historical fixed test Discord webhook was found; if still active, retire it. Never print current personal webhook URLs or Gemini keys in logs.

Bearer verification checks Google signature, issuer, audience, expiry, issued/authentication times, phone provider and approved Firebase UID. Removing/ disabling a PHONE_USERS entry blocks subsequent Worker requests immediately; Firebase console disable/revoke alone is not checked on every request and an issued token can remain valid until expiry. For emergencies update PHONE_USERS as well. Never accept an old record ID supplied by an unverified caller.
