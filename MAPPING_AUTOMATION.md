# Akıllı Mapping ve File Market

## Amaç

Bu modül Trendyol'daki mapping eksiği ürünlere, daha önce elle doğrulanmış ürün reçetelerinden ve File Market fiyat gözlemlerinden yararlanarak maliyet mappingi önerir. Öneri motoru yardımcıdır; hiçbir öneri kullanıcı incelemesi olmadan mappinge veya maliyete dönüşmez.

## Günlük Kullanım

1. `Ürün Mapping > File fiyat havuzu` ekranını açın.
2. Mac File uygulamasından toplanan `ürün adı; fiyat; marka; durum` satırlarını `File fiyatı içe aktar` ile yükleyin.
3. `Akıllı öneriler` ekranında `Önerileri üret` düğmesini kullanın veya Joblar ekranından `generate-mapping-suggestions` jobunu çalıştırın.
4. Önerinin Trendyol ürünü, File ürünü, cost code, adet, güncel fiyat, kaynak ürün ve güven nedenlerini inceleyin.
5. Doğru öneride `Öneriyi onayla`, yanlış öneride ret notuyla `Reddet` seçin.
6. Onaylananlar filtresine geçip uygulanacak satırları seçin.
7. `Seçilenleri önizle` ile ürün/mapping/fiyat güncellemesi sayılarını doğrulayın.
8. `Mappingleri uygula` dediğinizde V2 son güvenlik kontrollerini tekrar yapar ve maliyetleri hesaplar.

## Güven Bantları

- `Yüksek güven`: skor yüzde 92 ve üzeri. Genellikle aynı marka, ürün tipi, gramaj ve güvenilir eski reçete vardır.
- `Kontrol gerekli`: yüzde 70-91,99. Benzerlik güçlüdür ancak varyant, gramaj veya marka ayrıntısı dikkat ister.
- `Düşük güven`: yüzde 70 altı. Manuel inceleme gerektirir.

Güven bandı otomatik uygulama izni değildir. Yüksek güven dahil bütün öneriler ilk aşamada `Bekliyor` durumundadır.

## Öğrenme Kaynakları

Motor önce mevcut `product_cost_mappings` kayıtlarından doğrulanmış reçeteleri çıkarır. Hedef ürünle eski ürün arasında ad, marka, kategori, gramaj/hacim ve paket adedi karşılaştırılır. İki adetlik eski ürün dört adetlik hedefle eşleşirse cost code korunur ve adet iki katına çıkarılır. Uygun eski örnek yoksa maliyet kalemi kataloğu daha düşük güvenli yedek kaynak olarak kullanılır.

File ürünü eşleşmesi güncel birim maliyet önerir. Fiyat uygulanırsa `cost_items.previous_unit_cost` eski değeri, `price_source=FILE_MARKET` kaynağı ve gözlem zamanı saklanır.

File'da aynı marka, ürün ailesi ve ölçüde yalnız kardeş varyant görünüyorsa bu fiyat kontrollü bir kanıt olarak kullanılabilir. Örneğin 100 ml Kiraz Çiçeği kolonyanın fiyatı aynı ailedeki 100 ml Zeytin Çiçeği için önerilebilir. Bu satır `Varyant fiyatı` rozeti taşır, gerekçede açıkça belirtilir ve güveni hiçbir zaman `Yüksek güven` düzeyine çıkmaz.

## Güvenlik Kuralları

- Yalnız aktif ve `MAPPING_MISSING` durumundaki Trendyol ürünleri hedeflenir.
- Yalnız File fiyat havuzunda bulunan marka kapsamı ve gerçek bir File fiyat desteği olan adaylar kaydedilir.
- Kardeş varyanttan türetilen fiyat kullanıcı kontrolü gerektirir; doğrudan eşleşme gibi gösterilmez.
- Bekleyen öneriyi onaylamak hiçbir veriyi değiştirmez.
- Yalnız onaylı öneriler toplu önizlenebilir.
- Önizleme sonrasında öneri veya File fiyatı değişirse uygulama reddedilir.
- Hedef üründe arada mapping oluşmuşsa işlem reddedilir.
- Maliyeti veya desisi sıfır cost code kullanılamaz.
- File fiyatı 30 günden eskiyse maliyet güncellemesi yapılamaz.
- Uygulama ve maliyet hesaplama tek transactiondır; hata olursa mevcut veri korunur.
- Bu modül Trendyol fiyat gönderme endpointini çağırmaz.

## File Fiyat Toplama Sınırı

File Market'in resmi web veya satıcı API yüzeyi yoktur. Bu nedenle Railway, File uygulamasına kendi başına bağlanamaz. V2; toplanan gözlemlerin içe alınması, tarihçesi, fiyat değişimi, güncellik kontrolü, eşleştirme ve maliyete uygulanması tarafını yönetir. Mac uygulamasındaki ekran okuma turu Codex Computer Use ile tekrarlanabilir; yeni gözlemler aynı ürün anahtarına yazılarak önceki fiyat korunur.

İlk toplama kapsamı kullanıcının tedarik modeline göre Harras, Actisoft ve Daycare ile sınırlandırılmıştır. Aramada bulunmayan ürünler alternatif varyant/gramaj kelimeleriyle ve uygulamadaki Atıştırmalık, Kişisel Bakım, Ev Temizliği ve İçecek kategorilerinde taranmıştır. Fiziksel mağazada olup uygulamada listelenmeyen ürünler yanlış fiyatla eşleştirilmez; düşük güven veya eşleşme yok durumunda kullanıcı incelemesinde kalır.
