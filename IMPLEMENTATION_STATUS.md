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
- [x] Trendyol Product V2 ürün okuma uyumluluğu
- [x] Gönderim öncesi gerçek pazar fiyatı eşleştirmesi
- [x] Batch item + pazar fiyatı doğrulanmadan DB fiyatını değiştirmeme
- [x] Ayrı tek işlem ve günlük toplam fiyat değişim limitleri
- [x] Rank bazlı 1/2/3. sıra optimizasyonu ve kademeli artış/düşüş
- [x] Taze buybox verisiyle 5/15/60 dakika hedef sıra sonucu
- [x] Güvenli ve yeniden onaylanan fiyat geri alma akışı
- [x] REST API, admin auth, Helmet, CSRF, rate limit, audit ve error handling
- [x] Dry-run/global repricer değişiminde API seviyesinde canlı-mod onayı
- [x] Background joblar ve PostgreSQL advisory lock
- [x] React/Vite web panel ve mobil responsive düzen
- [x] Ürün, maliyet, mapping, komisyon, kargo, buybox, repricer, aksiyon, öğrenme, job, log ve ayar sayfaları
- [x] Unit/integration/regression testleri: 78/78 başarılı
- [x] `004` migration ve atomik fiyat doğrulamasının gerçek PostgreSQL motorunda up/down testi
- [x] Menekşe fixture: 312,28 TL
- [x] Production frontend build ve code splitting
- [x] ESLint kontrolü
- [x] README, mimari, DB, deploy, repricer ve runbook dokümantasyonu
- [x] Railway build/start/health yapılandırması
- [x] Railway `preview-v2` deployment ve ayrı PostgreSQL doğrulaması
- [x] Canlı Sheet uyumluluk importu: 4.230 kayıt, atomik replace + hesaplama
- [x] 768 ürün ve 717 buybox kaydıyla preview API kabul turu
- [x] Menekşe manuel fiyat aksiyonu: `PENDING -> APPROVED -> DRY_RUN`, fiyat değişmedi
- [x] Desktop ve 390x844 mobil görsel kabul turu
- [x] Preview güvenlik anahtarlarının dry-run açık, repricer/job/Sheet otomasyonu kapalı bırakılması
- [x] Product V2 Railway preview sync kabulü: 768 başarılı, 0 hatalı kayıt
- [x] `004` migration alanlarının preview ürün detayında görsel doğrulaması
- [x] Preview panel ayarlarında dry-run açık, repricer ve Sheets otomasyonu kapalı son kontrolü
- [x] Kuruş ve oran ölçekli tam sayı para motoru
- [x] `005_operational_controls`, bakım modu ve migration-aware `/ready`
- [x] Barkod kapsamlı güvenli toplu mapping önizleme ve benzer mapping çoğaltma
- [x] Maliyet kalemi kullanım/geçmişi ve komisyon değişiklik geçmişi
- [x] Eksik komisyon/kargo tarifesi uyarıları ve kargo maliyeti hesaplayıcı
- [x] Kalıcı tablo kolon görünürlüğü
- [x] Buybox geçmiş grafiği ve öğrenme/strateji dashboard grafikleri
- [x] Fiyat aksiyonunu minimum fiyat korumasıyla düzenleyip onaylama
- [x] Seçili aksiyona özel sonuç tekrar kontrolü
- [x] React bileşen testleri: 5/5 başarılı
- [x] Chrome masaüstü/mobil uçtan uca testleri: 3/3 başarılı
- [x] Backend testleri: 78/78 başarılı
- [x] Sıfır maliyet/desili cost item mappinglerinin `Maliyet eksik` ayrımı ve kayıt engeli
- [x] Railway preview son kabulü: branch HEAD, `/health`, `/ready` ve `/version` eşleşmesi başarılı
- [x] Panel kabuğunda `no-store`, hash'li statik dosyalarda uzun süreli immutable cache kontrolü
- [x] Gerçek preview verisinde buybox geçmiş grafiği, aksiyon listesi ve güvenli sistem ayarlarının son görsel kontrolü
- [x] Tüm operasyon tablolarında filtrelenmiş CSV dışa aktarma
- [x] API sayfa limiti küçülse bile Ürün CSV aktarımında bütün sayfaların birleştirilmesi
- [x] Railway preview'da Ürün ve Buybox CSV aktarımlarının 768/768 kayıtla doğrulanması
- [x] Transaction'lı toplu maliyet kalemi upsert ve panel akışı
- [x] Mapping, Buybox ve fiyat aksiyonlarında üretim hacmine uygun sayfalama
- [x] Öğrenme Merkezi son denemeler, strateji puanı ve sonraki adım çekmecesi
- [x] Ürünlerde manuel/sadece izle/otomatik mod ve ayrıntılı eksik veri filtreleri
- [x] Dashboard dry-run, global repricer, ürün sync ve buybox sync görünürlüğü
- [x] Maliyet, mapping, kargo, barem ve ambalaj silmelerinde onay penceresi
- [x] Yeni kurulumlarda otomatik Google Sheets sync varsayılan kapalı

## PR Öncesi Kapsam Denetimi

- [x] Şartnamedeki backend, migration, job, güvenlik ve entegrasyon maddeleri kaynak kod ve testlerle eşleştirildi
- [x] Şartnamedeki panel sayfaları, kolonlar, filtreler, durumlar ve günlük yönetim akışları yeniden denetlendi
- [x] Menekşe 312,28 TL, mapping atomic replace, Google hata koruması ve repricer safety regresyonları yeniden geçti
- [x] Desktop, mobil, CSV, toplu maliyet ve öğrenme detayı Chrome akışları geçti
- [ ] Kullanıcı açık onayından sonra tek draft pull request oluşturulması

## Devam Eden

- [ ] Kullanıcı açıkça onayladıktan sonra tek draft pull request oluşturulması

## Dış Ortamda Bekleyen

- [ ] `Aşlamacı ERP V2 production web panel` başlıklı draft pull request için kullanıcı onayı
- [ ] Production DB backup/snapshot ve production dry-run migration/deploy (PR merge sonrasında ayrı işlem)
- [ ] Railway preview deneme planı sona ermeden kalıcı plan veya ortam kapatma kararı

## Güvenlik Durumu

- Gerçek Trendyol fiyat çağrısı yapılmadı.
- Production veritabanına migration veya write yapılmadı.
- Preview'da Trendyol ürün/buybox verisi yalnızca read-only çekildi; manuel fiyat aksiyonu `DRY_RUN` durumunda tamamlandı ve fiyat değişmedi.
- Preview'da `DRY_RUN=true`, `REPRICER_ENABLED=false`, `JOBS_ENABLED=false`, `GOOGLE_SHEETS_SYNC_ENABLED=false` bırakıldı; paneldeki Sheets sync ayarı da kapatıldı.
- Global migration varsayılanı dry-run açık, repricer kapalıdır; bu iki korumayı riskli yöne çevirmek ayrıca canlı-mod onayı ister.
- Eski gerçek fiyat GET endpointi devre dışıdır.
