# FAZ 2D.16 — HB identity and safe floor recovery

## Default and scope

`HEPSIBURADA_SAFE_FLOOR_RECOVERY_ENABLED=false` by default. This server-side
environment flag gates BOTH strict official Buybox identity/rank parsing and the
new HB floor path. It does not open either existing HB mutation gate, enable the
repricer, alter jobs or change product policies. No new endpoint, migration,
source selection, synchronization, cleanup or automatic SENDING repair exists.

With the flag off the old name-matching/normalizer, preview, generator and
executor behavior remains. The legacy array-position rank fallback is retained
only in that old, disabled-feature path for compatibility. With the feature on,
no rank is invented from price, single-seller presence or array position.
Normal competitive price decreases/acquisition/retention and Trendyol domain
pricing code are unchanged. Known-rank HB floor increases also use destination
cost validation when enabled, but receive NO Buybox exception.

## Merchant identity evidence and limits

The existing official normalizer already read merchantId/sellerId, whereas sync
ignored those identifiers and matched only normalized merchantName. Strict mode
now prefers the exact configured permanent ID, independently of display name.
A different ID vetoes a matching name. Conflicting IDs, duplicate own identities,
or missing valid rank stay UNKNOWN. Without an offer ID, the existing configured
name/exact legacy aliases remain the fallback; no new alias or fuzzy match was
introduced. Logistics customer/account identifiers are never seller IDs.

Live read-only Railway metadata was checked on 10 November 2026: release and
preview-v2 are at 2011383896a436001af53c78d7c42e1bae22c6c4, deployment
ad174e1e-375a-4f12-9e7a-3bb7f5fe4d59 SUCCESS. OAuth exposes variable NAMES only.
HEPSIBURADA_MERCHANT_ID exists; HEPSIBURADA_SELLER_NAME/HB_SELLER_NAME were not
listed. Actual ID/credential values were not retrieved, logged or changed.
Existing hardcoded names are AŞLAMACI GROSS, ASLAMACI GROSS and AŞLAMACI BAKLİYAT.
There is no verified historical alias-to-ID registry in this inspected path.

No current raw provider payload was available through the permitted connected
read tools. Therefore: the user's name-change hypothesis, actual old/new names
sharing one ID, the cause of the 34 unknown ranks, and a logistics-account link
are NOT proven. No live SKU is claimed fixed, and the number resolvable by ID is
UNKNOWN. Unit/isolated sync fixtures prove how a verified same-ID rename works;
they are not evidence of this user's actual ID relationship. Never add a second
merchant or alias based on two cargo accounts. Cargo code was not modified.

## Independent evidence and narrow exception

The read-only service is invoked only for opted-in HB floor candidates, in
AUTOMATIC mode with both product/settings auto_update permissions. It keeps all
existing safety failures. For rank NULL it can remove ONLY BUYBOX_MISSING, and
only if that is the sole failure, positive/fresh Buybox price still exists, and:

- Every canonical recipe row exists, is active, has a distinct canonical code
  and a positive integer physical quantity. Cost and aggregate desi must match
  current product inputs; integer manual desi overrides are preserved. Unsupported
  fractional override semantics block instead of being rounded or overwritten.
- Exactly one approved selected supplier offer exists, or exactly one approved
  legacy link is available. Never switch supplier or fall back from an unavailable
  selected offer. Manual/OTHER sources are excluded from this automatic path.
- Supplier AVAILABLE/current price matches canonical price. Freshness is bounded
  to 24 hours: explicit checked_at, verified Bizim product-detail tier evidence,
  or matching FILE API price plus canonical source_checked_at. last_seen_at alone
  is insufficient. Future timestamps and stale/ambiguous sources block.
- Existing verified Bizim quantity tiers are selected by priceTierForQuantity;
  persisted effective cost must agree. SUM(quantity × unit cost) is preserved.
- Product commission matches the current ERP category commission rule; packaging
  matches the current CostEngine-priority rule and SKU service fee is valid and
  at least the configured platform fee. A lower override blocks for review;
  no override is changed. These
  are ERP policy checks, NOT a claim that fresh marketplace invoices/contracts
  have been externally verified. Confirm those policies before live activation.
