# FAZ 2D.27 — HB commission VAT audit and isolated economic draft

## Release decision

**NOT READY for production integration or merge.** The VAT gap is reproduced,
and the isolated calculation/reconciliation component is tested. This commit
does **not** change CostEngine, normal HB pricing, the floor pilot, approval,
executor, financial ingestion, settings or UI. There is no runtime activation
switch or production caller for the new module. `pricingAuthorized` is always
false and its mode is `READ_ONLY_ECONOMIC_DRAFT`.

Do not describe this as a deployed or completed runtime VAT fix. The production
CostEngine still uses the legacy single deduction. Shadow results below expose
the difference; retaining that behavior is not a certification of its safety.

## Evidence and distinctions

The approved Ek-4 V12 PDF was read directly: all five pages state that commissions
are calculated on listing price plus VAT. The membership contract V26 references
the panel, Ek-4/Ek-7 and subsequent changes. This does not replace current SKU
rates with category defaults or establish every current promotion's terms.

Three actual 7 November invoices were reused. The first two had been requested;
a third had also downloaded successfully before interruption. SHA-256 hashes are
in the anonymized invoice fixtures. No customer details, source PDFs, order IDs,
credentials or private workbooks are committed.

| Invoice suffix | Commission net / VAT / gross TL | Campaign net credit TL | Commission return in this invoice TL | Whole invoice payable TL |
| --- | --- | --- | --- | --- |
| 120963 | 397.75 / 79.55 / 477.30 | 367.55 | 0 | 497.51 |
| 120959 | 4340.32 / 868.06 / 5208.38 | 3734.17 | 0 | 3423.11 |
| 120961 | 3454.16 / 690.83 / 4144.99 | 1626.02 | 0 | 5307.32 |

Shipping, collection and service charges are separate. Invoice-level campaign
credits cover multiple charges: they cannot all be subtracted from commission.
Thus commission-only cash after credits is UNKNOWN. Commission VAT is explicitly
20%; the invoice's aggregate tax is not blindly recomputed at 20% for other fees.
The commission expense before VAT is the commission-service VAT base, not the
goods' listing-price commission calculation base.

The three commission workbooks contain 47 lines matching 42 distinct orders in
the 205-order financial export. Two invoice/line sums agree; invoice 120963 has a
0.01 TL difference (477.31 in the workbook, 477.30 in the PDF). A returned order
has an earlier 301.39 TL commission line but zero commission in the later order
export. Its credit/reversal document has not been reconciled. These are separate
limitations, not proof that the commission was never charged.

Three independent order-detail checks support the net-then-VAT rounding profile:

| Physical category / HB SKU | Commission base TL | Net SKU rate | Net / VAT / gross TL |
| --- | --- | --- | --- |
| Coffee / HBCV0000EFT6RK | 1610.72 | 17% | 273.82 / 54.76 / 328.58 |
| Cologne / HBCV000075ZH6J | 340.44 | 17% | 57.87 / 11.57 / 69.44 |
| Room fragrance / HBCV00006BTXN4 | 739.00 | 15% | 110.85 / 22.17 / 133.02 |

The coffee buyer paid 1367.61 and HB funded 243.11; the fragrance buyer paid
626.65 and HB funded 112.35. Using buyer payment alone understates the observed
commission base. The workbook percentage is gross commission divided by buyer
payment (e.g. 24.025855%), **not** a new net SKU commission rate. Supported and
seller-funded discounts must not be conflated. Direct rounding of 1610.72 at
20.4% gives 328.59 rather than the observed 328.58, so rounding is explicit.

## Current code paths

