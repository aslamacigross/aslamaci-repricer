# Repricer Kuralları

## Fiyat Yönü

- Önerilen fiyat mevcut fiyattan düşükse `FIYAT_DUSUR`.
- Önerilen fiyat yüksekse `FIYAT_ARTIR`.
- Ürün minimum fiyat altındaysa `MIN_FIYATA_TOPARLA`.
- Eşitse `KORU`.

Aksiyon etiketi matematiksel yönle merkezi domain fonksiyonunda üretilir.

## Minimum Fiyat

```text
(ürün maliyeti + kargo + ambalaj + hizmet bedeli + hedef kâr)
----------------------------------------------------------------
                  (1 - komisyon / 100)
```

Kargo tarifesi ve baremi Sheet/panelde KDV hariçtir; yüzde 20 eklenmiş tutar hesapta kullanılır. Diğer alış ve satış fiyatları KDV dahildir.

## Zorunlu Safety Gate

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
- Aksiyon süresi dolmamış

Safety gate uygulama anında yeniden çalışır. Preview sonucu fiyat gönderme yetkisi değildir.

## Öğrenme

- Sonuçlar 5, 15 ve 60 dakikada ölçülür.
- Öğrenme 15. dakikadan sonra güncellenir.
- Başarılı en küçük fiyat kırma tercih edilir.
- Başarısız düşüşlerde adım en az 5 TL veya fiyatın yüzde 0,5'i kadar artırılır.
- Öğrenilen değer ürün min/max undercut sınırını aşmaz.
- Beş ardışık başarısızlıkta öğrenme duraklatılır.
- Öğrenme hiçbir zaman minimum fiyat safety gate'ini geçersiz kılamaz.

## Production Varsayılanı

- `global_dry_run = true`
- `global_repricer_enabled = false`
- Ürün `auto_update = false` varsayılanı

Bu üç anahtar migration tarafından kendiliğinden canlı moda çevrilmez.
