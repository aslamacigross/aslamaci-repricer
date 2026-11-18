# FAZ 2D.26 — SKU commission evidence contract

## Problem and scope

Normal HB sync reads merchant-scoped commission rows and writes the numeric
`products.commission_rate`, with a legacy listing-rate fallback. It does not write
`commission_rules`, or persist dedicated commission provenance, VAT semantics and
check time. The floor pilot previously required a matching category rule. Thus a
valid SKU rate alone could not pass the pilot's independent expense check.

The category check was an independent safety check introduced with the floor
pilot, not a provider guarantee that every SKU has the category's rate. Normal
sync and CostEngine use the product rate. CostEngine's contribution formula
deducts `price * commission_rate / 100` once; it does not separately reconcile
commission VAT or recoverable input VAT. None of those formulas changes here.

This change accepts independently observed **SKU** evidence instead of inventing
category rules. It changes no sync/import, merchant identity matching, mappings,
source selection, shipping formulas, target profit or ordinary HB/TY permissions.

## Evidence and exact identity

`HepsiburadaService.readCommissionForPrice` uses the existing authenticated
`GET /commissions/merchantid/{configuredMerchant}?skuList={exactHbSku}`. It adds no
mutation endpoint and never sends a price. It rejects missing/padded identifiers
before GET. The strict parser is separate from permissive legacy sync parsing.

Exactly one matching provider row is required, with exact HB SKU. Every supplied
merchant SKU / merchant ID / HB SKU alias must agree. If the response omits a
merchant ID or merchant SKU, the authenticated merchant-scoped request plus the
independent own-listing exact-tuple check supply that binding; no seller name,
category, barcode, fuzzy match or logistics account does so. An HB-SKU-only public
catalog response is not a permitted input source. Alternate undocumented shapes
fail closed rather than use legacy parser fallback.

Evidence carries version, source, request scope, merchant ID, merchant SKU, HB SKU,
rate, commission VAT basis, observed check time and an economic fingerprint.
The rate must be finite, positive, below 100 and equal to the current stored rate.
Duplicate rows and conflicting rates/identifiers are not silently resolved.
Freshness is at most **five minutes**, without future timestamps. Check time is
the successful authenticated GET observation, not product `updated_at`, supplier
`last_seen_at`, a previous sync time or a claimed historical price timestamp.

## VAT is a live evidence gate, not an inferred tax rule

Only **explicitly VAT-inclusive commission evidence** compatible with the existing
single-deduction formula is accepted. Missing semantics produce UNKNOWN; exclusive
semantics are recorded as EXCLUDED. Both block with
`HB_FLOOR_COMMISSION_VAT_UNVERIFIED`. Generic product VAT fields are ignored. No
assumed 20% uplift, input-VAT credit, commission category fallback or accounting
formula change is introduced.

The strict adapter recognizes boolean commission-specific assertions
`commissionRateIncludesVat`, `commissionVatIncluded` or `commission.vatIncluded`.
This is a **consumer contract**, not a claim that today's HB API emits those
fields. Conflicting or non-boolean assertions block. Actual provider schema and
their meaning must be verified before using them in a live pilot. If HB's real
response contains only a percentage, it remains blocked. A portal column marked
“KDV Hariç” cannot establish an inclusive deduction. Ordinary imported numeric
rates are therefore not retroactively certified by this change.

Authoritative commission VAT semantics, real marketplace deductions, recoverable
VAT and the intended contribution-accounting basis remain an explicit commercial
and accounting reconciliation gate. If the actual provider cannot supply this
contract, a separately reviewed provider adapter/authoritative evidence model is
needed. Do not enable a pilot just because the category-table blocker disappears.

## Lifecycle and persistence without migration

