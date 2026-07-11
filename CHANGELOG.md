# Changelog

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
- Job history, advisory lock, audit ve integration logları
- Railway build/health yapılandırması
- 28 unit/integration/regression test

### Changed

- 3.479 satırlık `index.js` ince bootstrap seviyesine indirildi.
- Google Sheets ana kontrol paneli olmaktan çıkarılıp geçiş/import/export katmanına alındı.
- Öğrenme sonucu anlık kontrol yerine gecikmeli outcome ölçümüne taşındı.
- Fiyat yönü etiketi merkezi matematiksel kurala bağlandı.

### Preserved

- Mevcut ürün, maliyet, mapping, buybox ve price war tabloları
- Öğrenen pilot değerleri ve buybox snapshot geçmişi
- Kargo/barem KDV davranışı

### Security

- Varsayılan dry-run açık, global repricer kapalıdır.
- Eski korumasız fiyat uygulama GET endpointi devre dışıdır.
- Gerçek Trendyol fiyat gönderimi bu sürüm geliştirme ve test sürecinde çalıştırılmamıştır.
