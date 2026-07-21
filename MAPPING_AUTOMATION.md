# Akıllı Mapping ve Tedarikçi Fiyat Havuzları

## Amaç

Bu modül Trendyol'daki mapping eksiği ürünlere, daha önce elle doğrulanmış ürün reçetelerinden ve File Market, Bizim Toptan veya BİM fiyat gözlemlerinden yararlanarak maliyet mappingi önerir. Fiyat havuzları ayrıdır ve farklı tedarikçiler tek öneri reçetesinde karışmaz. Öneri motoru yardımcıdır; hiçbir öneri kullanıcı incelemesi olmadan mappinge veya maliyete dönüşmez.

## Günlük Kullanım

1. `Ürün Mapping` altında ilgili tedarikçinin fiyat havuzunu açın.
2. File, Bizim ve BİM havuzlarını kendi canlı kaynaklarından yenileyin. Gerekirse üç havuzda da JSON veya `ürün adı; fiyat; marka; durum` satırlarıyla manuel içe aktarımı kullanın.
3. `Akıllı öneriler` ekranında `Önerileri üret` düğmesini kullanın veya Joblar ekranından `generate-mapping-suggestions` jobunu çalıştırın.
4. Önerinin Trendyol ürünü, tedarikçi ürünü, cost code, adet, güncel fiyat, kaynak ürün, desi ve güven nedenlerini inceleyin.
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

Tedarikçi ürünü eşleşmesi güncel birim maliyet önerir. Fiyat uygulanırsa `cost_items.previous_unit_cost` eski değeri, `price_source` kaynak kodunu ve gözlem zamanı saklar.

Birim desi ürün gramajı/hacminden kesirli olarak tahmin edilir ve gerekiyorsa kullanıcı tarafından onay ekranında düzeltilir. Ürün seviyesinde nihai desi, bütün mapping satırları toplandıktan sonra yukarı yuvarlanır; `10 x 25 g` ürün önce `0,25` toplam desi olur, ardından kargo hesabında `1` desi kabul edilir.

File'da aynı marka, ürün ailesi ve ölçüde yalnız kardeş varyant görünüyorsa bu fiyat kontrollü bir kanıt olarak kullanılabilir. Örneğin 100 ml Kiraz Çiçeği kolonyanın fiyatı aynı ailedeki 100 ml Zeytin Çiçeği için önerilebilir. Bu satır `Varyant fiyatı` rozeti taşır ve gerekçede açıkça belirtilir. Yeni varyant örüntüsü yüksek güvene çıkamaz; en az 5 karar ve yüzde 90 kabul oranından sonra kilit açılabilir.

## Geri Bildirimle Öğrenme

Her `Öneriyi onayla` ve `Reddet` kararı `mapping_feedback_events` olay günlüğüne yazılır. Karar; barkod, ürün, cost code, File ürünü, güven skoru, öğrenme etkisi, kullanıcı, zaman ve ret notuyla saklanır. Panelde `Ürün Mapping > Karar geçmişi` ekranından aranıp filtrelenebilir.

Öğrenme profili marka, kategori, cost code ve doğrudan/kardeş varyant fiyat türünü birlikte kullanır. Kabul ve ret oranı az sayıda kararda aşırı tepki vermemesi için yumuşatılır; etkisi karar sayısıyla kademeli büyür ve en fazla artı/eksi 25 puandır. Bu sayede tekrar tekrar onaylanan düşük güvenli bir örüntü zamanla kontrol veya yüksek güvene çıkabilir, reddedilen örüntülerin skoru düşer.

## Güvenlik Kuralları

- Yalnız aktif ve `MAPPING_MISSING` durumundaki Trendyol ürünleri hedeflenir.
- Yalnız tedarikçi fiyat havuzunda bulunan marka kapsamı ve gerçek bir fiyat desteği olan adaylar kaydedilir.
- Kardeş varyanttan türetilen fiyat kullanıcı kontrolü gerektirir; doğrudan eşleşme gibi gösterilmez.
- Öğrenme güven bandını değiştirebilir ancak öneriyi onaylama, toplu önizleme ve uygulama adımlarını atlayamaz.
- Bekleyen öneriyi onaylamak hiçbir veriyi değiştirmez.
- Yalnız onaylı öneriler toplu önizlenebilir.
- Önizleme sonrasında öneri veya tedarikçi fiyatı değişirse uygulama reddedilir.
- Hedef üründe arada mapping oluşmuşsa işlem reddedilir.
- Maliyeti veya desisi sıfır cost code kullanılamaz.
- Tedarikçi fiyatı 30 günden eskiyse maliyet güncellemesi yapılamaz.
- Uygulama ve maliyet hesaplama tek transactiondır; hata olursa mevcut veri korunur.
- Bu modül Trendyol fiyat gönderme endpointini çağırmaz.

## Kaynak Sınırları

File Market canlı katalog kaynağı, Bizim Toptan herkese açık web kataloğu ve BİM Yemeksepeti'nin ürün GraphQL servisi panelden yenilenebilir. BİM servisi hesap oturumu kullanmaz ve `fu9o` mağaza kataloğunu okur. Yeni gözlemler aynı kaynak anahtarına yazılır, önceki fiyat ve geçmiş korunur; kaynak eksik veya hatalı cevap verirse mevcut havuz değiştirilmez.

İlk toplama kapsamı kullanıcının tedarik modeline göre Harras, Actisoft ve Daycare ile sınırlandırılmıştır. Aramada bulunmayan ürünler alternatif varyant/gramaj kelimeleriyle ve uygulamadaki Atıştırmalık, Kişisel Bakım, Ev Temizliği ve İçecek kategorilerinde taranmıştır. Fiziksel mağazada olup uygulamada listelenmeyen ürünler yanlış fiyatla eşleştirilmez; düşük güven veya eşleşme yok durumunda kullanıcı incelemesinde kalır.
