# HB cash economics runtime — FAZ 2D.29

This branch descends from 2D.27 b6480d8 (which already includes 2D.26
0bf68ff). Do not cherry-pick those two ancestors independently. This task
creates local code/commits only. No production configuration, migration or
business data has been changed.

## Economic contract and modes

`HEPSIBURADA_CASH_ECONOMY_MODE=OFF` is the default. OFF keeps legacy scalar
pricing; that is NOT a claim that net-only commission economics is correct.
`SHADOW` computes and caches a separate comparison without replacing scalar
minimum/profit or granting an action new dispatch authority. `ENFORCE` projects
the verified cash model into CostEngine caches and all existing HB price-action
paths. No new price endpoint, scheduler, approval bypass or direct dispatch exists.

`HEPSIBURADA_CASH_ALLOWLIST=[]` denies the new economic model everywhere. At most
three exact tuples `{marketplace:"HEPSIBURADA",merchantId,merchantSku,hbSku}`;
no names, barcodes, aliases or logistics accounts as identity. This is independent
from the existing identity/floor flags and pilot list, whose defaults stay false,
false and []. Cash economics never grants the BUYBOX_MISSING exception itself.
A rank-UNKNOWN floor action requires BOTH scope contracts and the existing floor
flag. No scope entry means legacy behavior, not global activation.

`HEPSIBURADA_CASH_CONTRACT=null` by default. Activation requires separately
reviewed merchant contract evidence: source, document SHA256, revision, validity
range, EXCLUDED rate basis, LISTING_PRICE base, invoice VAT evidence and rounding
profile. SKU rates remain the original authenticated merchant-scoped provider
rates. The API is not claimed to return a VAT boolean. A conflicting inclusive
claim fails closed; pure cash math also supports an explicitly inclusive rate
without adding tax twice. NET_THEN_VAT_2DP and GROSS_RATE_2DP remain separate.
The three prior invoice/category fixtures are reused, not recollected.

The contract additionally needs:

- `expenseEvidence`: HB_REVIEWED_EXPENSE_PROFILE, exact merchant, revision,
  exact merchantSku/hbSku, checkedAt within24h, otherCostsKnown=true, nonnegative
  otherVerifiedCosts. Accepts one profile or an array of exact per-SKU profiles;
  missing/duplicate/other-SKU profiles fail closed.
  Packaging/service/current shipping are independently rechecked against DB rules.
- `pricingBaseEvidence`: an exact merchant/SKU tuple with HB_REVIEWED_SKU_BASE,
  revision, checkedAt within5min, LISTING_PRICE_NO_CAMPAIGN and explicitly zero
  seller/HB-funded discounts. This is OPERATOR-REVIEWED evidence, not invented
  provider fields. The current schema/API chain cannot prove arbitrary current
  campaign bases. Unknown, stale, ambiguous or nonzero campaign evidence blocks
  this runtime scope. Unallocated campaign/return credits never lower the floor.
  Verified special SKU commission rates are retained; category rates are not used.

These profiles are not populated with live values by this task. They require a
separate read-only business-evidence review and explicit activation approval.
Actual campaign settlement/net profit remains distinct from conservative pricing.
Finance ingestion/reporting is unchanged; no VAT is added to provider financial
commission amounts.

## Runtime chain

CostEngine performs its existing raw cost refresh, then a bounded (max3 SKU)
provider GET/evidence refresh. For an owned bulk refresh, remote reads complete
before the cache transaction takes row locks; all local evidence is then rechecked
against the new raw costs. For opted-in modes the whole cache write operation is one
transaction; an existing caller's transaction client is reused (that caller must
budget the additional bounded remote-read time for its already-held locks). Independent PG readers
cannot see a temporary net-only floor. OFF without an applied cash cache requires
no new schema. A previous ENFORCE cache cannot silently become legacy dispatch:
mode/scope rollback requires an explicit normal cost refresh.

