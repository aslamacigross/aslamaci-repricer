# Implementation Status

Son güncelleme: 2026-07-12

## Tamamlanan

- [x] Repo, git geçmişi, canlı endpointler ve Sheet sekmeleri envanteri
- [x] `feature/aslamaci-erp-v2` branch oluşturulması
- [x] V2 package script ve environment taslağı
- [x] İnce `index.js` bootstrap
- [x] Environment, database, sayı ve hata yardımcıları
- [x] Merkezi maliyet/minimum fiyat fonksiyonları
- [x] İlk repricer öneri ve safety fonksiyonları
- [x] Kalıcı proje bağlamı ve durum dosyaları
- [x] Geriye uyumlu, versioned ve down destekli migrationlar
- [x] Repository/service katmanı
- [x] Google Sheets retry, timeout, circuit breaker ve atomic import
- [x] Trendyol entegrasyonu ve dry-run action servisi
- [x] REST API, admin auth, CSRF, rate limit, audit ve error handling
- [x] Background joblar ve PostgreSQL advisory lock
- [x] React/Vite web panel ve mobil responsive düzen
- [x] Ürün, maliyet, mapping, komisyon, kargo, buybox, repricer, aksiyon, öğrenme, job, log ve ayar sayfaları
- [x] Unit/integration/regression testleri: 28/28 başarılı
- [x] Menekşe fixture: 312,28 TL
- [x] Production frontend build ve code splitting
- [x] ESLint kontrolü
- [x] README, mimari, DB, deploy, repricer ve runbook dokümantasyonu
- [x] Railway build/start/health yapılandırması

## Devam Eden

- [ ] Mantıksal commitler, remote push ve tek pull request

## Dış Ortamda Bekleyen

- [ ] Railway preview deployment (branch push ve Railway preview environment gerekir)
- [ ] In-app Browser görsel E2E (yerel browser bağlantısı localhost navigasyonunda zaman aşımına uğradı)
- [ ] Production şeması üzerinde read-only dry-run migration planı (DATABASE_URL yerel ortamda mevcut değil)

## Güvenlik Durumu

- Gerçek Trendyol fiyat çağrısı yapılmadı.
- Production veritabanına migration veya write yapılmadı.
- Canlı sistem yalnızca read-only health/version/summary endpointlerinden gözlemlendi.
- Global migration varsayılanı dry-run açık, repricer kapalıdır.
- Eski gerçek fiyat GET endpointi devre dışıdır.
