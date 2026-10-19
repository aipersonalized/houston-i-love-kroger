# Install and use the companion skill

## Detailed Content

### 1. Get the app and the skill

This is an authored development candidate. Original project materials use the
repository's MIT LICENSE. A public deployment and reviewed release are not
established by this folder. Use the actual
address or project files supplied by the operator; a proposed project URL is not
proof that the site exists.

For normal shopping you need a working app installation, a browser with
JavaScript, and internet access. You do not need an AI account. Read
`research/official_docs/pages/USER_GUIDE.md` in full for the human shopping steps.
To run the app on your own computer, read
`research/official_docs/pages/SELF_HOSTING.md` in full. It gives ordered Node/npm,
private configuration, startup and troubleshooting steps. Credentials belong to
the operator's private server settings, never to the skill or a chat message.

### 2. Make the skill available to your assistant

1. Find the complete `skills/houston-i-love-kroger` folder in the project files.
   Keep its `SKILL.md`, playbooks, references, schemas and documentation snapshot
   together. Copying only `SKILL.md` leaves its instructions incomplete.
2. Check your assistant's actual instructions for adding local skills. If it has
   a supported skills-folder or import feature, add this complete folder using
   that feature. This guide does not assume one vendor's folder or import UI.
3. If your assistant can read local project files but has no skill importer,
   explicitly tell it to read this folder's `SKILL.md`. That is manual use, not a
   claim that automatic discovery or persistent installation succeeded.
4. Start or refresh the assistant session only as its own instructions require.
   Ask it to describe this skill's task and required inputs. Expect an exact-store
   promotion comparison, an actual app URL and a permitted data channel.
5. If it cannot read the folder, use the web page yourself. This bundle supplies
   no browser extension, provider plugin or remote tool connection.

No `agents/openai.yaml`, provider API key or particular model is required by the
portable core. Automatic discovery has not been tested across assistant hosts.
The optional Python documentation utilities are for maintainers, not shoppers.

### 3. Establish the permitted data path

Tell the assistant the actual app base URL, including its folder path and ending
slash. You do not need to send it API credentials. The assistant needs an existing
browser or HTTP tool that can use the installation's documented interface.

Before catalog results enter an agent, host, logs or external model service, the
operator must establish the applicable source permission for those recipients.
This differs from simply asking an assistant to help. A permitted local agent
does not automatically authorize remote forwarding, and agents are not
universally prohibited. Read `references/source-permissions.md` in full for that
decision. Keep underlying agreements and private account records outside chat.

If the needed permission or transport is unavailable, the assistant can still
explain setup and guide your own page use. It must not load disallowed raw data
and try to redact it afterward.

### 4. Ask for a comparison

A useful request is: "Use this installation to help me choose my exact store,
then show its starter promotion sample ordered by dollar savings." Supply the
app address separately through your normal allowed channel.

1. Enter a five-digit ZIP through the input channel allowed by your privacy
   rules. If it must stay outside the model, use an existing suitable private
   adapter or enter it yourself in the app.
2. Choose a returned store by its full name, address and complete store ID. Do
   not let a similar name or first search result silently choose your location.
3. The starter sample queries milk, bread and eggs, up to 15 products each. It is
   a limited starting point, not all promotions at the store.
4. Ask for a specific grocery or brand to refine it: 3–80 characters, no more
   than eight words. A single term requests up to 50 products.
5. Choose dollar savings, percentage off or lowest promo selling price. Reordering
   already received results does not require a new product search.
6. Read the full description, package identity, selected store, source price pair,
   retrieval time and missing-information notes before acting on an offer.

Regular and promo prices are reported values. Savings are calculated from that
current pair. Unit estimates have no known normalized measure unless a source
explicitly supplies one; package size is not a substitute. Stock is advisory.
Confirm price, product, conditions and availability with the store before buying.
The skill does not place orders, use a cart or clip coupons.

### 5. Understand history and recover

History begins empty and shopping requests do not populate it. Permission
pending, no observations, one observation, incompatible context, a failed read
and a certification/production mismatch are distinct outcomes. A past price or
trend is not invented when one is missing. A collected low covers retained prior
observations only. Operator collection and retention instructions are in
`research/official_docs/pages/HISTORY.md`; ordinary shopping does not run them.

If setup is required, ask the operator to finish API settings privately. If a
search is busy or limited, wait for the displayed delay. If no qualifying offers
are returned, try another term or the starter sample. If catalog permission for
the chosen agent is unresolved, use the human page or an already permitted
local path. A rejected connection never requires posting credentials in chat.

## Key Concepts

- **App installation:** the working page and backend at the operator's actual URL.
- **Skill installation:** making this folder readable through a host's supported
  mechanism; it does not deploy the app or grant data rights.
- **Operational candidate:** authored procedures with bounded local checks;
  observed agent performance and live entitlement remain separate.

## Decision Criteria

| Need | Use |
|---|---|
| Shop directly | Collected human user guide and the actual app page. |
| Add the skill | Your assistant's verified import/read mechanism. |
| Run a local app | Collected self-hosting guide. |
| Missing source permission or private adapter | Human guidance or a permitted local path, without raw model exposure. |
| Repair an installation | Setup procedure; preserve secrets and existing data. |

## Constraints & Limits

No host-specific installation, browser/assistive-technology combination, public
deployment or live account is qualified by these instructions. Do not assume a
skill import installs tools, configures credentials or allows catalog forwarding.
Consult the repository's licensing information before redistributing software
or copied source documentation.

## Common Patterns

Begin with setup/status when access is uncertain. Reuse an accepted store and
permission scope when they still match. Keep a request bounded to the person's
actual shopping question and finish with the store, scope, evidence and limits.
