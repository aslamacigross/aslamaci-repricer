# Operasyon Runbook

## Repricer'ı Tamamen Kapatma

Panelde `Sistem Ayarları`:

1. `Global dry-run` açık.
2. `Global repricer` kapalı.

Panel açılamıyorsa DB'de `system_settings` içindeki `global_dry_run=true`, `global_repricer_enabled=false` yapılır. Railway'de ayrıca `DRY_RUN=true`, `REPRICER_ENABLED=false` tutulur.

## Trendyol API Hata Verirse

- Global dry-run açılır ve repricer kapatılır.
- `sync-buybox` ve `sync-products` job sonuçları kontrol edilir.
- 401/403: API key, secret, supplier ID ve User-Agent kontrol edilir.
- 429/5xx: tekrar denemeden önce Trendyol limitleri ve servis durumu beklenir.
- Fiyat aksiyonu `FAILED` ise aynı kayıt körlemesine tekrar gönderilmez; ürünün gerçek Trendyol fiyatı sync ile doğrulanır ve yeni aksiyon üretilir.

## Fiyat Yanlış Giderse

1. Global dry-run açılır, repricer kapatılır.
2. İlgili barkodda `Özel komisyon kilidi` veya ürün fiyat kilidi açılır.
3. `Fiyat Aksiyonları`, audit log ve Trendyol batch ID kaydedilir.
4. Trendyol panelindeki gerçek fiyat doğrulanır.
5. Asıl aksiyon `SUCCESS` durumundaysa `Güvenli geri al` kullanılır; sistem eski fiyata bağlı yeni bir aksiyon oluşturur.
6. Ters aksiyon ayrıca onaylanır. Dry-run kapalı olsa dahi uygulama anında minimum fiyat ve diğer safety kontrolleri yeniden çalışır.
7. Geri alma uygun değilse gerekli düzeltme yeni, açıkça onaylanan manuel aksiyonla yapılır.
8. Eski DB fiyatını doğrudan değiştirerek geçmiş gizlenmez.

## Canlı Modu Açma

- Panelde dry-run kapatmak veya global repricer'ı açmak ayrı canlı-mod onayı ister.
- İlk canlı deneme yalnızca seçilmiş pilot barkodlarda ve ürün modu `AUTOMATIC` iken yapılır.
- `auto_update` kapalı ürün otomatik job tarafından uygulanmaz.
- Canlı moda geçiş bu V2 teslimatının parçası değildir; kullanıcı açık onayı ve ayrı pilot kontrolü gerekir.

## Job Durdurma

- Tüm scheduler için Railway'de `JOBS_ENABLED=false` yapıp redeploy edin.
- Tek job için `jobs.enabled=false` kullanın.
- Çalışan duplicate job PostgreSQL advisory lock tarafından engellenir.

## Railway Eski Committe Kalırsa

- Deployment source branch ve commit SHA kontrol edilir.
- GitHub branch'in remote'a push edildiği doğrulanır.
- Railway'de son deployment `Redeploy` edilir.
- Build logunda V2 `vite build`, runtime logunda `server_started` ve `/version` 2.0.0 aranır.

## Migration Hatası

- Migration transaction rollback olur; yarım migration kaydı oluşmaz.
- `schema_migrations` tablosu ve hata veren SQL kontrol edilir.
- Production tablosunu drop/reset etmeyin.
- Kod düzeltildikten sonra idempotent `pnpm migrate` yeniden çalıştırılır.

## Migration Geri Alma

1. Uygulama bakım moduna alınır ve joblar kapatılır.
2. Doğrulanmış DB backup alınır.
3. Down migrationın sileceği V2 aksiyon/job/audit verileri kabul edilir.
4. `pnpm migrate:down` çalıştırılır.
5. Eski uygulama commit'i deploy edilir.

Production'da backup olmadan down migration çalıştırılmaz.

