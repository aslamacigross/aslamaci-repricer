# Railway Deployment

## Önerilen Topoloji

Tek Railway servisi kullanılır. Build sırasında React derlenir, runtime sırasında Express hem API'yi hem statik frontend'i sunar. PostgreSQL mevcut Railway database servisidir.

## Preview Sırası

1. `feature/aslamaci-erp-v2` branch'i GitHub'a push edilir.
2. Pull request branch'inden Railway preview environment oluşturulur.
3. Production PostgreSQL'in doğrudan kopyası kullanılacaksa önce snapshot/backup alınır; tercihen ayrı preview DB kullanılır.
4. Aşağıdaki V2 environment değişkenleri preview'a eklenir.
5. `DRY_RUN=true` ve `REPRICER_ENABLED=false` doğrulanır.
6. Deploy health check `/health` yeşil olana kadar beklenir.
7. Login, dashboard, ürün detayı, Menekşe kırılımı, buybox sync, repricer preview ve dry-run aksiyonu test edilir.
8. `003_learning_contracts_and_operations` migrationının eski pilot aksiyonlarını koruduğu ve rollback ilişkilerini eklediği doğrulanır.
9. `004_market_price_verification` migrationının tek işlem limitini mevcut günlük limitten taşıdığı ve bekleyen aksiyonları değiştirmediği doğrulanır.
10. `005_operational_controls` migrationı ve `/ready` yanıtı doğrulanır; bakım modu kapalı bırakılır.
11. `024_product_publishing_and_channel_transfer` ayrı preview DB'de up/down
    test edilir; `/ready` bu migrationı beklemelidir.
12. `025_product_opportunity_engine` ile
    `026_ai_content_and_listing_health` ayrı preview DB'de sırasıyla up/down
    test edilir; `/ready` son olarak `026_ai_content_and_listing_health` bekler.
13. `PRODUCT_PUBLISHING_ENABLED=false`, `CONTENT_AUTO_UPDATE_ENABLED=false` ve
    `OPPORTUNITY_AUTO_PUBLISH_ENABLED=false` doğrulanır.

## Doğrulanmış V2 Preview

- URL: `https://aslamaci-repricer-preview-v2.up.railway.app`
- Railway environment: `preview-v2`
- Ayrı PostgreSQL servisi kullanılır; production DB'ye migration veya write yapılmamıştır.
- Güvenlik: `DRY_RUN=true`, `REPRICER_ENABLED=false`, `JOBS_ENABLED=false`.
- Product V2 ile 768 Trendyol varyantı ve buybox servisiyle 717 barkod read-only API çağrılarıyla senkronize edildi.
- Menekşe (`8690609598109`) panelde 312,28 TL minimum fiyat ve `COMPLETE` durumuyla doğrulandı.
- Manuel aksiyon `PENDING -> APPROVED -> DRY_RUN` akışını tamamladı; Trendyol fiyatı ve ürünün 322,00 TL mevcut fiyatı değişmedi.
- Desktop ile 390x844 mobil dashboard/ürün ekranları görsel olarak doğrulandı.
- `004_market_price_verification` migrationı uygulandı; ürün detayında ayrı tek işlem/günlük değişim alanları görüldü.
- Product V2 ürün sync jobu 6,3 saniyede `SUCCESS`, 768 işlenen ve 0 hata sonucu verdi.
- Panel güvenlik anahtarları tekrar doğrulandı: dry-run açık; global repricer kapalı.

## Production Öncesi Yedek

Railway PostgreSQL backup/snapshot özelliği kullanılır. CLI erişimi varsa standart PostgreSQL yedeği de alınabilir:

```bash
pg_dump --format=custom --no-owner --file=aslamaci-before-v2.dump "$DATABASE_URL"
```

Yedek dosyasının boş olmadığı ve restore edilebilir olduğu kontrol edilmeden production migration uygulanmaz.

## Railway Ayarları

`railway.toml`:

- Build: `pnpm install --frozen-lockfile && pnpm build`
- Start: `pnpm start`
- Health: `/health`
- Health timeout: 120 saniye
- Failure restart: 3 deneme

Sunucu açılırken bekleyen migrationlar transaction içinde idempotent olarak uygulanır.

Hash'li `/assets` dosyaları uzun süre immutable cache edilir; `index.html` ve SPA fallback yanıtı `no-store` olduğu için yeni release tarayıcıda eski uygulama kabuğuna takılmaz.

## Yeni Environment Variables

Zorunlu:

- `ADMIN_USERNAME`
- `ADMIN_PASSWORD_HASH` veya `ADMIN_PASSWORD`
- `SESSION_SECRET`
- `TY_STOREFRONT_CODE=TR`

Önerilen production değerleri:

