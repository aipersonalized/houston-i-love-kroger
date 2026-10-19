# Match source permission to the actual data recipients

## Detailed Content

Before a catalog search, establish what this installation and workflow permit.
API availability, public documentation, customer consent and a policy JSON file
are different from a supplier's applicable grant. Reuse a valid earlier review;
do not repeatedly ask for the same authorization.

For the source questions, read
`research/official_docs/pages/KROGER_PERMISSION_REQUEST.md` in full. It is an
unsent draft, not a permission grant. For history's implemented default gate,
read `research/official_docs/pages/HISTORY.md` section "1. Understand the source requirement".

The app makes no built-in request to an external AI service. A browser or HTTP
tool can nevertheless send its returned catalog to the tool operator, agent
host, model provider, logs or retained conversation. Determine that actual path
before the first catalog request. A trusted local agent and a remote model are
not automatically the same recipient. This is a fact-dependent check, not a
universal prohibition on agents.

Accept a current, bounded permission result from the operator's appropriate
review or supported private adapter. It identifies the allowed source/purposes,
recipients, fields, processing/retention limits and validity; it need not reveal
agreements, private correspondence or account identifiers to the model. The
user's applicable privacy rules also govern ZIP handling and returned results.

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
| No catalog-processing permission established | Status/setup or human-use instructions | No catalog call that exposes data to this agent. |
| Reviewed permission covers this local agent only | Use the permitted local path | Do not forward its payload to a remote provider. |
| Reviewed permission covers actual model/tool recipients | Perform the requested bounded search | Honor fields, retention and purpose restrictions. |
| Permission is expired, revoked or outside scope | Return that dependency | A prior successful response does not restore rights. |
| Only synthetic fixture data is used | Clearly labeled deterministic development checks | Never call it live shopping evidence. |

## Constraints & Limits

Do not request agreement text, passwords, secrets or private customer inputs in
chat. Keep source text/prices unchanged and mark separate arithmetic. Do not
store search-derived behavior, create a catalog cache, compare competing
retailers, activate the history collector or send a permission inquiry as part of
ordinary shopping. A distinct task may authorize operator work; this skill does
not supply that authority or implement the collector.

## Common Patterns

When permission is unknown, explain: "I can check the installation and guide you
through its page. Catalog processing through this agent needs the operator's
applicable source permission for the actual data recipients." When scope is
already established, proceed within it without another confirmation loop.
