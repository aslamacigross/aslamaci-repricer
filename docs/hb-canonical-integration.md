# HB cash economy: canonical integration (FAZ 2D.30B)

Integration base: Products release96979df. Merge the complete HB ancestry
4e2c9e4 ->0bf68ff ->b6480d8 ->2a23581, preserving both Products request ownership
and cash/commission/UNKNOWN displays. Original branches are not rewritten.

Defaults stay OFF / empty allowlist / null contract / empty worker declaration.
Existing floor/identity flags remain false, pilot allowlist empty. OFF is legacy
behavior, not evidence that net-only HB economics are correct. Finance ingestion
is unchanged. Commission VAT is applied once only in the cash economic model.

## Schema and release gate

042 startup and OFF runtime work without hb_cash_economics. The 044 SQL remains
DRAFT, not an active .up.sql; 043 recovery is excluded. SHADOW/ENFORCE require a
separately reviewed/promoted migration and separate user approval. Preserve the
live ledger's two historical extra033/034names; never delete/reapply them.

New canonical integration tests: frontend98PASS; backend1008PASS/7realPGskips;
real PostgreSQL17.6 suite195PASS/0skip (overlaps backend); actual Node start with
scheduler disabled on disposable042schema: health200, no cash column, max042.
ESLint/build/diff must pass before review. Tests use mocked provider POSTs.

## FAZ 2D.31: pilot and scale plan (not activation)

1. Separately approve OFF merge/push/auto-deployment. Re-read current migration
ledger, deployment/SHA and in-flight receipts. Temporarily constrain only new
TY/HB automatic dispatch under separate approval; preserve verification/orders/
stock/supplier jobs and restore exact prior settings. This reduces risk but is
not a dispatch barrier or proof of quiescence. Ten-second shutdown, external POST
vs DB receipt, and mixed-worker races remain. No blind rollback.
2. Review 044 nullable JSONB design, final numbering/order, compatibility and
backup/forward recovery. Apply only with explicit migration authorization.
3. Prove all scheduler/executor/cache writers run the approved SHA. Worker protocol
configuration is a declaration, not fencing. Mixed-version activation unsupported.
4. Exact MerchantID+merchantSku+hbSku, physical recipe, fresh authenticated SKU
commission, versioned contract/VAT/rounding, own listing, reviewed expense and
commission-base evidence, destination shipping and open-action checks are required.
5. Separately authorize one-SKU SHADOW comparison; no new dispatch permission.
Reconcile gross commission/contribution/floor with receipts. No inference from
historical271under-floor/10negative scenarios to a current authorized price list.
6. Separately authorize one-SKU ENFORCE with target/max movement, stop conditions
and monitoring. Revoke scope/mode safely for unsent actions; continue verification
of sent receipts. Recompute economic caches before returning to legacy authority.
Floor Recovery flags/pilot activation remain a separate authorization.

The current maximum3tuples and five-minute commission-base evidence remain intact.
They are pilot limits, not finished catalog automation. For catalog scale a separate
feature needs provider/merchant-scoped evidence acquisition (including real campaign
base and supported fees), durable provenance+timestamps+versioned contract, bounded
refresh queues/rate limits, reliable freshness/invalidation on rate/base/expense/
policy changes, atomic economic cache+fingerprint updates, coverage/UNKNOWN alerts,
and cohort rollout controls. Never invent campaign evidence or extend TTL to make
hundreds of SKUs eligible. Cost completeness and physical mapping remain independent
prerequisites. Finance actual cash settlements must not receive VAT a second time.

Recovery reconciliation/UNKNOWN/fencing is not implemented by this integration.
Reconcile container/action repository semantics separately on the new canonical base.
Permanent dispatch gate, active-work tracking and bounded drain stay separate work.
