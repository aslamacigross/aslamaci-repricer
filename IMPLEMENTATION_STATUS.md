# Implementation Status

Son güncelleme: 2026-07-13 (Europe/Istanbul)

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
- [x] Unit/integration/regression testleri: 48/48 başarılı
- [x] Menekşe fixture: 312,28 TL
- [x] Production frontend build ve code splitting
- [x] ESLint kontrolü
- [x] README, mimari, DB, deploy, repricer ve runbook dokümantasyonu
- [x] Railway build/start/health yapılandırması
- [x] Railway `preview-v2` deployment ve ayrı PostgreSQL doğrulaması
- [x] Canlı Sheet uyumluluk importu: 4.230 kayıt, atomik replace + hesaplama
- [x] 764 ürün ve 717 buybox kaydıyla preview API kabul turu
- [x] Menekşe manuel fiyat aksiyonu: `PENDING -> APPROVED -> DRY_RUN`, fiyat değişmedi
- [x] Desktop ve 390x844 mobil görsel kabul turu
- [x] Preview güvenlik anahtarlarının dry-run açık, repricer/job/Sheet otomasyonu kapalı bırakılması

## Devam Eden

- [ ] Son belge commit'i, remote push ve kullanıcı onayından sonra tek draft pull request

## Dış Ortamda Bekleyen

- [ ] `Aşlamacı ERP V2 production web panel` başlıklı draft pull request için kullanıcı onayı
- [ ] Production DB backup/snapshot ve production dry-run migration/deploy (PR merge sonrasında ayrı işlem)
- [ ] Railway preview deneme planı sona ermeden kalıcı plan veya ortam kapatma kararı

## Güvenlik Durumu

- Gerçek Trendyol fiyat çağrısı yapılmadı.
- Production veritabanına migration veya write yapılmadı.
- Preview'da Trendyol ürün/buybox verisi yalnızca read-only çekildi; manuel fiyat aksiyonu `DRY_RUN` durumunda tamamlandı ve fiyat değişmedi.
- Preview'da `DRY_RUN=true`, `REPRICER_ENABLED=false`, `JOBS_ENABLED=false`, `GOOGLE_SHEETS_SYNC_ENABLED=false` bırakıldı.
- Global migration varsayılanı dry-run açık, repricer kapalıdır; bu iki korumayı riskli yöne çevirmek ayrıca canlı-mod onayı ister.
- Eski gerçek fiyat GET endpointi devre dışıdır.
