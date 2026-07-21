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

## Ürün Yayınlama Güvenliği

- Mevcut sürümde `PRODUCT_PUBLISHING_ENABLED=false` kalır.
- `Ürün Yayınlama` dry-run'ı yalnız payload doğrular; başarılı sonuç gerçek
  listing oluşturulduğu anlamına gelmez.
- Credential eksikliği, adapter/capability eksikliği, düşük güvenli katalog
  eşleşmesi veya maliyet blocker'ı kullanıcıya gösterilir ve atlanmaz.
- Gelecekte gerçek yayın eklendiğinde batch kabulü yeterli sayılmaz; listing
  tekrar okunup barkod, başlık, kategori, stok ve fiyat doğrulanmadan
  `PUBLISHED` durumuna geçilmez.

## İçerik ve Fırsat Güvenliği

- `CONTENT_AUTO_UPDATE_ENABLED=false` ve
  `OPPORTUNITY_AUTO_PUBLISH_ENABLED=false` kalır.
- İçerik taslağında paket adedi veya kaynaksız iddia engeli varsa insan onayı
  verilmez; sağlayıcı çıktısı doğru veri kabul edilmez.
- `Gönderim dry-run` yalnız capability/credential kapılarını raporlar ve adapter
  mutasyonu çağırmaz.
- Rollback snapshot'ı doğrudan geri yazılmaz; düzenleme, diff ve yeni kullanıcı
  onayı gerekir.
- Fırsat reçetesi onayı ürün yayınlamaz ve listing barkodu tüketmez. Önce hedef
  katalog araması ve gerektiğinde kullanıcı eşleşme incelemesi tamamlanır.
- Credential olmayan platform joblarının `SKIPPED_CREDENTIALS_MISSING` olması
  beklenen güvenli durumdur; sistem arızası sayılmaz.

## Railway Eski Committe Kalırsa

- Deployment source branch ve commit SHA kontrol edilir.
- GitHub branch'in remote'a push edildiği doğrulanır.
- Railway'de son deployment `Redeploy` edilir.
- Build logunda V2 `vite build`, runtime logunda `server_started` ve `/version`
  `2.9.0` aranır.

## Migration Hatası

- Migration transaction rollback olur; yarım migration kaydı oluşmaz.
- `schema_migrations` tablosu ve hata veren SQL kontrol edilir.
- Production tablosunu drop/reset etmeyin.
- Kod düzeltildikten sonra idempotent `pnpm migrate` yeniden çalıştırılır.
- Çoklu pazaryeri genişlemesinde beklenen sıra `022`, `023`, `024`, `025`,
  `026`; `/ready` gerekli migration olarak
  `026_ai_content_and_listing_health` göstermelidir.

## Migration Geri Alma

1. Uygulama bakım moduna alınır ve joblar kapatılır.
2. Doğrulanmış DB backup alınır.
3. Down migrationın sileceği V2 aksiyon/job/audit verileri kabul edilir.
4. `pnpm migrate:down` çalıştırılır.
5. Eski uygulama commit'i deploy edilir.

Production'da backup olmadan down migration çalıştırılmaz.