```text
NODE_ENV=production
DRY_RUN=true
REPRICER_ENABLED=false
JOBS_ENABLED=true
PRODUCT_PUBLISHING_ENABLED=false
CONTENT_AUTO_UPDATE_ENABLED=false
OPPORTUNITY_AUTO_PUBLISH_ENABLED=false
DEFAULT_MAX_INCREASE_TL=10
ALLOWED_ORIGIN=https://<preview-veya-production-domain>
```

Hepsiburada read-only sipariş bağlantısı için:

```text
HB_MERCHANT_ID=<satici-id>
HB_USERNAME=<opsiyonel-entegrasyon-kullanici-adi>
HB_INTEGRATOR_KEY=<Railway-secret>
```

Servis anahtarı repo, ekran görüntüsü veya loga yazılmaz. `HB_PASSWORD` yalnız Hepsiburada hesabı servis anahtarından ayrı bir API parolası veriyorsa kullanılır.

Hepsiburada katalog, komisyon, buybox ve fiyat yazma yolları tam hesap yetkileri doğrulanana kadar kilitli kalır. Sadece entegratör anahtarı bu kilidi açmaz; Merchant ID ve ilgili API erişimleri birlikte gerekir.

Parola hash'i yerelde üretilir:

```bash
pnpm hash-password "en-az-12-karakter-guvenli-parola"
```

Çıktı Railway'de `ADMIN_PASSWORD_HASH` değeridir. Düz parola repo veya loga yazılmaz.

## Deploy Sonrası Smoke Test

- `GET /health`: DB connected
- `GET /ready`: son migration uygulanmış ve durum `ready`
- Login ve logout
- Dashboard KPI ve grafikler
- Üst pazaryeri seçicisinde Trendyol ve Hepsiburada arasında geçiş; iki tarafta sayıların ve kayıtların karışmaması
- Ürün arama, filtre ve detay drawer
- `8690609598109` maliyet kırılımı: yaklaşık 312,28 TL
- Mapping validation ve test transaction
- Buybox sync job
- Repricer preview
- Onay + apply: sonuç `DRY_RUN`, Trendyol çağrısı yok
- Mock/canlı olmayan doğrulama: pazar fiyatı eski fiyatla uyuşmazsa gönderim bloklanır
- Batch kabulünden sonra doğrulama gelene kadar ürün fiyatı değişmez
- Başarılı fixture aksiyonunda geri alma isteği: yeni `ROLLBACK/PENDING` kayıt, doğrudan API çağrısı yok
- Dry-run kapatma denemesi: ikinci canlı-mod onayı olmadan `409`
- Job geçmişi ve audit log
- Günlük sağlık raporu ve desi kontrol kuyruğu
- File/Bizim/BİM joblarının `DAILY 00:00 Europe/Istanbul` görünümü
- `Satış & Kâr` sipariş sync ve aylık ambalaj kaydı
- Hepsiburada kargo tarifesi importu; 0-4500 desi ve platform `HEPSIBURADA`
- Hepsiburada Sistem Ayarları: varsayılan kargo `hepsiJET`, hizmet bedeli KDV dahil `10,50 TL`
- Hepsiburada sepet baremleri: 0-199,99 ve 200-399,99 aralıklarında 14 ayrı kayıt
- Hepsiburada repricer denemesi: `MARKETPLACE_CREDENTIALS_MISSING`; Trendyol fiyat çağrısı yok
- Ürün Yayınlama: taslak ve adapter doğrulaması `mutationPerformed=false`
- Kanal Aktarımı: aynı idempotency key ikinci batch oluşturmaz
- Entegrasyonlar: Trendyol hazır, Hepsiburada credential bekliyor;
  Pazarama/İdefix/N11/PTTAVM pasif skeleton
- Ürün Fırsatları: reçete onayı otomatik yayın veya barkod tahsisi yapmaz
- İçerik Stüdyosu: `MOCK_DRAFT`, diff, snapshot ve onay; gönderim dry-run sonucu
  `mutationPerformed=false`
- Listing Sağlığı: kanıt, öneri, beklenen etki ve KPI gösterilir
- Mobil sidebar ve tablolar
- `pnpm test:ui` ve `pnpm test:e2e`

## Production'a Geçiş

Bu branch production'a deploy edilmemiştir. İlerideki ilk production deploy da
dry-run olarak yapılmalıdır. Gerçek fiyat, ürün, içerik veya stok gönderimi bu
deployment işinin parçası değildir. Canlı repricer modu ayrı bir kullanıcı
kararı ve pilot ürün doğrulamasından sonra panelde ikinci risk onayıyla açılır;
otomatik fiyat gönderimi için ayrıca global repricer ve ürün bazında
`AUTOMATIC + auto_update` gerekir. Ürün ve içerik yayın anahtarları kapalı kalır.

Preview ortamı Railway deneme planındadır. Deneme süresi/credit bitmeden preview kalıcı bir plana taşınmalı veya production geçişi tamamlandıktan sonra kapatılmalıdır.
