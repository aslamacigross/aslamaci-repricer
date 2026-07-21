# Ürün Fırsatı Motoru

## Amaç

Fırsat motoru, mevcut PIM reçeteleri ile tedarikçi fiyat havuzlarını hedef
pazaryerindeki listing ve fiyat verisiyle karşılaştırır. İlk sürüm deterministik
ve açıklanabilirdir; satış tahmini veya gerçek ürün yayını yapmaz.

## Fırsat Türleri

- `MISSING_SINGLE`: tedarikçi havuzunda olup PIM'de tekli reçetesi olmayan ürün.
- `MISSING_MARKETPLACE`: onaylı reçetenin hedef kanalda listing'i yok.
- `MISSING_PACK_SIZE`: aynı fiziksel ürün için eksik 2/3/4/6 paket adedi.
- `MIXED_BUNDLE`: aynı marka ve ürün ailesinin farklı varyantlarından güvenli set.
- `PROFITABLE_BUYBOX_GAP`: minimum fiyat korunarak daha iyi sıra olasılığı.
- `LOW_COMPETITION_GAP`: gözlenen fiyat kademesinde en fazla iki rakip fiyatı.
- `HIGH_MARGIN_VARIANT`: mevcut fiyat minimum fiyatın en az yüzde 25 üzerinde.

Son üç tür yalnız doğrulanabilir pazar ve maliyet verisi bulunduğunda üretilir.

## Açıklanabilir Puan

Puan; minimum fiyat/buybox boşluğu, rakip yoğunluğu, ürün ailesi satışları,
tedarikçi fiyat güncelliği, bulunabilirlik, kargo oranı, komisyon, iade oranı,
listing kalitesi ve eksik paket sinyallerinden oluşur. Her satırda ham değer,
ağırlık, katkı ve veri kaynağı saklanır. Üçten az sinyal olduğunda sonuç
`INSUFFICIENT_DATA` olarak gösterilir; sistem bunu satış potansiyeli iddiasına
dönüştürmez.

## Bundle Güvenliği

Bundle fingerprint bileşen sırasından bağımsızdır. Motor toplam adet, nihai desi,
aday sayısı, aynı ürün ailesi ve farklı varyant sınırlarını uygular. Aynı reçete,
bileşenler ters sırada yazılsa bile ikinci kez üretilmez. Menekşe örnekleri
`1,5 L` olarak test edilir; `1,5 L x 2` ile `3 L x 1` aynı ürün sayılmaz.

## Workflow

`GENERATED -> REVIEWED -> RECIPE_APPROVED -> CATALOG_SEARCHED ->
CATALOG_MATCH_REVIEW -> CONTENT_READY -> LISTING_READY -> PUBLISH_APPROVED ->
SUBMITTED -> PUBLISHED`

Kullanıcı öneriyi neden belirterek reddedebilir. Ret anındaki skor, reçete ve
hedef pazaryeri olay günlüğünde korunur. Yeniden üretim reddedilmiş veya
yayınlanmış kararı ezmez.

## Katalog ve Barkod

Önce hedef katalog aranır. Credential veya capability yoksa kontrollü durum
döner. Başarılı aramada aday yoksa yalnız `listing_barcode_required=true` olur;
bu adım barkod tahsis etmez. Barkod rezervasyonu ve yayın ayrıca açık kullanıcı
onayı ister. Listing barkodu üretici GTIN'i değildir.

## Güvenlik

- `OPPORTUNITY_AUTO_PUBLISH_ENABLED=false` fiilî ve belgelenmiş varsayılandır.
- Fırsat üretme, reçete onayı ve katalog araması pazaryeri mutasyonu yapmaz.
- Eksik maliyet, desi, komisyon veya kargo veri kalitesinde açıkça görünür.
- Mevcut repricer safety kapıları ve kuruş tabanlı fiyat motoru paylaşılır.
- Gerçek ürün, içerik, fiyat veya stok çağrısı yapılmaz.
