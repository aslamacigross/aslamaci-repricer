# Aşlamacı ERP V2 Proje Bağlamı

## İş Bağlamı

Aşlamacı Gross, stok tutmadan sipariş üzerine tedarik yapan bir süpermarket pazaryeri mağazasıdır. Trendyol kataloğu yaklaşık 755 barkoddur ve ayda yaklaşık 100 barkod büyümektedir. Aynı fiziksel ürün farklı paket adetleriyle birden fazla barkodda satıldığı için maliyet kalemleri `MaliyetIndex`, barkod bileşimleri `UrunMaliyetMap` mantığıyla yönetilir.

## Canlı Sistem

- Repo: `aslamacigross/aslamaci-repricer`
- Railway: `https://aslamaci-repricer-production.up.railway.app`
- Production sürümü (V2 öncesi): `2026-07-10-learning-buybox-pilot`
- Production DB gözlemi: 755 toplam ürün, 709 aktif ürün, 451 mapping eksik, 399 komisyon eksik, 7 auto-update açık.

## Korunacak Davranışlar

- Trendyol ürün ve buybox senkronizasyonu
- KDV dahil maliyet hesabı
- Geçmiş `price_war_log`, `buybox_snapshots` ve `repricer_learning` verileri
- Öğrenen pilotun ürün bazlı fiyat kırma değeri
- Mevcut minimum fiyat ve net kâr davranışı

## Maliyet Kararı

`KargoMaliyetleri` ve `KargoBarem` sekmeleri KDV hariçtir ve yüzde 20 KDV eklenerek gerçek ödenen maliyete çevrilir. Diğer alış ve satış fiyatları KDV dahildir.

Minimum fiyat:

`(ürün maliyeti + kargo + ambalaj + hizmet bedeli + hedef kâr) / (1 - komisyon oranı)`

Menekşe fixture (`8690609598109`): 112 + 79 + 15 + 13,19 + 40, yüzde 17 komisyon ile 312,28 TL.

## Güvenlik Kararları

- Production varsayılanı `DRY_RUN=true`.
- Global repricer varsayılanı kapalıdır.
- Ürün auto-update varsayılanı kapalıdır.
- Gerçek Trendyol fiyat gönderimi kullanıcının açık onayı olmadan çalıştırılmaz.
- V2 migrationları mevcut production tablolarını veya geçmiş aksiyonları silmez.
- PostgreSQL V2'nin tek uygulama veri kaynağıdır; Google Sheets import/export ve eski URL komutları runtime'dan kaldırılmıştır.

## Branch ve Çalışma Şekli

