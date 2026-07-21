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
