# Marketplace Adapter Sözleşmesi

## Amaç

Aşlamacı ERP V2 pazaryeri davranışlarını domain katmanına dağılmış `if/else`
bloklarıyla yönetmez. Her kanal `MarketplaceAdapter` sözleşmesini uygular ve
`MarketplaceRegistryService` üzerinden çağrılır.

## Kayıtlı Pazaryerleri

| Kod | Durum | Bugünkü kapsam |
| --- | --- | --- |
| `TRENDYOL` | Hazır | Mevcut ürün, sipariş, finans, buybox ve güvenli fiyat altyapısı |
| `HEPSIBURADA` | SIT/canlı credential durumuna göre | Salt-okunur sipariş adapteri; mutasyonlar kapalı |
| `PAZARAMA` | Skeleton, pasif | Gerçek çağrı yok |
| `IDEFIX` | Skeleton, pasif | Gerçek çağrı yok |
| `N11` | Skeleton, pasif | Gerçek çağrı yok |
| `PTTAVM` | Skeleton, pasif | Gerçek çağrı yok |

Registry hiçbir credential değerini saklamaz. Yalnızca yapılandırılmış/eksik
durumunu, güvenli hata özetini, capability listesini ve son senkron zamanlarını
saklar. Gerçek credential değerleri yalnız environment veya Railway secret
store üzerinden mevcut servisler tarafından okunur.

## Kontrollü Sonuçlar

Desteklenmeyen veya hazır olmayan çağrılar exception yerine aşağıdaki kontrollü
sonuçlardan birini üretir:

- `CAPABILITY_NOT_SUPPORTED`
- `MARKETPLACE_CREDENTIALS_MISSING`
- `MARKETPLACE_DISABLED`
- `MARKETPLACE_ADAPTER_NOT_READY`

Capability kontrolü fail-closed çalışır. Operation-capability haritasında kaydı
olmayan bir işlem desteklenmiş sayılmaz ve `CAPABILITY_NOT_SUPPORTED` döner.

Credential bulunmayan platform jobları `SKIPPED_CREDENTIALS_MISSING` olarak
tamamlanır. Bu durum sistem sağlığında entegrasyon arızası sayılmaz.

## Hepsiburada Ortamları

Hepsiburada test ortamı ile canlı ortam aynı adapter sözleşmesini kullanır.
Ortam seçimi yalnız environment değişkenlerinden yapılır:

- `HEPSIBURADA_ENV=sit`: Hepsiburada Merchant SIT ve test API bilgileri.
- `HEPSIBURADA_ENV=production`: canlı Hepsiburada satıcı API bilgileri.

Hepsiburada'nın geliştirici dokümanında katalog entegrasyonu test akışı Basic
Authentication ve `User-Agent` header'ı ile başlatılır; canlı ortam için ise
canlı Merchant Panel içinden API Entegrasyon Teknik Destek talebi açılması
gerekir. Test credential'ı production credential yerine geçmez.

Kullanılan secret'lar:

- `HB_MERCHANT_ID`
- `HB_USERNAME` veya boşsa `HB_MERCHANT_ID`
- `HB_PASSWORD` veya `HB_INTEGRATOR_KEY`
- `HEPSIBURADA_USER_AGENT`

Opsiyonel endpoint override değerleri yalnız Hepsiburada dokümanı değişirse veya
destek ekibi özel URL iletirse kullanılır:

- `HB_ORDER_BASE_URL`
- `HB_LISTING_BASE_URL`
- `HB_PRODUCT_BASE_URL`

`HEPSIBURADA_MUTATIONS_ENABLED=false` kalır. Bu anahtar doğrulama sözleşmesi
içindir; mevcut sürüm Hepsiburada ürün, teklif, fiyat veya stok mutasyonu
uygulamaz.

## Mutasyon Güvenliği

Capability desteği canlı mutasyon izni anlamına gelmez. Ürün yayınlama ve içerik
mutasyonları ayrıca aşağıdaki kapalı anahtarlardan geçmek zorundadır:

- `PRODUCT_PUBLISHING_ENABLED=false`
- `CONTENT_AUTO_UPDATE_ENABLED=false`
- `OPPORTUNITY_AUTO_PUBLISH_ENABLED=false`

Son anahtar sözleşme uyumluluğu için bulunur ve gerçek otomatik yayın açamaz.
Mevcut Trendyol fiyat safety gate'leri adapter sözleşmesinden bağımsız olarak
aynen korunur.

## Yeni Adapter Eklemek

1. `MarketplaceAdapter` sınıfını genişlet.
2. Yalnız gerçekten uygulanmış capability alanlarını `true` yap.
3. Credential kontrolünü `configured()` içinde yalnız boolean olarak döndür.
4. Servisi container içindeki registry adapter haritasına ekle.
5. Registry migrationında statik kanal metadatasını tanımla.
6. Credential eksik, capability eksik, idempotent retry ve marketplace
   izolasyonu testlerini ekle.

## Ürün ve İçerik Sınırı

Trendyol adapteri mevcut ürün, buybox, sipariş, finans ve fiyat davranışını
korur. Yeni ürün oluşturma ve içerik güncelleme bu sürümde yalnız ortak adapter
payload doğrulamasına kadar gider. Hepsiburada credential yapılandırılsa bile bu
sürümde katalog, teklif, içerik, buybox ve fiyat mutasyonları sert biçimde
kapalıdır. Pazarama, İdefix, N11 ve PTTAVM adapterları yalnız
sözleşme/skeleton düzeyindedir.

Batch kabulü yayın başarısı değildir. Gelecekte gerçek mutasyon açılırsa adapter
batch sonucunu takip etmeli ve listing'i yeniden okuyarak barkod, başlık,
kategori, stok ve fiyatı doğrulamalıdır.

## Listing Kimliği Sözleşmesi

Adapter `resolveListingIdentifiers` ile aşağıdaki rolleri ayrı döndürür:

- `marketplaceProductId`: hedef ortak katalog ürün kimliği
- `marketplaceCatalogBarcode`: hedef ortak katalogdaki barkod
- `sellerListingBarcode`: satıcının teklif/listing barkodu
- `sellerSku`: satıcı stok kodu
- `externalListingId`: yayınlanan dış listing kimliği

Ortak service katmanı katalog barkodunu seller listing barkodu olarak kullanmaz.
Yeni ürün barkodu yalnız tahsis edilmiş listing barkodu havuzundan gelir; mevcut
katalog teklifinde gerekli kimlik kararı hedef adaptera aittir. Trendyol resolver
sözleşmesi ayrı uygulanmıştır. Hepsiburada katalog/teklif kimlikleri credentials
ve resmi cevap örneği gelene kadar `semanticsVerified=false` kabul edilir; bu
varsayım gerçek teklif oluşturmaya izin vermez.
