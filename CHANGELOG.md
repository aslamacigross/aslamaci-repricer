# Changelog

## 2.9.0 - 2026-07-21

- Merkezi marketplace registry ve ortak adapter/capability sözleşmesi eklendi.
- Trendyol hazır, Hepsiburada credential bekleyen, Pazarama/İdefix/N11/PTTAVM ise güvenli skeleton olarak kaydedildi.
- Credential değerlerini göstermeyen Entegrasyonlar sayfası ve güvenli bağlantı testi eklendi.
- Ürün yayınlama, otomatik içerik güncelleme ve fırsat otomatik yayın bayrakları varsayılan kapalı eklendi.
- Merkezi fiziksel ürün, reçete/bundle ve marketplace listing PIM modeli eklendi.
- Mevcut mappinglerden açık onaylı, transaction'lı ve idempotent PIM bootstrap eklendi.
- Açıklanabilir katalog eşleştirme, kimlik katmanları ve listing barkodu havuzu eklendi.
- Ana Katalog, Reçeteler & Bundle ve Listing Barkodları yönetim ekranları eklendi.
- Readiness zorunlu migration sürümü `023_pim_and_listing_identity` olarak güncellendi.
- Kategori/özellik/marka sözlükleri ile yayın taslağı ve kanal aktarımı için
  `024_product_publishing_and_channel_transfer` migrationı eklendi.
- Açık reçete onayı, yalnız payload doğrulayan ürün yayınlama dry-run'ı ve
  idempotent kanala kopyalama önizlemesi eklendi.
- Hedef pazaryeri maliyetleriyle ekonomik 1., 2. veya 3. sıra fiyat önerisi
  merkezi fiyat motoruna bağlandı.
- Readiness zorunlu migration sürümü
  `024_product_publishing_and_channel_transfer` olarak güncellendi.
- Açıklanabilir ürün ve bundle fırsat motoru ile
  `025_product_opportunity_engine` migrationı eklendi.
- Eksik tekli/kanal/paket, karma bundle, ekonomik buybox, düşük rekabet ve
  yüksek marj fırsatları; deterministik sinyal katkılarıyla görünür hale geldi.
- Fırsat reçetesi onayı, ret geçmişi ve kontrollü katalog araması gerçek yayın
  adımlarından ayrıldı; tüm akış `mutationPerformed=false` güvenliğinde kaldı.
- Ürün Fırsatları ekranı filtre, CSV, veri yeterliliği, ekonomi, katalog ve olay
  geçmişi ayrıntılarıyla eklendi.
- Readiness zorunlu migration sürümü `025_product_opportunity_engine` oldu.
- Sağlayıcıdan bağımsız İçerik Stüdyosu, PIM kaynak gerçekleri ve provenance
  tabanlı güvenli taslak üretimi eklendi.
- Paket adedi uyuşmazlığını ve kaynaksız ürün iddialarını engelleyen içerik
  doğrulaması; diff, snapshot, insan onayı ve rollback önizlemesi eklendi.
- Kanıt, öneri, beklenen etki, ölçülecek KPI ve eksik veri gösteren açıklanabilir
  Listing Sağlığı taraması eklendi.
- `026_ai_content_and_listing_health` migrationı eklendi; içerik yayınlama
  yalnız dry-run'dır ve `CONTENT_AUTO_UPDATE_ENABLED=false` kalır.
- Readiness zorunlu migration sürümü `026_ai_content_and_listing_health` oldu.
- Demo kabul sunucusu merkezi PIM, katalog/yayın, fırsat, içerik ve listing sağlık
  sözleşmeleriyle genişletildi; marketplace izolasyonu fixture'larda korundu.
- Playwright kapsamı 13 uçtan uca senaryoya çıkarıldı ve 390x844 mobil görünüm
  taşma kontrolleri eklendi.
- Development/demo login limiti test izolasyonu için artırıldı; production
  8 deneme / 15 dakika güvenlik sınırı değiştirilmedi.
- Kanal aktarımı idempotency anahtarı draft öncesine taşındı; batch, draft ve
  item yazımları tek transaction içinde duplicate/orphan bırakmadan çalışır.
