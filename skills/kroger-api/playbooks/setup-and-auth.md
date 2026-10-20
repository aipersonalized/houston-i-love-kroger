# Prepare setup and authorization

## Continued From

SKILL.md setup/auth route or an operation design missing authorization inputs.
Accept current relevant sources and the intended client/environment. No private
registration or token execution is authorized by this procedure itself.

## Resources

Read `references/user-guide.md`, `references/api_reference.md` and
`references/data-use-and-security.md` in full. Read the collected Customer and
Service to Service articles and Authorization specification in full for the
selected flow. For account setup, read the collected Applications help in full.

## Step 1: Establish installation and account boundaries

Identify operator versus shopper, hosted versus own-copy intention, needed API
products, actual callback availability and existing registration outcome as
non-sensitive facts. Do not request identifiers or credentials. If an earlier
submission is uncertain, require private receipt reconciliation before another
submission. Deliver source-grounded human instructions from the user guide;
label authenticated UI and private steps as untested.

## Step 2: Select the documented grant

General Products/Locations:confidential client credentials on a trusted server.
Customer Cart/Identity:authorization code with actual customer sign-in/consent.
Browser/native public clients use S256PKCE, fresh verifier/challenge and state;
Auth1.0.17 permits no Basic secret and client_id in token form for public PKCE
clients. Confidential clients retain Basic. Bind exact registered redirect and
assigned public scopes. No frontend/client-secret leakage is acceptable.

## Step 3: Specify lifecycle and failure handling

Validate returned state and denial before exchanging codes. Keep token responses
private. Consume returned expiry; serialize single-use refresh rotation and
replace token pairs atomically. Preserve lifetime/source discrepancies. Specify
denied consent, wrong redirect, unavailable scope, expired/revoked grant and
uncertain exchange recovery. Do not claim browser CORS or client behavior works
until a controlled authorized test observes it.

## Step 4: Deliver the non-sensitive contract

Record environment origin, flow/client type, operation scopes, callback's
existence status (not private query values), secret-storage owner, fixed output
requirements and unverified checks. Stop for setup-only requests. Otherwise hand
the accepted contract to the operation procedure. Actual private execution is
blocked until qualified human/adapter handling exists.

## Gotchas

CE does not provide customer accounts according to API Basics. Do not infer
public scopes from older tutorials, explanatory examples or decoded tokens.

## Checklist

- [ ] Environment/client/grant/scopes bound to sources and actual assignment prerequisite.
- [ ] Human/private steps distinguished from public documentation observations.
- [ ] Denial, expiry/rotation, state and uncertain outcomes addressed.

## Recovery from interruption

Resume from the verified non-sensitive contract. Reconcile uncertain registration
or token exchanges privately; do not replay them or inspect secret-bearing pages.

## Handoff

Producer:setup/auth. Receiver:caller for setup-only, otherwise main operation
procedure. Transfer source versions, intended client/environment, assigned-scope
prerequisites, safe-handling gaps and checks. Receiver verifies identity and
authority; missing source returns to maintenance. Stop at the authorized result.
