# Match source permission to the actual data recipients

## Detailed Content

Before a stored-data read, establish what this installation and workflow permit.
API availability, public documentation, customer consent and a policy JSON file
are different from a supplier's applicable grant. Reuse a valid earlier review;
do not repeatedly ask for the same authorization.

For the source questions, read
`research/official_docs/pages/KROGER_PERMISSION_REQUEST.md` in full. It is an
unsent draft, not a permission grant. For history's implemented default gate,
read `research/official_docs/pages/HISTORY.md` section "1. Understand the source requirement".

The app makes no built-in request to an external AI service. The companion
queries only our database service, never Kroger or a live product/store route.
Its HTTP tool can nevertheless send stored source records to the tool operator, agent
host, model provider, logs or retained conversation. Determine that actual path
before the first catalog request. A trusted local agent and a remote model are
not automatically the same recipient. This is a fact-dependent check, not a
universal prohibition on agents.

Accept a current, bounded permission result from the operator's appropriate
review or supported private adapter. It identifies the allowed source/purposes,
recipients, fields, processing/retention limits and validity; it need not reveal
agreements, private correspondence or account identifiers to the model. The
user's applicable privacy rules also govern store selection and returned results.

If the selected tool exposes raw responses to a disallowed recipient, choose an
already available permitted local adapter or provide human-use guidance. Do not
read raw data first and then try to redact it. Missing adapter capability is a
specific blocker, not evidence that every agent workflow is forbidden.

## Key Concepts

- **User authorization:** which task and effects the person requested.
- **Source authority:** rights granted by the relevant data source or agreement.
- **Recipient:** every actual processor/viewer, including model/tool services.
- **Bounded permission result:** reviewed scope without disclosure of the
  underlying private agreement or customer information.

## Decision Criteria

| Known condition | Permitted next step | Limit |
|---|---|---|
| No source-record processing permission established | Fixed status/setup or human-use instructions | No record call that exposes data to this agent. |
| Reviewed permission covers this local agent only | Use the permitted local path | Do not forward its payload to a remote provider. |
| Reviewed permission covers actual model/tool recipients | Perform the requested bounded stored read | Honor fields, retention and purpose restrictions. |
| Permission is expired, revoked or outside scope | Return that dependency | A prior successful response does not restore rights. |
| Only synthetic fixture data is used | Clearly labeled deterministic development checks | Never call it live shopping evidence. |

## Constraints & Limits

Do not request agreement text, passwords, secrets or private customer inputs in
chat. Keep source text/prices unchanged and mark separate arithmetic. Do not
store search-derived behavior, create a catalog cache, compare competing
retailers, activate the history collector or send a permission inquiry as part of
ordinary reads. Stale/empty/no-data results never authorize live-source searches
or a collector fallback. A distinct task may authorize operator work; this skill does
not supply that authority or implement the collector.

## Common Patterns

When permission is unknown, explain: "I can check the installation and guide you
through its human page. Stored-record processing through this agent needs the operator's
applicable source permission for the actual data recipients." When scope is
already established, proceed within it without another confirmation loop.