- Current shipping matches configured carrier/barem/desi inputs. No auto-cheapest
  carrier/source choice is made.
- Authenticated own-merchant Listing GET returns the exact merchant SKU AND HB
  SKU, positive price equal to ERP, positive stock and explicit salability. A
  Buybox price is never substituted for our own listing price.
- There is no other open action. Cooldown, daily limits, locks, blacklist,
  maximum price/increase, expected margin/profit and global gates remain intact.

Missing evidence adds a blocker; it never triggers a sync or data repair.
The phase-2D.15 13-SKU list is a historical snapshot, not an activation allowlist.
All candidates must be freshly evaluated. Old Hipoalerjenik/Sensitive sources
are expected to remain blocked until genuinely verified by authorized operations.

## Destination shipping and profit

The finite interval solver uses the existing calculateMinimumPrice,
calculateNetProfit and selectShippingCost functions. It examines tariff
intervals/boundaries and verifies the resulting candidate in its actual interval;
there is no unbounded fixed-point loop. Overlapping tariffs, missing safe target,
unsupported desi or incompatible limits block. One extra cent is allowed where
the existing commission rounding would otherwise miss the unchanged profit goal.

Deterministic snapshot fixtures: Sensitive two-pack 551.28 → 582.34 with shipping
86.40 → 112.80; white soap 477.16 → 486.34 with 86.40 → 94.20; Obaçay Bergamot
same-interval floor 569.14. These are tests, not new live prices or quotes.

CostEngine formulas are untouched. After the normal remote result verification,
ActionRepository.confirmApplied invokes the existing CostEngine inside its
existing transaction for ONLY the confirmed HB floor action/SKU. Failure rolls
back local success/price updates. This refresh prevents old barem costs from
remaining in product minimum/profit caches after a confirmed boundary crossing.
It does not submit another price, change a recipe, source or override.

## Lifecycle, concurrency and uncertainty

Preview is SELECT + provider GET only. Proof stores a versioned fingerprint,
destination floor/shipping and observation time in existing safety_checks JSON.
No permission is obtained by trusting client-supplied proof; the server rebuilds
all evidence. Standard authentication, CSRF and approval routes are reused.

Floor generation locks the exact product row (including first-action scope),
repeats preview on the SAME leased transaction client, checks open actions,
creates the normal PENDING action and writes its decision in one transaction.
Fingerprint participates in the existing idempotency key. Two new floor
generators serialize without per-component writes or pool-within-transaction
starvation. Source reads are bounded/batched (up to 200 SKUs, 2000 recipe rows;
per-recipe bound 100); tariffs are restricted to the carrier/relevant desis.

Approval retains the normal lifecycle; executor revalidates the saved proof,
price, sources, policies and target before SENDING. It performs current own-price
GET and then repeats source/proof/policy/current-action and own-price checks just
before the existing POST. Legacy, MANUAL/MANUAL_EDIT and reversal actions cannot
acquire this exception. Turning the flag off blocks a previously approved floor
action from dispatch. Results still require provider upload status AND matching
own listing identity/price before SUCCESS. No direct POST endpoint was added.

The usual action row lock prevents simultaneous applies of the same action;
tests exercise competing callers with a deterministic serialized PGlite harness.
This is not a real multi-session PostgreSQL/MVCC or provider exactly-once test.
The pre-existing check-to-POST external timing race and provider retry semantics
are NOT eliminated. No claim/lease/SENDING reconciliation from phase 2D.14 was
implemented or assumed. Late external acceptance may outlive local observation.

The new evidence GETs are sequential and only for floor candidates. Preview and
transactional revalidation intentionally use fresh GETs, as does final preflight.
A 429 starts a floor-read cooldown (at least one minute, default ten), stopping
further evidence GETs in that process. Existing HB submission pacing/rate gates
remain. Cross-process rate budgets remain the provider/operations constraint.

## Rollout, rollback and parked branches

No new schema: active migration maximum remains 042. Phase 2D.14's unregistered
043_sending_recovery.DRAFT.sql and branch 3965f8c were not changed or merged.
Actual shared files are container.js and action.repository.js. Future recovery
executor coordination will also overlap HB execution semantics. Optional client
parameters in ProductRepository/SettingsRepository/Repricer keep transaction
reads on the leased connection; their default call behavior is unchanged.

