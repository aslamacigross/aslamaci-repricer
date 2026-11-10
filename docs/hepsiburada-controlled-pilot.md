# FAZ 2D.18 — HB controlled pilot contract

This replaces the operational flag/scope contract from FAZ 2D.16. No live
activation, repair, migration, merge or deployment is performed by this work.

## Defaults and exact scope

- `HEPSIBURADA_STRICT_MERCHANT_IDENTITY_ENABLED=false`
- `HEPSIBURADA_SAFE_FLOOR_RECOVERY_ENABLED=false`
- `HEPSIBURADA_PILOT_ALLOWLIST=[]`

The allowlist is a JSON array of **at most three** exact tuples. Empty, malformed,
duplicate, mismatching configured merchant or missing identity/permissions means
no pilot authority. Example with placeholders, not approved live SKUs:

```json
[
  {
    "marketplace": "HEPSIBURADA",
    "merchantId": "verified-configured-merchant-id",
    "merchantSku": "exact-merchant-SKU",
    "hbSku": "exact-HB-SKU",
    "identity": true,
    "floorRecovery": false
  }
]
```

Flags OFF preserve legacy identity/pricing eligibility. The HB submission-bookkeeping
safety correction intentionally remains active independently of these flags: an
accepted/uncertain POST is no longer misclassified as FAILED. This lifecycle
error correction does not grant any new pricing or pilot permission.

Both permission booleans are required. Each global switch gates only its own
entry permission. The product must have explicit `merchant_sku` AND `hb_sku`;
barcode or generic platform-ID fallback is insufficient for pilot admission.
SKU casing, letters O and digits 0 remain distinct. Names, categories, aliases,
logistics accounts and fuzzy matching never grant scope. The merchant must match
the configured merchant; this is not a discovery or alias-verification service.
All four flag combinations are covered independently.

Outside identity scope, official Buybox sync uses the legacy parser/name matching.
Inside it, strict rank parsing requires the actual configured provider merchant
ID; a matching display name alone is insufficient. Missing/ambiguous identity
keeps rank unknown. Conflicting own merchant/seller IDs are persisted in the
existing `buybox_error_code` and block the pilot. Authenticated own-listing GETs
require both exact SKUs; any returned conflicting merchant/seller ID vetoes them.
A merchant ID need not be echoed by the GET, whose URL is already merchant-scoped.

Strict identity observations carry `HEPSIBURADA_OFFICIAL_API:STRICT:<revision>` in
the existing free-text `buybox_source` metadata. Revoked/stale strict observations
cannot silently authorize new automated actions as legacy data. A normal legacy
sync outside the scope can replace them with a fresh legacy observation. No new
table, parallel store or migration is introduced. Explicit legacy manual-price
requests without pilot proof remain their existing, separately authorized path.

Identity-only activation can enable existing competitive acquisition/retention,
price reductions and ordinary floor proposals via restored rank. It is NOT a
read-only mode and does not enable the new destination-floor exception. Verify
normal pricing inputs/targets for identity pilot SKUs too. At final dispatch,
identity-only actions also revalidate source evidence and the profit at the
proposed target shipping tariff. An unsafe ordinary target is blocked, never
automatically raised using a floor feature that is off. No live alias-to-ID
relationship or logistics-account relationship is claimed established here.

## Lifecycle and last external GET

Server-side scope proofs in existing `safety_checks.hbPilot` bind the exact tuple,
used feature permissions and a canonical configuration revision. JSONB key
ordering cannot change the comparison. Scope/config changes require a new preview;
old actions do not become approved or acquire pilot permission on activation.

Preview and generation check scope. New pilot action creation serializes on the
product row and repeats preview/open-action checks using the leased transaction
client. Ordinary actions outside the pilot retain their existing idempotency key.
Single/bulk approvals recheck the current exact scope and AUTO/two auto_update
permissions. Editing a pilot target requires a fresh preview rather than an
implicit manual-edit escape hatch.

Executor checks scope at preparation and after the last own-listing GET. The
final action-row transaction rereads product policy, two update permissions,
activity/stock, current source/recipe, commission/expenses, shipping/target,
open actions and fingerprint. Floor evaluation reuses the just-observed listing:
there is **no further HTTP GET after that final DB validation**. Current scope and
local feature permission are checked again after evidence reads. A policy/cost/
allowlist change during the last GET therefore blocks dispatch in tests.

The final DB transaction commits before the external POST. DB and provider are
not atomic; a narrow check-to-POST race remains. An additional SELECT is not
fencing, provider cancellation or exactly-once delivery. SENDING is a durable
state claim, not a lease or owner token. Rate limiting and worker `running` flags
remain process-local; the pilot does not prove an aggregate multi-worker quota.