Preview and generation obtain fresh evidence. Its economic fingerprint is part
of the floor lifecycle fingerprint; timestamps are not part of the economic hash,
so refreshing identical evidence does not manufacture stale actions. The snapshot
and check time are stored in existing
`safety_checks.hbFloorRecovery.commission`. Approval (including bulk approval)
checks that snapshot's freshness, current product rate, exact identity and hash.
A stale/changed/missing snapshot needs a new preview. Approval does not perform
provider HTTP inside its action-row transaction.

Executor obtains fresh commission evidence again **after** the final own-listing
GET, then passes both observations to final DB validation. Missing final evidence
is rejected before opening that transaction. Final validation performs no HTTP;
it reloads cost/source/expense/target and policy data and compares the action
fingerprint. A commission/supplier/policy/tariff change during either final GET
blocks before POST. Identity-only pilot dispatch also requires the independently
verified commission and target-tariff profit, without receiving a floor exception.

The existing submission receipt records the final proof in
`api_response.floorPreflight.commission`. Existing accepted/UNKNOWN handling,
upload IDs, `auditPending`, open-action barriers and verification stay intact.
No old SENDING or AWAITING_RESULT action is re-sent or automatically reconciled.

No new table, migration, status, flag, allowlist entry or scheduler is introduced.
Source migration maximum stays **042**. The parked recovery branch's
`043_sending_recovery.DRAFT.sql` is untouched. Defaults remain both HB flags OFF
and an empty exact-tuple allowlist. Ordinary non-pilot HB dispatch performs no new
commission GET. Identity-only remains an active pricing permission, not read-only.

## Limits and rollout gates

The final DB transaction ends before external POST. Provider/DB atomicity,
cross-process fencing and exactly-once delivery are not supplied by this change.
A policy, cost, provider price or commission can change in that residual window.
Existing worker-drain and unknown-SENDING recovery gaps are not solved here.
Additional GET load is restricted to the enabled exact pilot scope; provider 429
or unavailable evidence fails closed. No broad catalog sync is triggered.

Merge, push, deploy, migrations, flag activation and live price updates each stay
outside FAZ 2D.26's authorization. A future pilot additionally needs verified live
merchant/listing identity, provider VAT contract, supplier freshness, commission,
shipping/service/campaign expenses, activity/stock and open-action inventory. The
historical 13 November prices in tests are synthetic fixtures, not current targets.

The new branch starts at released `4e2c9e4`. It does not import parked recovery
commits. That branch still needs a separate integration/review against current
release, preserving UNKNOWN terminal protections and HB transaction/receipt
semantics in its shared `container.js` and `action.repository.js` changes. No
recovery ownership/fencing capability is implied by this commission fix.

## Validation

New domain/adapter cases cover exact O/0-sensitive tuples, wrong merchant/SKUs,
missing/invalid/conflicting rates, ambiguous rows, freshness, VAT semantics and
economic fingerprint stability. Lifecycle cases cover zero category rules,
preview/approval/receipt snapshots, missing/stale approval proofs and changes
during the last commission GET. Existing shipping-boundary, AUTO/two auto_update,
flag/allowlist, concurrent generator/executor, rollback, audit debt, UNKNOWN,
61/180-minute provider verification and TY isolation regressions are retained.

Real PostgreSQL tests use `tests/helpers/disposable-postgres.js`: an explicitly
marked temporary Unix-socket server, random per-file databases, separate pool
connections and mocked providers. No Railway connection URL is accepted. The
same lifecycle tests in the full backend suite use PGlite, so those results must
not be added to the real-PG count as independent scenarios.

Validation on 17 November 2026: backend **895/895**, frontend **84/84**,
focused **358/358**, real PostgreSQL **122/122**, ESLint, production build and
diff check passed. The first full backend run lacked generated frontend assets;
after the production build the complete backend run passed. No test assertion
was removed for that prerequisite. Provider POSTs in these suites are mocked.
The disposable PostgreSQL server was stopped after verifying that zero per-test
databases remained, and its temporary files were removed. Logs are outside the
repository at `/tmp/aslamaci-faz2d26-validation/`.
