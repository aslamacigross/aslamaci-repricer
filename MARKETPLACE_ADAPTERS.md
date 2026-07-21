# Marketplace Adapter Sözleşmesi

## Amaç

Aşlamacı ERP V2 pazaryeri davranışlarını domain katmanına dağılmış `if/else`
bloklarıyla yönetmez. Her kanal `MarketplaceAdapter` sözleşmesini uygular ve
`MarketplaceRegistryService` üzerinden çağrılır.

## Kayıtlı Pazaryerleri

| Kod | Durum | Bugünkü kapsam |
| --- | --- | --- |
| `TRENDYOL` | Hazır | Mevcut ürün, sipariş, finans, buybox ve güvenli fiyat altyapısı |
| `HEPSIBURADA` | Credential bekliyor | Salt-okunur sipariş adapteri; mutasyonlar kapalı |
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

Credential bulunmayan platform jobları `SKIPPED_CREDENTIALS_MISSING` olarak
tamamlanır. Bu durum sistem sağlığında entegrasyon arızası sayılmaz.

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
payload doğrulamasına kadar gider. Hepsiburada credential gelene kadar katalog,
teklif, içerik, buybox ve fiyat mutasyonları sert biçimde kapalıdır. Pazarama,
İdefix, N11 ve PTTAVM adapterları yalnız sözleşme/skeleton düzeyindedir.

Batch kabulü yayın başarısı değildir. Gelecekte gerçek mutasyon açılırsa adapter
batch sonucunu takip etmeli ve listing'i yeniden okuyarak barkod, başlık,
kategori, stok ve fiyatı doğrulamalıdır.