The original commission_rate is never overwritten. Cache JSON holds legacy and
cash views, net/VAT/gross amounts, source/contract/base/expense proof, mode,
version, revision/fingerprint and freshness. ENFORCE unknown evidence sets
cash min/profit/margin NULL and data_complete=false; the unsafe legacy view stays
separate. The Products API exposes the JSON via p.*; the drawer labels gross
commission and included VAT separately and shows UNKNOWN. Dashboard scalar
consumers use the refreshed cache; Finance history is outside this integration.

The destination floor enumerates actual shipping intervals, including399.99
boundaries, then checks exact rounded commission and >=target contribution.
It is a cost floor, not always current price+0.01. Target shipping/profit are
re-evaluated for ordinary acquisition, retention, hidden-floor, manual preview and
Floor Recovery proposals. Pricing strategies and other marketplaces are unchanged.

Preview -> transactional product-scoped generation -> single/batch approval ->
executor -> receipt carry HB_CASH_RUNTIME_V1, policy revision, fingerprint and
source evidence. Existing actions do not gain cash authority by flipping a flag.
Editing a frozen scoped target requires a fresh preview. Explicit MANUAL actions
retain their existing human approval rules; automatic paths require AUTOMATIC
and both auto_update permissions. No policy is changed by valuation.

After the LAST own-listing/commission GET, the executor repeats current source,
recipe, shipping/expenses, exact identity, mode, scope, stock, product policy,
open actions, global safety and target-profit checks under transaction locks.
There is no further GET before POST. A change during GET blocks dispatch.
Receipt/audit-failure and UNKNOWN/SENDING/AWAITING_RESULT safeguards are preserved.
Confirmation refreshes scoped cash caches atomically with the verified price;
provider-result verification continues even after mode/scope is disabled.

## Schema and rollout limits

`src/db/migrations/044_hb_cash_economy.DRAFT.sql` proposes ONE nullable JSONB
column on products. It is a draft, not a .up.sql file; startup does not execute it.
It was applied ONLY in disposable tests. Active migration max stays042.
Parked recovery043 remains untouched. Final number, migration/up/down review,
shared-ledger check and application need separate user approval. No downgrade is
proposed; receipts and historical evidence must be preserved.

ENFORCE additionally requires HEPSIBURADA_CASH_WORKER_PROTOCOL=HB_CASH_RUNTIME_V1.
This declaration is NOT distributed fencing or proof old workers are absent.
New workers reject old/mismatched action evidence. Old binaries do not understand
this contract and may overwrite caches or ignore its guards. Mixed-version cash
activation is UNSUPPORTED: all scheduler/executor/sync workers must first be
verified at the approved SHA with a separately approved transition procedure.
No ownership/fencing, SENDING recovery or graceful-drain implementation is claimed.
The final DB transaction ends before remote POST; that residual race and provider
exactly-once limitation remain. Recovery branch must not be blindly merged.

Rollout: review code with modeOFF/listempty; approve/promote numbered migration
separately; deployOFF under separate push/deploy approval; verify homogeneous
workers; refresh exact-SKU live evidence; separately approve SHADOW; compare
results; separately approve one exact SKU ENFORCE with economic limits and stop
conditions. Floor pilot activation is another permission. 271 historical scenario
SKUs are NOT authorized for repricing.

Rollback/stop: revoke new cash dispatch via separately approved mode/scope change;
previously sent actions keep normal verification. Pending snapshots fail current
scope/version checks. Recompute affected scalar caches before resuming legacy
pricing; OFF means legacy economics, not certified safety. Do not blindly roll
back to an old binary, replay targets or terminalize unknown actions.

## Validation

Isolated runner strips live DB/API environment variables. Provider POSTs are mocks.
PGlite covers deterministic integration, separate real PG17.6 connections cover
MVCC/product+action locks, two generators/executors, last-GET mutation races,
atomic cache visibility, rollback and verification barriers. Final exact results
and failures resolved during development are preserved outside the repo in
`evidence/faz-2d29-20261118/`. No claim that isolated tests are live pilot evidence.
