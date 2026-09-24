# Security rollout

Email/password + verified email replaces the phone/SMS and invite-code proposals. See [EMAIL-LOGIN-SETUP.md](EMAIL-LOGIN-SETUP.md). Implementation is not production protection until reviewed, configured and deployed.

Worker verifies Firebase RS256 signature, issuer, audience, expiry, issued/authentication times, password provider, verified email and approved UID. Every records/image/save/AI request is identity scoped. Missing security bindings fail closed. Gemini keys remain server-side in request headers; passwords go directly to Firebase. Discord webhooks remain per-device settings, sent only to the Worker.

Personal quota: 5 generation requests per JST day, atomic D1 reservation. Global daily photo/assist units are also bounded. Short-term Cloudflare rate limits are approximate per-location; the D1 daily quota is authoritative. Failed generations consume a reservation. Read/save do not. Firebase registration/email endpoints are separate and require Firebase-side protection and quotas.

GitHub source and history remain PUBLIC. Pages exclusions do not hide the source or Gemini prompts from repository readers. This change does not purchase GitHub Pro or privatize the repository. Retire the historical fixed test webhook if still active. No secrets or passwords should be committed or printed.

Disable access by removing EMAIL_USERS mapping immediately. Firebase revoke/disable alone is not checked on each request; issued tokens may survive until expiry. Existing record-ID migration requires independent operator verification. Do not treat possession of a record ID as proof of ownership.