| Path | Existing behavior / finding |
| --- | --- |
| `cost-engine.service.js` SQL projection | Deducts price times product commission once; divides floor by one minus that raw rate. HB VAT gap confirmed with actual 17% and 15% net rates. |
| `domain/pricing.js` | Shared pure net-rate functions; no second commission VAT deduction. Other marketplaces must not receive a global uplift. |
| `domain/repricer.js`, HB action service | Acquisition, retention, hidden floor and normal proposals use the raw product rate and cached minimum. |
| Repricer manual preview and action edit/approval/executor | Raw product rate; inherits gap. Existing state/permission/own-price checks remain necessary. |
| Floor recovery and destination shipping | Raw rate; FAZ 2D.26 separately rejects UNKNOWN/EXCLUDED provider VAT semantics. No fake inclusive boolean is supplied here. |
| Publication preview | Uses context/category rate with shared pricing; separate evidence scope needed before changing it. |
| Product/profit API and dashboard | Consume cached CostEngine economics; inherit its definition and gap. |
| Finance ingestion | Takes provider commission amount once. Its net/gross semantics are not established by zero HB ERP finance records; blindly uplifting it risks double counting. |
| Finance SKU contribution query | Revenue minus commission minus product cost; excludes several CostEngine expenses and is a different contribution definition. |
| Seller campaign economics | No complete verified per-SKU campaign allocation path found. UNKNOWN must not become certified zero. |

No separate existing expense was found that already accounts for the missing HB
commission VAT in the pricing paths. The fixed service fee is a separate fee.
The isolated real CostEngine fixture produces -8.22 at 499 TL, 17%, 310 cost,
94.20 shipping, 5 packaging and 13.19 service. The invoice-compatible commission
adds 16.97 VAT and the isolated cash result is -25.19. No other tax definition or
input-VAT credit changes.

## Catalog scenario, not realized loss

Read-only snapshot: **18 November 2026 03:11:32 Europe/Istanbul**.
686 active/on-sale/stocked HB products across 116 recorded category labels were
scanned. 614 have structurally complete cached costs/recipes/expenses; 72 are
UNKNOWN, not zero-cost products. This is 100% scan coverage and 89.5% calculable
scenario coverage, not physical or supplier evidence certification.

Stored current rates: 13% (31), 15% (139), 17% (503), 18% (5), 22% (8).
No current authenticated SKU commission GET is claimed by this audit. Product
update time is not commission evidence freshness.

Under current ERP listing prices, explicit 20% commission VAT, the recorded
expenses and destination shipping tariffs: 10 products have negative scenario
contribution; 9 were positive in the old model. Bands are 14 in [0,20), 113 in
[20,40), 70 in [40,50), 407 at least 50 TL. 271 are below their scenario floor
(4 below the stored legacy minimum); 66 change shipping interval/cost at the
destination price. All 614 have a scenario floor. 24 have unknown rank; no valid
open HB actions were present in this snapshot. Counts may change naturally.

The catalog SQL uses an upward-rounded conservative starting price and verifies
profit with separately rounded commission/VAT. It is not a claim of the unique
lowest penny. The isolated solver may find a one-cent lower safe result (Earl
Grey 580.89 versus SQL scenario 580.90). Both require independent live evidence
before any proposal. Test/reference prices are not approved live targets.

HB ERP finance ingestion had no orders/transactions, while the actual export
contains 205 orders. None of the 10 negative-scenario SKUs appears in the 47
commission-detail rows. No total historical loss or volume-weighted exposure is
therefore claimed. Current supplier freshness, own listing price and campaign
expenses are additional unresolved conditions for live action.

## Isolated implementation

`hepsiburada-commission-cash.js` preserves original SKU rates, requires explicit
base, VAT basis and rounding profile, and calculates net commission, VAT and gross
expense exactly once using integer money. Inclusive evidence receives no extra
VAT. All shipping/service/packaging/other expense inputs remain separate.

The draft snapshot combines FAZ 2D.26 authenticated exact merchant/SKU evidence
with a separately reviewed merchant-scoped, dated contract/invoice profile and
own-listing evidence. Real API UNKNOWN semantics are not invented booleans.
Missing, stale, conflicting or mismatched evidence blocks. Economic fingerprints
bind rates, base, contract revision and every expense; fresh changed evidence
invalidates a prior snapshot. Input assertions are not an authorization service:
there is no trusted document-profile registry or approval UI in this commit.

