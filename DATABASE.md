# Veritabanı

## Migrationlar

### `001_core_schema`

- Mevcut `products`, `cost_items`, `product_cost_mappings`, `shipping_costs`, `shipping_barems`, `packaging_rules`, `product_settings`, `price_war_log`, `buybox_snapshots` tablolarını korur.
- Eksik V2 kolonlarını `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` ile ekler.
- `commission_rules` ve `system_settings` tablolarını oluşturur.
- Mevcut ürün komisyonlarını kategori kuralına backfill eder.
- Global dry-run `true`, repricer `false` varsayılanlarını ekler.

### `002_operations_and_learning`

- `jobs`, `job_runs`, `audit_logs`, `integration_logs`
- `repricer_actions`, `repricer_decisions`, `repricer_observations`, `repricer_outcomes`
- `competitor_price_observations`
- Mevcut `repricer_learning` tablosunu veri kaybetmeden genişletir.
- `buybox_snapshots` geçmişini idempotent biçimde yeni observation tablosuna taşır.

### `003_learning_contracts_and_operations`

- `buybox_history`, `price_change_outcomes`, `repricer_results` ve `dashboard_cache` tablolarını ekler.
- Aksiyonlara hedef/son sıra, buybox sonucu, geri alma ilişkisi ve sonuç kontrol alanlarını ekler.
- Öğrenme tablosuna öğrenilmiş maksimum artış, son sonuç ve strateji bağlamı ekler.
- Eski `price_war_log`, observation ve outcome kayıtlarını idempotent olarak yeni sözleşmelere backfill eder.
- Dashboard cache jobunu, cron ve güvenlik ayarlarını ekler.

## Ana İlişkiler

- Ürün anahtarı: `(marketplace, barcode)`
- Mapping: `(marketplace, barcode, cost_item_code)` unique
- Komisyon: `(marketplace, category_id)` unique
- Ürün ayarı: barkod bazlı partial unique index
- Repricer action: unique `idempotency_key`
- Outcome: `(action_id, elapsed_minutes)` unique
- Repricer sonucu: `action_id` unique
- Geri alma: `reverts_action_id` ve `reverted_by_action_id` self-reference

## Önemli Indexler

- `products(marketplace, is_active, auto_update, category_id)`
- `products(marketplace, rank, buybox_updated_at)`
- `product_cost_mappings(marketplace, barcode)`
- `repricer_actions(barcode, status, created_at)`
- `repricer_observations(barcode, observed_at)`
- `buybox_history(marketplace, barcode, observed_at)`
- `price_change_outcomes(marketplace, barcode, checked_at)`
- `competitor_price_observations(marketplace, barcode, observed_at)`
- `job_runs(job_name, started_at)`

## Atomic Mapping Replace

1. Sheet tamamen okunur.
2. Satır, duplicate ve zorunlu alan validation yapılır.
3. Cost code ve barkod referansları doğrulanır.
4. Transaction içinde temp staging tablo oluşturulur.
5. Staging tekrar doğrulanır.
6. Yalnızca doğrulama başarılıysa eski marketplace mappingleri değiştirilir.
7. Maliyetler tekrar hesaplanır.

Okuma veya doğrulama hatasında mevcut mapping verisi değişmez.

## Geri Alma

Down migrationlar ters sırada yalnızca ilgili V2 tablolarını, backfill kayıtlarını ve ek kolonları kaldırır. Geçmiş V2 aksiyon verisini sileceği için production'da `pnpm migrate:down` komutu ancak doğrulanmış DB yedeği ve bakım penceresiyle kullanılmalıdır.
