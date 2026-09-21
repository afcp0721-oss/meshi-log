# Isolated live test environment

Production configuration is unchanged. Deploy this entry point only with
`npx wrangler deploy --config wrangler.staging.jsonc`.

The staging D1 database was created on 2026-09-22, with an empty activity_records
table matching the current production table definition (read from sqlite_master).
No production records were copied. This is not a final database design.

Configure secrets in the **meshi-log-staging** Worker only:
- GEMINI_API_KEY: Gemini key authorized for testing.
- DISCORD_WEBHOOK_URL: webhook for a separate test channel.
- STAGING_PASSWORD: strong ASCII test password, entered by the owner.

Without all three secrets the Worker returns 503 and makes no external calls.
Every route requires HTTP Basic authentication, username `tester`.
Frontend and API share one origin, staging localStorage keys are separate,
and all responses bypass caching. Test photos are sent to Gemini and to the
configured Discord test channel only when the owner exercises those actions.
Never attach the production D1 binding or the production Discord webhook.

Pending: Worker creation/deployment, owner secret setup, and real photo E2E.
The UI-only sample site does not use this environment.
