# Invite-only rollout

Do not merge/deploy the invite gate before INVITE_USERS is configured on the production Worker. The gate deliberately returns 503 when the secret or either rate binding is missing. Keep the current Worker version for rollback. No D1 schema changes.

## Secret format

INVITE_USERS is a JSON object keyed by SHA-256 hex of each random invite code. Each value is {"userId":"existing_or_new_user_id","expiresAt":"ISO-8601-expiry"}. Use cryptographically random 32-byte base64url codes, one per person. Do not use names/passwords as invite codes. Store hashes, not raw invite codes, in the Worker secret. Never commit either the real map or codes. Set expiration explicitly (for example 30 days); removing a hash revokes access immediately.

Existing records: obtain the existing meshi_user_id from the user's own app Settings before first login; map the invite to that exact ID. Never let an unauthenticated caller claim an existing ID. New users get a random ID. Each invite is bearer access to that user's records; loss/sharing requires revocation and replacement. This is a limited family pilot credential, not a full account or recovery system. A second device may log in with the same valid code; AI name, Discord destination and other browser preferences need reconfiguration.

## Ordered rollout

1. User configures INVITE_USERS as a Cloudflare encrypted secret without exposing the raw codes in chat/screenshots.
2. Validate Worker + browser CI; Wrangler >=4.36 required for ratelimits bindings.
3. Deploy Worker config with ACCESS_LIMITER (60 requests / minute per IP) and AI_LIMITER (6 AI requests / minute per canonical user). Limits are local to each Cloudflare location, approximate and NOT a global daily quota or hard spending cap. A request may contain up to 3 AI image analyses.
4. Deploy matching frontend v16. Settings accepts invite code and keeps it in sessionStorage only. Existing users must log in; no bypass for legacy clients.
5. Check no-auth 401, invalid code 401, missing config 503, identity mismatch 403, foreign-image ownership 404, authorized session and a user-authorized real photo save. Never claim end-to-end passed from mocks alone.
6. Configure provider-side budget alerts/quotas separately if required. No changes to billing made by this patch.

## Source privacy

_config.yml stops Pages from serving known backend files, but the public GitHub repository and its history remain public. Full source privacy requires the separately prepared private-repository migration or GitHub Pro; no obfuscation is a substitute. Old public copies cannot be recalled. Earlier secret scan found one historical Discord webhook; user must rotate it if still active.

## Staging

Staging needs its own INVITE_USERS and rate bindings. Its existing Basic gate remains, so API requests use X-Meshi-Invite as an additional header there. Production accepts only bearer Authorization. Do not share production invite maps with staging.