- Adapter operation-capability kontrolü fail-closed yapıldı ve bilinmeyen
  operasyonlar `CAPABILITY_NOT_SUPPORTED` sonucuna bağlandı.
- Katalog eşleştirmeye güvenli ölçü normalizasyonu ile ürün adı/aile fuzzy alias
  sinyali eklendi; hard paket, varyant ve bundle kilitleri korunarak fuzzy
  sonuçlar insan incelemesinde bırakıldı.
- Katalog barkodu, seller listing barkodu, seller SKU ve marketplace product ID
  semantiği adapter resolver sözleşmesiyle ayrıldı.
- Playwright demo UI E2E ile gerçek Express + geçici PostgreSQL backend E2E
  profilleri ayrıldı; migration up/down/idempotency gerçek PostgreSQL motorunda
  doğrulandı.
- Hepsiburada adapteri `HEPSIBURADA_ENV=sit|production`, developer
  `User-Agent`, endpoint override ve mutasyon kilidi bilgisini secret
  göstermeden runtime status olarak raporlar hale getirildi.
- Hepsiburada test credential'ları ile canlı production credential'larının
  farklı olduğu ve canlı geçiş için Merchant Panel API Entegrasyon Teknik Destek
  talebi gerektiği dokümante edildi.

## 2.0.0 - 2026-07-12

### Added

- React/Vite Türkçe ERP yönetim paneli
- Admin auth, HttpOnly session, CSRF, rate limit, CORS ve security headers
- Modüler Express API, repositories ve services
- Versioned transaction migration sistemi
- PostgreSQL merkezli ürün, maliyet, mapping, komisyon ve ayar yönetimi
- Atomic Google Sheets import ve korumalı export
- Repricer action/decision/outcome tabloları
- 5/15/60 dakika öğrenme outcome jobları
- Hedef sıra, buybox geçmişi, rakip gözlemi ve fiyat sonucu veri sözleşmeleri
- Güvenli, bağlı ve yeniden onaylanan fiyat geri alma aksiyonları
- Job history, advisory lock, audit ve integration logları
- Railway build/health yapılandırması
- 78 backend unit/integration/regression, 5 React bileşen ve 3 Chrome uçtan uca test
- Transaction'lı toplu maliyet kalemi yönetimi ve ortak CSV dışa aktarma
- Öğrenme geçmişi çekmecesi, strateji puanları ve açıklamalı sonraki adım
- Mapping, Buybox ve fiyat aksiyonlarında veri hacmine uygun sayfalama
- Dashboard global güvenlik ve ayrı sync durumları
- Maliyet, mapping, kargo ve ambalaj silmelerinde ikinci kullanıcı onayı

### Changed

- 3.479 satırlık `index.js` ince bootstrap seviyesine indirildi.
- Google Sheets ana kontrol paneli olmaktan çıkarılıp geçiş/import/export katmanına alındı.
- Öğrenme sonucu anlık kontrol yerine gecikmeli outcome ölçümüne taşındı.
- Fiyat yönü etiketi merkezi matematiksel kurala bağlandı.
- Repricer ekonomik olarak mümkün olan en iyi 1/2/3. sırayı, aksi halde mevcut sıradaki en yüksek güvenli kârı hedefler.
- Outcome ölçümü yalnızca taze ve barkod hedefli buybox yenilemesinden sonra yazılır.
- Sistem logları arama, seviye filtresi ve sayfalama kazandı.
- Otomatik Google Sheets senkronu yeni kurulumlarda varsayılan kapalıya alındı.
- Ürün CSV aktarımı API'nin gerçek sayfa limitine uyarlanarak tüm katalog kayıtlarını toplar.

### Preserved

- Mevcut ürün, maliyet, mapping, buybox ve price war tabloları
- Öğrenen pilot değerleri ve buybox snapshot geçmişi
- Kargo/barem KDV davranışı

### Security

- Varsayılan dry-run açık, global repricer kapalıdır.
- Eski korumasız fiyat uygulama GET endpointi devre dışıdır.
- Dry-run kapatma ve global repricer açma ikinci canlı-mod onayı gerektirir.
- Gerçek Trendyol fiyat gönderimi bu sürüm geliştirme ve test sürecinde çalıştırılmamıştır.