## Accepted, unknown and local bookkeeping failures

Before POST, SENDING and `HB_PRICE_DISPATCH_INTENT` are committed together. A
failure of that transaction leaves the action approved and sends nothing.

After a known upload ID returns, AWAITING_RESULT, the dispatch receipt and normal
SENT audit are written together. If the audit transaction fails, a bounded
fallback records AWAITING_RESULT with the same upload ID and an explicit
`api_response.auditPending=true` receipt (actor, action, before/after transition,
time, accepted outcome). Normal result verification continues; SUCCESS is not
claimed until provider completion plus own-price verification. The audit debt is
not silently cleared and needs separately authorized operational review. If a
commit actually succeeded before its connection failed, receipt replay preserves
an already AWAITING_RESULT/SUCCESS record for that same batch instead of rewinding
it. A conflicting terminal status or different batch cannot be overwritten.

If the provider may have received the request but no reliable response exists,
SENDING remains open with UNKNOWN evidence where writable. If both receipt writes
fail after acceptance, the previously durable SENDING + dispatch intent remain.
Neither condition becomes FAILED/SUCCESS, frees `findOpen`, or resends the old
target. The automatic job also preserves these uncertain outcomes instead of
terminalizing them in its generic error handler. Missing persistence is surfaced
as `HB_SUBMISSION_PERSISTENCE_UNCERTAIN`; an unknown external result as
`HB_SUBMISSION_OUTCOME_UNKNOWN`.

This deliberately may leave a SKU blocked pending reconciliation. It is NOT a
completed SENDING-recovery apply feature. No `RECONCILED_UNKNOWN` is copied, no
new terminal state is invented, and no repair/retry endpoint is added. Closing
such a record still requires the separate recovery work, its ownership protocol,
any approved schema changes and separate live authorization. A historical/current
GET price alone is not proof that an old POST was or was not sent.

After scope/flags close, already sent AWAITING_RESULT actions keep result
verification. Confirmation requires the same own merchant/SKU identity; a changed
merchant must not confirm another merchant's listing. The existing transactional
CostEngine refresh for a confirmed HB floor SKU is preserved, including rollback
on refresh failure. Receipt/audit-debt evidence survives verification.

## Pricing constraints retained

Shared CostEngine, pricing and repricer domain formulas are unchanged. The floor
path still requires valid integer recipe quantities, current approved LIVE source
pricing/tier evidence, commission/packaging/fees, existing desi semantics and
current own price. `last_seen_at` alone is not source freshness. Manual/OTHER,
stale/unavailable/mismatching sources and missing costs do not obtain an exception.

Only BUYBOX_MISSING may be removed, and only for a strictly upward, target-profit-
safe floor action with all other safeguards intact. Known-rank floor proposals
receive no Buybox exception. Positive/fresh Buybox price, cooldown, rate limits,
open actions, market mismatch, AUTO/MANUAL and both auto_update permissions remain.
Target shipping is selected in the target's actual tariff interval; inconsistent
or missing safe targets block. Fixture targets 569.14 / 582.34 / 486.34 are isolated
test values, not live prices. The 69 historically incomplete HB products and old
13-SKU snapshot are not an approved pilot list.

## Reproducible database gates

The normal backend suite runs deterministic PGlite/mocks. The same lifecycle
suite can run against **real PostgreSQL**, with independent connections and no
JavaScript transaction serialization:

```sh
ASLAMACI_DISPOSABLE_PG_ROOT=/tmp/aslamaci-<isolated-test-directory> \
ASLAMACI_DISPOSABLE_PG_PORT=55481 pnpm test:hb:postgres
```

The directory must be a private disposable Unix-socket PostgreSQL instance owned
by the tester, user `pilot_test`, with marker `.aslamaci-disposable` containing
`HB_ISOLATED_TEST_ONLY`. The helper refuses remote URLs/hosts, uses random test
databases and drops each after closing pools. The runner removes DATABASE_URL/PG
connection environment settings and refuses to silently fall back to PGlite.
Existing migrations through 042 initialize only these disposable databases.
No new migration or shared/live migration is used.

Development used integrity-verified `@embedded-postgres/darwin-arm64` package
17.6.0-beta.15 in `/tmp/aslamaci-faz2d18-postgres`, PostgreSQL reporting 17.6.
No global package or persistent service was installed. All provider calls are
mocks. Two distinct pg_backend_pid values verify separate database sessions.
Concurrency tests include independent generators, competing executor claims,
last-GET edits, tariffs, receipt/idempotency, audit/DB rollback and delayed/unknown
responses. PGlite results are not presented as PostgreSQL concurrency evidence.