- Branch: `feature/aslamaci-erp-v2`
- Draft PR: [#1 Aşlamacı ERP V2 production web panel](https://github.com/aslamacigross/aslamaci-repricer/pull/1)
- Production branch’e doğrudan yazılmaz.
- Her ana aşamada bu dosya ve `IMPLEMENTATION_STATUS.md` güncellenir.
- Tek pull request draft olarak hazırlanmıştır; merge ve production deploy ayrı onay gerektirir.

## V2 Mimari Kararları

- Railway'de Express API ve build edilmiş React panel tek serviste çalışır.
- `index.js` yalnızca `src/server.js` bootstrap dosyasını çağırır.
- Aksiyon uygulaması önce DB'de `SENDING` durumuna alınır; gerçek gönderim öncesi barkod Product V2 ile yeniden okunur ve pazar fiyatı aksiyondaki eski fiyatla eşleştirilir.
- API kabulünden sonra yalnızca batch ID ve `AWAITING_RESULT` kaydedilir; DB ürün fiyatı değiştirilmez.
- Batch item `SUCCESS` ve Product V2 satış fiyatı önerilen değer olarak doğrulanınca ürün fiyatı, kâr alanları ve `price_war_log` tek transaction içinde kesinleşir.
- Tek işlem değişim yüzdesi ile gün başına toplam değişim yüzdesi ayrı ürün ayarlarıdır.
- Repricer mümkün olan en iyi 1/2/3. sırayı, mümkün değilse mevcut sıradaki en yüksek güvenli kârı hedefler.
- Öğrenme anlık refresh içinde çalışmaz; 5/15/60 dakika outcome jobları kullanılır.
- Outcome jobu ilgili barkodların buybox verisini yenileyemezse eski veriyle sonuç yazmaz.
- Beş ardışık başarısızlıkta ürün öğrenmesi duraklatılır.
- Başarılı fiyat aksiyonları doğrudan değiştirilmeyip bağlı ve yeniden onaylanan rollback aksiyonuyla geri alınır.
- Manuel aksiyon otomasyon kapılarından bağımsızdır; dry-run ve mali güvenlik kurallarını geçemez.
- Mapping replace, kargo/ambalaj/komisyon güncellemesi ve ürün maliyet hesabı aynı DB transactionı içinde tamamlanır.
- Orphan mappingler kaybolmaz; panel işlemlerinde uyarı olarak tutulup ilgili ürünü otomatik olarak eksik durumda tutar.
- File fiyatları değişken operasyon verisidir; kaynak kod içine seed olarak gömülmez, tarihçeli PostgreSQL fiyat havuzunda tutulur.
- Akıllı mapping motoru mevcut manuel mappingleri eğitim örneği olarak kullanır ve reçeteyi hedef paket adedine ölçekler.
- Yüksek güven hiçbir zaman doğrudan uygulama yetkisi değildir; kullanıcı onayı, toplu önizleme ve uygulama üç ayrı adımdır.
- File'da yalnız kardeş varyantın fiyatı bulunursa satır `Varyant fiyatı` olarak işaretlenir ve güveni `Kontrol gerekli` düzeyini aşamaz.
- File fiyatı 30 günden eskiyse mapping uygulanabilir ancak bu fiyatla maliyet kalemi güncellenemez; fiyat yenilenmeli veya fiyat güncellemesi kapatılmalıdır.
- Tedarikçi havuzları File Market, Bizim Toptan ve BİM olarak ayrıdır; bir öneri reçetesi farklı tedarikçilerin ürünlerini karıştıramaz.
- Bizim Toptan herkese açık web kataloğundan yenilenir. BİM verisi Yemeksepeti'nin `fu9o` mağazasına ait oturumsuz GraphQL ürün servisinden alınır; dondurulmuş gıda kapsam dışıdır.
- Tedarikçi fiyat havuzları çoklu alım kademesi tutar. Mapping önerisi ve onay uygulaması, reçetedeki adet ilgili minimum adedi karşılıyorsa ana fiyat yerine o kademenin birim fiyatını maliyet kalemine yazar.
- Birim desiler gerçek paket büyüklüğünü korur. Nihai ürün desisi mapping toplamından sonra yukarı yuvarlanır: `0,25 → 1`, `1,5 → 2`, `2,01 → 3`.
- File Market, Bizim Toptan ve BİM fiyat havuzları her gece `00:00 Europe/Istanbul` zamanında sırayla yenilenir. Fiyat değişiklikleri tarihçeye, bağlı cost code'a, mappinge ve yeniden hesaplanan minimum fiyata atomik olarak taşınır.
- Bizim Toptan çoklu alım fiyatı global maliyet kalemini bozmaz; yalnız ilgili barkod mappinginde `effective_unit_cost` olarak tutulur.
- Desi tahmini yalnız yüksek güvenli gramaj/hacim sinyalinde otomatik uygulanır. Belirsiz kalemler `desi_review_queue` kuyruğuna düşer; görsel ölçeğinden kör tahmin yapılmaz.
- Buybox yenileme sıklığı barkodun son 24 saatteki fiyat/sıra oynaklığına göre 1, 5, 15, 60, 360 veya 1440 dakika olur. Başarısız okuma 5 dakika sonra tekrar denenir.
- Fiyat düşüşünde global günlük üst sınır yüzde 5'tir. Yukarı yönlü değişim, ürün minimum/maksimum fiyatı ve buybox güvenliği korunarak global yüzde limitinden muaftır.
- Satış ve kâr ekranı operasyonel nakit mutabakatıdır; sipariş gelirinden komisyon, kargo, hizmet, ürün alış ve aylık manuel ambalaj giderini düşer. Muhasebesel KDV kârı değildir.
- Panel tek kabuk ve üstten global pazaryeri seçimi kullanır. Trendyol/Hepsiburada ürün, mapping, komisyon, kargo, finans, dashboard, buybox ve repricer kayıtları `marketplace` anahtarıyla ayrıdır.
- Hepsiburada için varsayılan kargo `hepsiJET`, hizmet bedeli KDV dahil `10,50 TL`'dir. Salt-okunur sipariş/sağlık bağlantısı ve kargo tarifesi hazırdır; canlı ürün/buybox/fiyat yolları tam kimlikler gelene kadar kilitlidir.

## Doğrulama Durumu

- 170 backend unit/integration/regression ve 20 React bileşen testi geçiyor.
- Menekşe minimum fiyat testi 312,28 TL.
- Vite production build ve ESLint geçiyor.
- Gerçek PostgreSQL motorunda migration, dashboard SQL'i, Menekşe hesabı ve eksik maliyet statüsü doğrulandı.
- `004_market_price_verification` migrationı ve batch sonrası atomik fiyat kesinleştirme gerçek PostgreSQL motorunda up/down doğrulandı.
- Railway `preview-v2` ortamı `https://aslamaci-repricer-preview-v2.up.railway.app` adresinde çalışıyor.
- Preview DB'de Product V2 ile 768 ürün varyantı ve 717 buybox kaydı doğrulandı.
- Product V2 sync jobu 6,3 saniyede 768 başarılı, 0 hatalı kayıtla tamamlandı.
- Preview panel ayarlarında dry-run açık ve global repricer kapalı olarak yeniden doğrulandı.
- Menekşe manuel aksiyonu `PENDING -> APPROVED -> DRY_RUN` oldu; Trendyol çağrısı yapılmadı ve ürün fiyatı 322,00 TL kaldı.
- Login, dashboard, ürün detay/maliyet kırılımı, buybox, repricer, aksiyon, öğrenme, job, log ve ayar ekranları desktopta; dashboard ve ürün listesi 390x844 mobil viewportta görsel olarak doğrulandı.
- Preview güvenlik durumu: dry-run açık; global repricer ve scheduler kapalı.
- Son kabulde `/version` branch HEAD ile eşleşmiş; `/health` ve migration-aware `/ready` başarılıdır.
- Panel kabuğu `Cache-Control: no-store`, içerik hash'li statik dosyalar `immutable` olarak sunulur; yeni deploy sonrası eski panel sürümünün tarayıcıda kalması engellenmiştir.
- Production uygulaması, veritabanı ve öğrenen pilot geçmişi değiştirilmedi.
- Para motoru kuruş/oran ölçekli tam sayı aritmetiği kullanıyor; mapping önizlemesi de aynı hassasiyeti koruyor.
- `005_operational_controls` migrationı bakım modu ekliyor; `/ready` gerekli migration sürümünü denetliyor.
- Panelde kolon görünürlüğü, mapping önizleme/çoğaltma, maliyet kullanım/geçmişi, eksik komisyon ve kargo tarifesi uyarıları, kargo hesaplayıcı, buybox geçmiş grafiği ve fiyat düzenleyip onaylama akışları tamamlandı.
- Cost code mevcut olsa bile birim maliyet veya desisi sıfır olan mapping panelde `Maliyet eksik` gösterilir ve yeni toplu mappinge alınmaz.
- Gerçek preview verisinde 201 satırlık buybox tablosu ve geçmiş grafiği, fiyat aksiyonu listesi ve sistem ayarları son kez görsel olarak doğrulandı.
- PR öncesi kapsam denetiminde toplu maliyet kalemi yönetimi, tüm tablolarda CSV, veri hacmine uygun Mapping/Buybox/aksiyon sayfalaması, öğrenme detayı ve silme onayları tamamlandı.
- Ürün CSV aktarımı API'nin talep edilen sayfa limitini küçültmesi durumunda dönen gerçek limiti izleyerek tüm sayfaları toplar; regresyon testi ve 768 kayıtlı Railway preview kataloğu üzerinde doğrulandı.
- `009_remove_google_sheets_dependency` migrationı Sheets import/export joblarını ve ilgili sistem ayarlarını kaldırır.
- GitHub PR #1 açık, draft, merge edilmemiş ve `main <- feature/aslamaci-erp-v2` yönünde birleştirilebilir durumdadır.
- File Mac uygulamasındaki maliyet kalemleri alternatif arama ve kategori gezintisiyle tarandı; yalnız hedeflenen Harras, Actisoft ve Daycare markalarından 151 güncel ürün gözlemi preview fiyat havuzuna aktarıldı.
- Sıkılaştırılmış öneri motorunun gerçek preview kabulünde 33 aday üretildi: 2 yüksek, 17 kontrol gerekli, 14 düşük güven; 13 satır kardeş varyant fiyatı olarak uyarılıdır ve hiçbir mapping uygulanmamıştır.
- Mapping onay ve retleri immutable olay günlüğünde tutulur; marka, kategori, cost code ve doğrudan/varyant fiyat türü profili sonraki öneri skorunu en fazla artı/eksi 25 puan etkiler.
- Çoklu tedarikçi kabulünde Bizim Toptan havuzu 2.781, BİM havuzu 1.147 benzersiz ürünle doğrulandı; dondurulmuş ürünler ve ürün ağırlığı olmayan yaş/kilo/kâğıt gramajı ifadeleri desi otomasyonundan çıkarıldı.
- BİM canlı katalog sorgusu Chrome oturumu dışında doğrulandı; panel butonu ve varsayılan kapalı günlük job aynı fiyat havuzunu geçmişi koruyarak yeniler.
- `017_operations_finance_and_safety` migrationı boş PostgreSQL uyumlu test veritabanında çalıştı ve tekrar çalıştırılabilirliği doğrulandı.
- `018_hepsiburada_shipping_barems` migrationı Hepsiburada kargo/barem/ambalaj ayrımını, `hepsiJET` varsayılanını ve KDV dahil `10,50 TL` hizmet bedelini ekler; migration ve mobil panel regresyonları test edilmiştir.
- Satış & Kâr aylık raporundaki özet, grafik, şehir, ürün ve finansal hareket sorgularının tüm sonuç kolonları PostgreSQL anahtar sözcükleriyle çakışmayacak biçimde açık ve alıntılı takma ad kullanır.
- Ortak `useRemote` veri yükleyicisi her yeni denemede önceki hatayı temizler; başarılı tekrar deneme sonrasında sayfa eski hata ekranında kalmaz.
- Hepsiburada kargo PDF'i 4.501 desi satırı ve 11 taşıyıcı olarak yapılandırılmış veriye dönüştürüldü; hiçbir tarife satırı kaybolmadı.
- Aylık satış/kâr ekranı gider kırılımı, saat/gün/şehir analizi ve mobil yerleşimle görsel olarak doğrulandı.
- Hepsiburada servis anahtarı kaynak koda veya git geçmişine yazılmadı. Canlı bağlantı için Railway secret'ları ve mağaza Merchant ID hâlâ dış ortamda yapılandırılmalıdır.
