# PIM ve Listing Modeli

## Amaç

Merkezi PIM pazaryeri ürünlerini tek bir barkod tablosunda birleştirmez. Fiziksel
ürün, satış reçetesi ve pazaryeri listing'i ayrı kimlik ve yaşam döngülerine
sahiptir.

## Katmanlar

### Fiziksel ürün

`pim_physical_products`, bir cost code ile alınabilen gerçek ürünü temsil eder.
Marka, ürün ailesi, varyant, hacim, gramaj ve ana görseller bu katmandadır.

### Reçete ve bundle

`pim_recipes` ile `pim_recipe_components`, satılan paketin hangi fiziksel
ürünlerden ve kaç adet oluştuğunu tanımlar. Bileşenler sıralanarak oluşturulan
SHA-256 fingerprint aynı reçetenin farklı sırada ikinci kez açılmasını engeller.
Toplam maliyet kuruş cinsinden tam sayı, desi ise önce kesirli sonra yukarı
yuvarlanmış nihai değer olarak saklanır.

### Pazaryeri listing'i

`marketplace_listings`, aynı reçetenin Trendyol, Hepsiburada veya başka bir
kanaldaki ayrı temsilidir. Katalog ürün kimliği, katalog barkodu, seller listing
barkodu, seller SKU, dış listing kimliği, kategori, içerik, fiyat ve yayın durumu
bu katmanda tutulur. Ortak reçete maliyeti paylaşılabilir; minimum fiyat,
komisyon, kargo, hizmet bedeli ve buybox pazaryeri bazında hesaplanır.

## Mevcut Veriyi Taşıma

`bootstrap-pim` mevcut `cost_items`, `product_cost_mappings` ve `products`
kayıtlarını silmeden PIM kayıtlarına dönüştürür. Önizleme salt okunurdur. Uygulama
yalnız `PIM_BOOTSTRAP_UYGULA` açık onayıyla çalışır ve transaction içindedir.
Aynı bileşen/adet fingerprint'ine sahip farklı pazaryeri listing'leri aynı
reçeteye bağlanır. İşlem idempotenttir.

## Para ve Desi

PIM para alanları `*_minor` isimli `BIGINT` kolonlarda kuruş olarak saklanır.
JavaScript kayan nokta değeri fiyat motoruna geri sokulmaz. Nihai desi mevcut
operasyon kuralı uyarınca toplam kesirli desinin yukarı yuvarlanmasıyla oluşur.

## Güvenlik

- PIM bootstrap pazaryerine çağrı yapmaz.
- Katalog eşleşme onayı ürün veya teklif yayınlamaz.
- Listing barkodu önizlemesi rezervasyon yapmaz.
- Rezervasyon açık onay gerektirir ve advisory lock ile idempotenttir.
- Migration mevcut ürün, mapping ve öğrenme geçmişini silmez.