## Rollout and rollback gates

1. Review and separately authorize merge, then separately authorize deployment.
   Ship both switches OFF with an empty allowlist. Confirm every worker's build.
2. Drain/stop old binaries before any pilot activation. A version-2D.16 worker
   interprets the old global floor flag without this allowlist. New row checks
   cannot revoke a paused old worker's preexisting authority. Mixed-version
   activation is **NOT supported**. An existing SENDING claim is not taken over.
3. Read-only verify actual Merchant ID/provider payload, any claimed aliases,
   explicit own SKUs/price, source freshness and physical identity, commission,
   packaging/shipping policies, settings and all open actions. No live identity
   or supplier evidence is fabricated by this development.
4. Obtain separate approval for 1–3 named tuples and each feature/price policy.
   Activate only those entry permissions. Existing HB mutation gates and global
   repricer policy remain additional requirements; these flags do not enable them.
5. Confirm upload/result, own price, minimum/profit/destination shipping, audit and
   other-SKU isolation before any separately approved expansion.

Environment config is process-loaded, not a central hot-reload kill switch.
Removal/disable is enforced by workers using the current config; shutdown/drain
of workers retaining old config is mandatory. Close new generation/dispatch,
drain in-flight workers, and continue verification of accepted submissions.
An already accepted POST cannot be undone by flag closure. Code rollback does not
restore marketplace prices, strict rank data or receipts; price reversal requires
its own current safe preview/approval. Keep audit/receipts and inspect uncertain
outcomes; do not blindly retry or automatically terminalize SENDING.

## FAZ 2D.14 integration boundary

Do not merge the parked sending-recovery branch into this work. Its terminal
UNKNOWN guards and proposed 043 ownership schema are separate and its apply is
unfinished. This branch needs no migration. In future integration, preserve all
UNKNOWN late-write/retry protections, HB receipt expected-state checks,
transactional CostEngine refresh, scope checks and leased client use. Test the
combined state machine, late replies, two-worker paths, audit rollback and TY/HB
isolation. Complete/review the bounded HB pilot work first; integrate completed
recovery work onto the then-current release under a separate approval. A clean
FF-only ancestry check is not an operational merge approval.

## FAZ 2D.18 validation record

| Gate | Result | Backend |
| --- | --- | --- |
| Focused pilot/identity/floor/sync/executor/repricer/Storage | 222/222 PASS | PGlite and mocks |
| Full backend | 795/795 PASS, 0 skipped | Existing isolated test harnesses |
| HB lifecycle/concurrency, independent connections | 51/51 PASS, 0 skipped | Disposable PostgreSQL 17.6 |
| Full frontend | 84/84 PASS, 12 files | Vitest/jsdom |
| ESLint / Vite production build / git diff --check | PASS | Local only |

Focused and lifecycle tests overlap full-backend scenarios; these counts must
not be summed as distinct tests. Every provider POST is mocked. The two last-GET
source/policy regression controls that failed in the read-only audit now block
before POST. Additional cases exercise empty/revoked scope, both flag combinations,
wrong IDs, identity-only target-cost validation, audit debt, receipt replay,
unknown outcomes and preserved provider-429 pacing.

This is code readiness for merge review, not authorization or proof of live pilot
readiness. It does not claim revocation of old binaries, atomic DB/provider work,
exactly-once delivery, completed SENDING reconciliation or verified live aliases.

Hardening file inventory:

- Config/wiring: `.env.example`, `package.json`, `src/config/env.js`, `src/container.js`.
- Scope contract: `src/domain/hepsiburada-pilot.js`.
- Lifecycle: `src/services/sync.service.js`, `src/services/repricer.service.js`,
  `src/services/action.service.js`, `src/services/hepsiburada-floor-recovery.service.js`,
  `src/services/hepsiburada-action.service.js`, `src/services/hepsiburada-auto-repricer.service.js`.
- Persistence: `src/repositories/action.repository.js`, `src/repositories/audit.repository.js`.
- Test runner/helpers: `scripts/test-hb-postgres.js`, `tests/helpers/disposable-postgres.js`,
  `tests/helpers/hepsiburada-pilot.js`.
- Tests: `tests/unit/hepsiburada-pilot.test.js`, `tests/unit/hepsiburada-buybox-sync.test.js`,
  `tests/unit/hepsiburada-auto-repricer.test.js`,
  `tests/integration/hepsiburada-floor-recovery.test.js`,
  `tests/integration/hepsiburada-floor-lifecycle.test.js`,
  `tests/integration/hepsiburada-action-execution.test.js`.
- Contract/history: this document and `docs/hepsiburada-safe-floor-recovery.md`.
