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

## Ana İlişkiler

- Ürün anahtarı: `(marketplace, barcode)`
- Mapping: `(marketplace, barcode, cost_item_code)` unique
- Komisyon: `(marketplace, category_id)` unique
- Ürün ayarı: barkod bazlı partial unique index
- Repricer action: unique `idempotency_key`
- Outcome: `(action_id, elapsed_minutes)` unique

## Önemli Indexler

- `products(marketplace, is_active, auto_update, category_id)`
- `products(marketplace, rank, buybox_updated_at)`
- `product_cost_mappings(marketplace, barcode)`
- `repricer_actions(barcode, status, created_at)`
- `repricer_observations(barcode, observed_at)`
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

Down migration yalnızca V2 tablolarını ve ek kolonları kaldırır. Geçmiş V2 aksiyon verisini sileceği için production'da `pnpm migrate:down` komutu ancak doğrulanmış DB yedeği ve bakım penceresiyle kullanılmalıdır.