Invoice reconciliation validates independent totals, keeps credits/returns
separate and surfaces allocation and rounding blockers. The scenario floor uses
the existing tariff interval solver and rechecks rounded cash profit at the
destination tariff with a bounded fail-closed loop.

This module supplies no preview API, production CostEngine override, action
generation, approval, executor permission or POST. It cannot implement recovery
or turn an unresolved historical price action into SUCCESS/FAILED. Existing
61/180-minute HB/TY verification and receipt/audit protections remain unchanged.

## Remaining integration gates

1. Reconcile current merchant/SKU commission quotes, current contract validity,
   supported/seller-funded discount base, campaign credits and the returned-order
   credit document. Resolve the one-cent invoice discrepancy or preserve an
   explicit reviewed rounding allowance; never silently discard it.
2. Design a trusted versioned merchant economic evidence profile and permission
   model. Synthetic fixture validity dates and provider fields are not live proof.
3. Implement consistent economic-mode/version persistence for CostEngine cache,
   normal proposals, preview, approval, bulk approval, final executor refresh,
   receipt and API/dashboard fields. Do not update only one rate callsite: the
   transaction CostEngine refresh could otherwise restore legacy economics.
4. Expose legacy versus corrected economics separately. A future pricing rollout
   must be independently default OFF with explicit exact-tuple limited scope;
   no global activation or reinterpretation of stored 17 as 20.4. Existing two
   HB flags remain OFF and the allowlist empty. This commit adds no live flag.
5. Reconcile remaining expenses, current own price, stock, recipe, supplier
   freshness, MANUAL/two auto_update policies and open actions for each pilot.
6. No schema/status/migration is added here; source maximum remains 042. The
   production evidence/cache design may need schema changes and requires a new
   migration decision, not an unsupported claim of migration-free integration.
   Parked 043 recovery draft is untouched; no migration number is reserved here.

## Tests and isolated DB boundary

Final backend: 948 cases, **945 PASS / 3 explicitly skipped / 0 failed**.
The three skipped PGlite cases are real multi-connection tests, separately passed
on disposable PostgreSQL 17.6. Real-PG lifecycle package: **128/128 PASS**, including
6 new commission/CostEngine/rollback cases. New unit cases: **47/47 PASS** within
the backend package. Frontend **84/84 PASS**; ESLint, production build and diff
check passed. Counts overlap and must not be added as independent coverage.

All provider POSTs are mocked. Test environment excludes live DB URLs/credentials.
The local PostgreSQL listens only on a marked temporary Unix socket, creates
random per-test databases, and uses separate reader/writer connections. After
tests, zero test databases remained; the server stopped successfully and its
temporary root was removed. This proves snapshot invalidation and preserved
existing lifecycle guards, not external exactly-once delivery or distributed
provider/DB atomicity. Existing final-check-to-POST and shutdown risks remain.

## Git isolation and follow-up

Base is FAZ 2D.26 commit `0bf68ff7d3e89026a05e7b4801db1df3f935a408`,
itself based on released `4e2c9e4eeb79340b26afe8a7401b4c3d0f88e8e6`.
No recovery branch code is copied or merged. No runtime production file is
modified except adding the unreferenced domain draft; the existing PostgreSQL
test runner gains one test file. No package lock or pricing algorithm is changed.

Recovery's shared container/repository/state semantics remain future integration
risks inherited from FAZ 2D.26, not solved here. Complete the commission economic
contract/runtime integration separately before approving any merge or pilot.
Technical FF ancestry alone does not make this partial draft merge-ready.

Separate TY Harras risk remains: 18 November 03:16 snapshot price 1071.53,
stored minimum 1225.68, current-model contribution -84.11 TL, #476 x4 at 225 each,
AUTOMATIC/two auto_update true, historical #54910 SENDING unchanged. One order in
30 days (6 November), none since release; actual current TY listing price is not
independently checked here. A separately approved, freshly verified single-SKU
seller-panel upward price protection is an option to review, not an operation
performed or a replay of the old target. Delisting could lose sales and needs
separate stock/sync/reopening safeguards. No Harras action is repaired here.
