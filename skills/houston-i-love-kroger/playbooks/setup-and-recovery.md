# Establish a usable stored-data connection or explain its blocker

Guide installation or recovery without exposing credentials, reading a private
database or treating configured source access as populated/fresh service data.

## Continued From

`SKILL.md` setup route or a connection failure from a stored-read procedure.
Setup-only requests finish here; a working connection does not authorize a read.

## Resources

Before installation guidance, read `references/user-guide.md` in full. Before
service status, read `schemas/command-rules.md` section "Stored promotion CLI"
and `references/api_reference.md` in full. For source-recipient questions, read
`references/source-permissions.md` in full. For human app installation, read
`research/official_docs/pages/SELF_HOSTING.md` and
`research/official_docs/pages/PROMOTION_SERVICE.md` in full.

## Step 1: Bound the requested help

Identify skill installation, human app installation, stored-service diagnosis
or a stored read. Use the operator's actual app URL; a proposed public address
does not establish a deployment. Check whether the assistant host can read the
complete skill and run Python or an equivalent permitted stored-read client.

If no suitable client exists, provide human installation instructions and name
the capability gap. Do not switch the agent to browser live searches.

## Step 2: Guide installation or inspect stored-service status

Follow the user guide's ordered skill/tool instructions. For human self-hosting,
use the selected manuals; Node/npm and private service/database configuration
belong to the application operator, not the assistant provider.

The companion needs only the app URL. Do not request a Kroger key or private
service token, inspect `.env`, mount SQLite, post secrets in command arguments,
or alter source registrations/grants. Credentials and grants are configured
privately by the operator.

For an existing installation run `python scripts/promotions.py status
--base-url BASE_URL --json --no-input` from this skill folder, replacing BASE_URL.
This calls only the stored-service status endpoint. Distinguish connection
failure, unavailable service, permission required and available. Available
does not prove the selected store/topic has a completed fresh collection.
Instructions supplied to a person are not completed setup.

## Step 3: Recover according to the observed failure

| Condition | Action |
|---|---|
| Unreachable installation or unavailable service | Operator checks actual app address and private service connection; never expose configuration. |
| `permission_required` | Operator resolves source/recipient authority privately. No record read or live fallback. |
| `no_data` / `no_completed_collection` | Explain that the exact store/topic has no usable completed collection; collection is separate operator work. |
| `snapshot_not_readable` | Explain original/current permission or retention prevents using that completed sample; no older fallback. |
| `stale` | Report snapshot age/threshold and operator dependency; this reader cannot refresh it. |
| Fresh `available` with zero deals | Report a completed empty bounded topic; do not treat it as a connection defect. |
| Invalid input or rejected cursor | Correct the field once; restart only the requested bounded read for a changed snapshot. |
| Busy/quota response | Respect its delay; do not restart services or loop to bypass limits. |
| Unsupported/oversized/malformed response | Discard it and ask the operator to check API compatibility. |

A new historical search is a separate requested task, not recovery for stale
latest data. Do not initialize, replace or populate a database to make a read
succeed. Preserve unknown outcomes and stop repeated unchanged failures.

## Step 4: Return readiness and stop or resume

State the checks actually run, current service state and smallest resolving
action. For setup-only, stop. For an already requested interrupted read, return
the installation, accepted transport/recipients, exact store/topic or history
scope and unresolved dependency to its read procedure for acceptance.

## Gotchas

- A usable app or source credential does not prove stored collection exists.
- The skill requires no AI-provider account, key, model SDK or provider metadata.
- Original project materials use the root MIT LICENSE; copies and instructions
  do not establish a public release, source grant or completed installation.

## Checklist

- [ ] The actual installation, client and requested effects are established.
- [ ] Only stored-service status was used for agent diagnosis.
- [ ] Private credentials, grants and database records remain outside context.
- [ ] Instructions, connection status and fresh populated data are distinct.

## Recovery from interruption

Inspect current permitted service status before repeating a failed check.
Preserve operator processes/accounts/data and avoid replaying uncertain setup.
Resume only the affected check; a read failure never authorizes collection.

## Handoff

Producer: setup procedure. Receiver: caller, or the already requested stored-read
procedure. Deliver installation identity, actual checks, permitted client and
recipients, accepted scope and missing dependencies. The receiver verifies those
facts before use. Stop at the requested setup result or exact blocker.
