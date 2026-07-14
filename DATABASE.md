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

### `004_market_price_verification`

- Ürün ayarlarına mevcut günlük limiti koruyarak ayrı `max_single_change_pct` alanı ekler.
- Aksiyonlara gönderim öncesi pazar fiyatı, kontrol zamanı, batch kontrol zamanı ve doğrulama hatası alanlarını ekler.
- Doğrulama bekleyen aksiyonlar için partial index ekler.
- Mevcut ürün, aksiyon ve öğrenme kayıtlarını silmez.

### `005_operational_controls`

- `maintenance_mode=false` sistem ayarını idempotent olarak ekler.
- Yeni yazımlarda negatif maliyet/desi, sıfır mapping adedi, geçersiz komisyon, bozuk barem/ambalaj aralığı ve geçersiz aksiyon fiyatını engelleyen `NOT VALID` check constraintleri ekler; mevcut satırları migration sırasında reddetmez.
- Mevcut ürün, mapping, aksiyon ve öğrenme kayıtlarına dokunmaz.

### `006` - `010`

- `006_special_commission_guard`: ürün komisyon gözlem alanlarını ekler.
- `007_active_product_guard`: Trendyol satışa uygunluk alanlarından aktif ürün durumunu yeniden kurar.
- `008_api_commission_source`: komisyonun tek kaynağını Trendyol API yapar.
- `009_remove_google_sheets_dependency`: Sheet job ve ayarlarını V2 runtime'dan kaldırır.
- `010_product_images`: Trendyol ürün görseli alanını ekler.

### `011_file_market_mapping_automation`

- `file_market_items` ve `file_market_price_history`: File ürünlerinin güncel/önceki fiyatını ve her gözlemi saklar.
- `cost_item_file_links`: onaylı File ürünü ile maliyet kalemi bağını tutar.
- `mapping_suggestions` ve `mapping_suggestion_items`: öneri, güven skoru, kanıt, durum ve reçete satırlarını saklar.
- `cost_items` üzerine fiyat kaynağı, önceki maliyet ve kaynak kontrol zamanı ekler.
- `generate-mapping-suggestions` jobunu kapalı varsayılanla kaydeder.

### `012_mapping_feedback_learning`

- `mapping_feedback_events`: her mapping onayını veya reddini karar anındaki reçete, kanıt, güven skoru, kullanıcı ve ret notuyla immutable olay olarak saklar.
- `mapping_learning_profiles`: marka, kategori, cost code ve File eşleşme türü örüntüsünün toplam onay/ret sayısını tutar.
- `mapping_suggestions` üzerine temel güven, öğrenme etkisi ve stabil öğrenme anahtarı ekler.
- Uygulama readiness kontrolünün beklediği son migration sürümüdür.

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
- Doğrulama bekleyen `repricer_actions(status, sent_at)` partial indexi
- `repricer_observations(barcode, observed_at)`
- `buybox_history(marketplace, barcode, observed_at)`
- `price_change_outcomes(marketplace, barcode, checked_at)`
- `competitor_price_observations(marketplace, barcode, observed_at)`
- `job_runs(job_name, started_at)`
- `file_market_price_history(file_market_item_id, observed_at)`
- `mapping_suggestions(status, confidence, created_at)`
- `mapping_feedback_events(learning_key, created_at)`
- `mapping_feedback_events(decision, created_at)`
- Mapping başına tek bekleyen/onaylı öneriyi koruyan partial unique index

## Atomic Mapping Replace

1. Panel/API isteği tamamen doğrulanır.
2. Satır, duplicate ve zorunlu alan validation yapılır.
3. Cost code ve barkod referansları doğrulanır.
4. Transaction içinde temp staging tablo oluşturulur.
5. Staging tekrar doğrulanır.
6. Yalnızca doğrulama başarılıysa ilgili barkodların marketplace mappingleri değiştirilir.
7. Maliyetler tekrar hesaplanır.

Okuma veya doğrulama hatasında mevcut mapping verisi değişmez.

Akıllı öneri uygulamasında aynı prensip korunur: öneriler kilitlenir, önizleme parmak izi yeniden hesaplanır, hedef ürün ve maliyet kalemleri kilitlenir, mapping satırları eklenir ve tüm etkilenen ürün maliyetleri aynı transaction içinde hesaplanır. Herhangi bir çakışmada bütün işlem geri alınır.

Panelden yapılan barkod kapsamlı toplu işlemde aynı doğrulama uygulanır; yalnızca gönderilen barkodların mappingleri transaction içinde silinip yeniden eklenir. Global replace endpointi ayrıca açık onay metni olmadan çalışmaz.

## Geri Alma

Down migrationlar ters sırada yalnızca ilgili V2 tablolarını, backfill kayıtlarını ve ek kolonları kaldırır. Geçmiş V2 aksiyon verisini sileceği için production'da `pnpm migrate:down` komutu ancak doğrulanmış DB yedeği ve bakım penceresiyle kullanılmalıdır.
