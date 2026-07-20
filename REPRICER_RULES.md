# Repricer Kuralları

## Fiyat Yönü

- Önerilen fiyat mevcut fiyattan düşükse `FIYAT_DUSUR`.
- Önerilen fiyat yüksekse `FIYAT_ARTIR`.
- Ürün minimum fiyat altındaysa `MIN_FIYATA_TOPARLA`.
- Eşitse `KORU`.

Aksiyon etiketi matematiksel yönle merkezi domain fonksiyonunda üretilir.

## Hedef Sıra ve Kâr Optimizasyonu

- Ekonomik olarak mümkünse 1. sıra hedeflenir.
- Birinci sıra minimum fiyatın altındaysa 2., o da mümkün değilse 3. sıra denenir.
- Üst sıra güvenli değilse mevcut sırada, bilinen bir sonraki fiyatın kırma tutarı kadar altında mümkün olan en yüksek fiyat seçilir.
- `Kâr Koru` stratejisi mevcut sıradan yukarı çıkmayı denemez.
- `global_unlimited_increase=true` iken artışta sabit/yüzdesel tavan uygulanmaz; hedef bilinen bir sonraki sıra fiyatının kırma tutarı kadar altıdır. Düşüş tek işlem ve günlük yüzde sınırıyla kademelenir.
- Tek aksiyon değişim limiti `max_single_change_pct`, gün başına göre toplam limit `max_daily_change_pct` alanıdır.
- Global aşağı yönlü günlük tavan yüzde 5'tir; ürün ayarı daha düşükse daha sıkı olan değer kullanılır.
- Karar, hedef sıra ve sınırı uygulayan kural aksiyon kaydına yazılır.

## Minimum Fiyat

```text
(ürün maliyeti + kargo + ambalaj + hizmet bedeli + hedef kâr)
----------------------------------------------------------------
                  (1 - komisyon / 100)
```

Kargo tarifesi ve baremi panel/veritabanında KDV hariç tutulur; yüzde 20 eklenmiş tutar hesapta kullanılır. Diğer alış ve satış fiyatları KDV dahildir.

## Otomatik Aksiyon Safety Gate

- Global repricer açık
- Global dry-run kapalı
- Ürün auto update açık
- Ürün aktif, satışta, stoklu ve kilitsiz
- Kara listede değil
- Maliyet verisi tam ve komisyon mevcut
- Minimum fiyat pozitif
- Öneri minimum fiyatın altında ve maksimum fiyatın üstünde değil
- Buybox verisi mevcut ve güncel
- Cooldown dolmuş
- Günlük aksiyon ve değişim limiti aşılmamış
- Aksiyon değişimi anlamlı ve sınır içinde
- Zarar eden üründe otomatik düşüş yok
- Beklenen kâr negatif ve marj minimumun altında değil
- Başka açık aksiyon yok
- Aksiyondaki eski fiyat güncel DB fiyatıyla aynı
- Trendyol Product V2 ile okunan güncel fiyat aksiyondaki eski fiyatla aynı
- Aksiyon süresi dolmamış

Safety gate uygulama anında yeniden çalışır. Preview sonucu fiyat gönderme yetkisi değildir.

Manuel ve geri alma aksiyonları insan onayı nedeniyle `auto_update`, global repricer ve learning-pause kapılarını kullanmaz. Dry-run, aktif/stok, maliyet, minimum/maksimum fiyat, buybox güncelliği, kâr/marj, günlük limit, cooldown ve açık aksiyon kontrollerinin tamamı yine zorunludur.

Bekleyen aksiyonun fiyatı panelde değiştirilebilir. Düzenleme minimum fiyatın altına veya mevcut fiyatla aynı değere izin vermez; beklenen kâr/marjı yeniden hesaplar, kaynağı `MANUAL_EDIT` olarak audit kaydına yazar ve aksiyonu onaylar. Trendyol'a gönderim yine ayrı “Uygula” adımı ve tüm safety kontrolleri sonrasında mümkündür.

## Geri Alma

- Yalnızca sonucu doğrulanmış `SUCCESS` aksiyon geri alınabilir.
- Güncel ürün fiyatı asıl aksiyonun uygulanan fiyatıyla eşleşmelidir.
- Eski fiyata yeni `ROLLBACK` aksiyonu oluşturulur; doğrudan gönderim yapılmaz.
- Ters aksiyon ayrıca onaylanır ve uygulama anında safety gate yeniden çalışır.
- Batch item başarılı ve pazardaki fiyat doğrulandıktan sonra asıl kayıt `REVERTED` olur ve iki kayıt birbirine bağlanır.

## Öğrenme

- Sonuçlar 5, 15 ve 60 dakikada ölçülür.
- Önce batch item sonucu ve Trendyol'da görülen gerçek satış fiyatı doğrulanır; yalnızca batch ID almak başarı sayılmaz.
- Sonuç yazılmadan önce yalnızca ilgili barkodların buybox verisi yeniden çekilir; yenileme başarısızsa eski veriyle sonuç yazılmaz.
- Öğrenme aynı aksiyonu üç kez saymamak için 60. dakika sonucunda güncellenir.
- Başarılı en küçük fiyat kırma tercih edilir.
- Başarısız düşüşlerde adım en az 5 TL veya fiyatın yüzde 0,5'i kadar artırılır.
- Öğrenilen değer ürün min/max undercut sınırını aşmaz.
- Beş ardışık başarısızlıkta öğrenme duraklatılır.
- Başarısız fiyat artışlarında ürünün öğrenilmiş maksimum artışı azaltılır.
- Başarı hedeflenen sıraya göre ölçülür; ikinci veya üçüncü sıra hedefi de geçerli sonuçtur.
- Öğrenme hiçbir zaman minimum fiyat safety gate'ini geçersiz kılamaz.

## Production Varsayılanı

- `global_dry_run = true`
- `global_repricer_enabled = false`
- `global_max_daily_decrease_pct = 5`
- `global_unlimited_increase = true`
- Ürün `auto_update = false` varsayılanı

Bu üç anahtar migration tarafından kendiliğinden canlı moda çevrilmez.

Dry-run kapatma veya global repricer açma API seviyesinde `CANLI_FIYAT_MODUNU_AC` onayı gerektirir; panel bunu ayrı bir risk penceresiyle toplar.
