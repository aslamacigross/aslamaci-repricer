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
- [x] Rank bazlı 1/2/3. sıra optimizasyonu ve kademeli artış/düşüş
- [x] Taze buybox verisiyle 5/15/60 dakika hedef sıra sonucu
- [x] Güvenli ve yeniden onaylanan fiyat geri alma akışı
- [x] REST API, admin auth, Helmet, CSRF, rate limit, audit ve error handling
- [x] Dry-run/global repricer değişiminde API seviyesinde canlı-mod onayı
- [x] Background joblar ve PostgreSQL advisory lock
- [x] React/Vite web panel ve mobil responsive düzen
- [x] Ürün, maliyet, mapping, komisyon, kargo, buybox, repricer, aksiyon, öğrenme, job, log ve ayar sayfaları
- [x] Unit/integration/regression testleri: 43/43 başarılı
- [x] Menekşe fixture: 312,28 TL
- [x] Production frontend build ve code splitting
- [x] ESLint kontrolü
- [x] README, mimari, DB, deploy, repricer ve runbook dokümantasyonu
- [x] Railway build/start/health yapılandırması

## Devam Eden

- [ ] Son lint/build/diff kontrolü, hardening commit'i, remote push ve tek draft pull request

## Dış Ortamda Bekleyen

- [ ] Railway preview deployment (branch push ve Railway preview environment gerekir)
- [ ] Görsel E2E (in-app localhost navigasyonu zaman aşımına uğradı; Chrome fallback sırasında Mac kilitliydi)
- [ ] Production şeması üzerinde read-only dry-run migration planı (DATABASE_URL yerel ortamda mevcut değil)

## Güvenlik Durumu

- Gerçek Trendyol fiyat çağrısı yapılmadı.
- Production veritabanına migration veya write yapılmadı.
- Canlı sistem yalnızca read-only health/version/summary endpointlerinden gözlemlendi.
- Global migration varsayılanı dry-run açık, repricer kapalıdır; bu iki korumayı riskli yöne çevirmek ayrıca canlı-mod onayı ister.
- Eski gerçek fiyat GET endpointi devre dışıdır.