Recommend reviewing/merging this HB change first with flag OFF, independently
of the unfinished recovery writer. Later recovery integration must preserve both
UNKNOWN terminal guards and transactional floor CostEngine refresh. Never merge
parked branches automatically. Re-run both suites after an authorized integration.

Future steps, EACH requiring the appropriate separate approval:

1. Review code, isolated regressions, evidence gaps and current release ancestry.
2. Merge/push/deploy only when explicitly authorized; flag stays OFF. Drain all
   old worker versions before any activation, so old generators/executors cannot
   consume new identity state without destination-cost checks.
3. Read-only verify the actual Merchant ID/store aliases/provider fields, current
   own prices, source freshness, commission/expense policy and full candidate
   scope. A global flag covers all eligible HB SKUs; do not call it a one-SKU pilot.
4. Obtain explicit activation/candidate-price/automation approval. This task does
   not grant it. Do not change protected MANUAL/auto_update policies to make a
   candidate pass. No source repair/sync is implicit.
5. Rollback first disables the flag/new dispatch and drains in-flight work through
   normal verification. Keep compatible code while floor actions await results;
   do not blindly downgrade to an old binary or manipulate action statuses.

No Railway DB, business records, prices, stock, modes, supplier sync, jobs or live
flags were changed during development. No remote push, merge or deployment.

## Validation on this branch

| Gate | Final result |
| --- | --- |
| Identity/floor/lifecycle + official sync focused package | 98/98 PASS (89 new tests plus 9 existing sync tests) |
| Existing TY/HB repricer/executor regression | 60/60 PASS |
| Storage observation regression | 7/7 PASS |
| Full backend | 727/727 PASS, none skipped |
| Full frontend | 84/84 PASS |
| ESLint / Vite build / diff check | PASS |

All price submissions in tests were mocks. The first full backend run needed a
local Vite build for the existing app-shell/cache-header test; after building,
the final complete suite passed. No test was removed or weakened. The draft
recovery migration was not loaded. Existing migrations ran only inside disposable
PGlite fixtures. Concurrent callers are tested with the documented deterministic
harness, not against a live/multi-session Railway PostgreSQL database.

## Changed-file inventory

- `.env.example`, `src/config/env.js`: one default-off environment flag.
- `src/container.js`: inject floor evidence service and existing CostEngine.
- `src/domain/hepsiburada-merchant-identity.js`: exact identity/listing checks.
- `src/domain/hepsiburada-floor.js`: finite destination-tariff target validation.
- `src/services/hepsiburada-floor-recovery.service.js`: bounded SELECT/GET evidence.
- `src/services/hepsiburada.service.js`, `src/services/sync.service.js`: gated strict identity normalization and matching.
- `src/services/repricer.service.js`: gated preview and atomic normal-action generation.
- `src/services/hepsiburada-action.service.js`: proof checks and ordinary executor/result flow.
- `src/repositories/action.repository.js`: transactional confirmed-price CostEngine refresh.
- `src/repositories/product.repository.js`, `src/repositories/settings.repository.js`: optional leased query client.
- `tests/unit/hepsiburada-merchant-identity.test.js`, `tests/unit/hepsiburada-floor.test.js`: new domain coverage.
- `tests/unit/hepsiburada-buybox-sync.test.js`: two new gated sync cases; old tests retained.
- `tests/integration/hepsiburada-floor-recovery.test.js`, `tests/integration/hepsiburada-floor-lifecycle.test.js`: evidence/lifecycle/concurrency/rollback coverage.
- `docs/hepsiburada-safe-floor-recovery.md`: contract, evidence gaps and rollout.

Read-only three-way merge-tree inspection against phase 2D.14 found a textual
conflict in container.js: floor/repricer wiring and SendingRecoveryService wiring
touch the same construction area. ActionRepository has no textual conflict in
this inspection, but that does not prove semantic compatibility. Both shared
files require an explicitly authorized integration review and combined tests.
No actual merge or conflict resolution was performed. No other branch or
worktree was modified.
