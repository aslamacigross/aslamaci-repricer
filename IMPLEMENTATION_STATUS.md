# Implementation Status

Son güncelleme: 2026-07-21 (Europe/Istanbul)

## Çoklu Pazaryeri İşletim Sistemi

- [x] Phase 1: Merkezi marketplace registry
- [x] Phase 1: Ortak adapter ve capability sözleşmesi
- [x] Phase 1: Trendyol hazır, Hepsiburada credential bekleyen adapter kaydı
- [x] Phase 1: Pazarama, İdefix, N11 ve PTTAVM skeleton adapterları
- [x] Phase 1: Secret göstermeyen Entegrasyonlar sayfası ve bağlantı testi
- [x] Phase 1: Credential eksik jobların güvenli skip sözleşmesi
- [x] Phase 1: Ürün/içerik/fırsat yayın anahtarlarının kapalı güvenlik varsayılanı
- [x] Phase 2: Merkezi PIM, reçete/listing modeli ve kimlik katmanları
- [x] Phase 2: Katalog eşleşmesi ve listing barkodu havuzu
- [x] Phase 3-4: Dry-run ürün yayınlama ve kanal aktarımı
- [x] Phase 5: Ürün/bundle fırsat motoru
- [x] Phase 6: AI İçerik Stüdyosu ve Listing Sağlığı
- [ ] Phase 7: Tam panel, E2E kabul ve dokümantasyon

## Tamamlanan

- [x] Mevcut cost code/mapping verisini silmeden idempotent PIM bootstrap
- [x] Fiziksel ürün, reçete ve marketplace listing kimliklerinin ayrılması
- [x] Deterministik bundle fingerprint ve duplicate reçete engeli
- [x] Açıklanabilir katalog eşleşme skoru ve kritik paket/varyant kilitleri
- [x] Önizleme ile rezervasyonu ayıran listing barkodu havuzu
- [x] Ana Katalog, Reçeteler & Bundle ve Listing Barkodları panel sayfaları
- [x] `024_product_publishing_and_channel_transfer` up/down migrationı
- [x] Kategori, zorunlu özellik, marka ve katalog eşleşmesi doğrulaması
- [x] Pazaryeri bazlı minimum fiyat ve ekonomik 1/2/3. sıra hedefleme
- [x] Açık reçete onayı, yayın taslağı ve adapter payload dry-run doğrulaması
- [x] İdempotent kanal aktarımı ve ürün bazlı hazır/engelli sınıflandırması
- [x] Ürün Yayınlama ve Kanal Aktarımı panel sayfaları
- [x] Phase 3-4 doğrulaması: 219 backend ve 29 React testi, ESLint ve build başarılı
- [x] `025_product_opportunity_engine` up/down migrationı
- [x] Açıklanabilir fırsat puanı, veri yeterliliği ve sinyal katkıları
- [x] Eksik tekli, kanal, paket, karma bundle, buybox, düşük rekabet ve yüksek marj fırsatları
- [x] Deterministik bundle sınırları, fingerprint ve duplicate engeli
- [x] İnsan onaylı reçete, ret geçmişi ve katalog araması workflow'u
- [x] Ürün Fırsatları paneli, filtreler, CSV, ayrıntı ve eksik veri görünümü
- [x] Phase 5 doğrulaması: 230 backend ve 32 React testi, ESLint ve build başarılı
- [x] `026_ai_content_and_listing_health` up/down migrationı
- [x] Sağlayıcıdan bağımsız, anahtarsız deterministic mock/draft içerik adapterı
- [x] PIM kaynak gerçekleri, provenance, paket adedi ve desteklenmeyen iddia güvenlik kontrolleri
- [x] İçerik diff, insan onayı, dry-run yayın ve yeniden onay isteyen rollback önizlemesi
- [x] Açıklanabilir listing kalite puanı, kanıt, öneri, beklenen etki ve ölçülecek KPI
- [x] İçerik Stüdyosu ve Listing Sağlığı panel ekranları
- [x] Phase 6 doğrulaması: 240 backend ve 35 React testi, migration up/down,
  ESLint ve production build başarılı

- [x] Repo, git geçmişi ve canlı endpoint envanteri
- [x] `feature/aslamaci-erp-v2` branch oluşturulması
- [x] V2 package script ve environment taslağı
- [x] İnce `index.js` bootstrap
- [x] Environment, database, sayı ve hata yardımcıları
- [x] Merkezi maliyet/minimum fiyat fonksiyonları
- [x] İlk repricer öneri ve safety fonksiyonları
- [x] Kalıcı proje bağlamı ve durum dosyaları
- [x] Geriye uyumlu, versioned ve down destekli migrationlar
- [x] Repository/service katmanı
- [x] Google Sheets bağı V2 runtime'dan tamamen kaldırıldı
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
- [x] Unit/integration/regression testleri: 181/181 başarılı
- [x] `004` migration ve atomik fiyat doğrulamasının gerçek PostgreSQL motorunda up/down testi
- [x] Menekşe fixture: 312,28 TL
- [x] Production frontend build ve code splitting
- [x] ESLint kontrolü
- [x] README, mimari, DB, deploy, repricer ve runbook dokümantasyonu
- [x] Railway build/start/health yapılandırması
- [x] Railway `preview-v2` deployment ve ayrı PostgreSQL doğrulaması
- [x] Panel kaynaklı transaction'lı mapping replace + hesaplama
- [x] 768 ürün ve 717 buybox kaydıyla preview API kabul turu
- [x] Menekşe manuel fiyat aksiyonu: `PENDING -> APPROVED -> DRY_RUN`, fiyat değişmedi
- [x] Desktop ve 390x844 mobil görsel kabul turu
- [x] Preview güvenlik anahtarlarının dry-run açık, repricer/job otomasyonu kapalı bırakılması
- [x] Product V2 Railway preview sync kabulü: 768 başarılı, 0 hatalı kayıt
- [x] `004` migration alanlarının preview ürün detayında görsel doğrulaması
- [x] Preview panel ayarlarında dry-run açık, repricer otomasyonu kapalı son kontrolü
- [x] Kuruş ve oran ölçekli tam sayı para motoru
- [x] `005_operational_controls`, bakım modu ve migration-aware `/ready`
- [x] Barkod kapsamlı güvenli toplu mapping önizleme ve benzer mapping çoğaltma
- [x] Maliyet kalemi kullanım/geçmişi ve komisyon değişiklik geçmişi
- [x] Eksik komisyon/kargo tarifesi uyarıları ve kargo maliyeti hesaplayıcı
- [x] Kalıcı tablo kolon görünürlüğü
- [x] Buybox geçmiş grafiği ve öğrenme/strateji dashboard grafikleri
- [x] Fiyat aksiyonunu minimum fiyat korumasıyla düzenleyip onaylama
- [x] Seçili aksiyona özel sonuç tekrar kontrolü
- [x] React bileşen testleri: 21/21 başarılı
- [x] Chrome masaüstü/mobil uçtan uca testleri: 8/8 başarılı
- [x] Backend testleri: 181/181 başarılı
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
- [x] `009_remove_google_sheets_dependency` migrationı ile Sheets import/export job ve ayarlarının kaldırılması
- [x] GitHub draft pull request: [#1 Aşlamacı ERP V2 production web panel](https://github.com/aslamacigross/aslamaci-repricer/pull/1)
- [x] `011_file_market_mapping_automation` migrationı ve geri alma migrationı
- [x] File Market güncel/önceki fiyat havuzu ve gözlem geçmişi
- [x] 65 hedef marka maliyet kalemi için alternatif arama ve kategori taraması
- [x] İlk hedefli fiyat toplama turu: yalnız Harras, Actisoft ve Daycare markalarından 151 ürün
- [x] Manuel mapping geçmişi, ürün adı, marka, kategori, gramaj ve paket adedi kullanan öneri motoru
- [x] Yüksek / kontrol gerekli / düşük güven bantları ve açıklanabilir kanıtlar
- [x] Kardeş File varyantı fiyatını uyarı rozetiyle ve en fazla kontrol düzeyinde önerme
- [x] Onay ile uygulamayı ayıran toplu önizleme, parmak izi ve transaction güvenliği
- [x] 30 günden eski File fiyatını maliyet güncellemesinde engelleme
- [x] Akıllı mapping ve File havuzu için masaüstü/mobil panel
- [x] Mapping önerisi üretme jobu; varsayılan kapalı
- [x] Preview fiyat havuzu kabulü: 151 File ürünü, yalnız Harras/Actisoft/Daycare
- [x] Gerçek preview öneri kabulü: 33 aday; 2 yüksek, 17 kontrol, 14 düşük güven
- [x] Kardeş varyant kabulü: 13 uyarılı öneri ve hatalı `x 300` paket adedi bulunmaması
- [x] `012_mapping_feedback_learning` migrationı ve geri alma migrationı
- [x] Immutable mapping onay/ret olay günlüğü ve panelde karar geçmişi
- [x] Örüntü bazlı onay/ret profiliyle sınırlı ve açıklanabilir güven skoru öğrenmesi
- [x] `014_supplier_price_pools` çoklu tedarikçi migrationı ve geri alma migrationı
- [x] File Market, Bizim Toptan ve BİM için birbirinden bağımsız fiyat havuzları
- [x] Bizim Toptan dondurulmuş gıda hariç canlı web katalog tarayıcısı
- [x] BİM/Yemeksepeti dondurulmuş gıda hariç canlı GraphQL katalog yenilemesi
- [x] Tedarikçi bazlı öneri filtresi ve farklı havuzların tek reçetede karışmasını engelleme
- [x] Tedarikçi ürünlerinde tahmini kesirli birim desi ve güven göstergesi
- [x] Nihai ürün desisinin toplam mapping sonrasında yukarı yuvarlanması
- [x] Bebek bezi kilo aralığı ve kâğıt gramajını desi ağırlığı sanmayan korumalar
- [x] Bizim canlı katalogda dondurulmuş kategori satırlarının güvenli dışlanması
- [x] `015_supplier_bulk_price_tiers` migrationı ile tedarikçi bazlı çoklu alım fiyat kademeleri
- [x] Bizim Toptan HTML'inden çoklu fiyat kademesi otomatik yakalama ve panelden manuel kademe düzenleme
- [x] Mapping önerisi ve uygulamasında ürün adedine göre uygun çoklu birim fiyatın seçilmesi
- [x] `016_bim_market_live_sync` migrationı, panel yenileme butonu ve varsayılan kapalı günlük BİM jobu
- [x] `017_operations_finance_and_safety` migrationı ve geri alma migrationı
- [x] File, Bizim ve BİM için her gece 00:00 Europe/Istanbul canlı fiyat yenileme planı
- [x] Tedarikçi fiyat değişikliğini cost code, mapping maliyeti ve minimum fiyat hesabına taşıma
- [x] Bizim çoklu alım fiyatını barkoda özel effective unit cost olarak koruma
- [x] Güvenli desi tahmini, inceleme kuyruğu ve manuel çözüm API'si
- [x] Günlük sistem sağlık taraması ve panel sağlık özeti
- [x] Trendyol sipariş/settlement senkronu ve aylık Satış & Kâr paneli
- [x] Aylık manuel ambalaj gideri, operasyonel kâr ve Bekir'e aktarılacak tutar hesabı
- [x] Günlük/saatlik/şehir/ürün/gider analizi ve kural tabanlı akıllı uyarılar
- [x] Barkod rekabetine göre 1-1440 dakika arası uyarlanabilir buybox senkronu
- [x] Başarısız buybox okumasını 5 dakika sonra tekrar kuyruğa alma
- [x] Aşağı yönde günlük yüzde 5 global sınır, yukarı yönde isteğe bağlı limitsiz adım
- [x] Hepsiburada salt-okunur sipariş ve bağlantı sağlığı istemcisi
- [x] Hepsiburada 13.07.2026 kargo PDF'inin 4.501 desi ve 11 taşıyıcıyla yapılandırılmış tarife importu
- [x] Trendyol/Hepsiburada segmentli aylık finans görünümü
- [x] Tek panelde global Trendyol/Hepsiburada seçimi
- [x] Ürün, mapping, komisyon, kargo, finans, dashboard, buybox, aksiyon ve öğrenme sorgularında pazaryeri izolasyonu
- [x] Aynı barkodun iki pazaryerindeki mapping ve desi hesaplarının bağımsız regresyon testi
- [x] Hepsiburada varsayılan `hepsiJET`, KDV dahil `10,50 TL` hizmet bedeli ve ayrı sepet baremleri
- [x] Hepsiburada aksiyonunun Trendyol fiyat servisine gidemediğini kanıtlayan sert entegrasyon kilidi
- [x] Backend testleri: 181/181; React testleri: 21/21; Chrome E2E testleri: 8/8; ESLint ve production build başarılı
- [x] Satış & Kâr aylık raporundaki tüm PostgreSQL sonuç kolonları açık ve güvenli takma adlarla doğrulandı
- [x] Başarılı tekrar denemede eski hata durumunu temizleyen ortak UI veri yükleyici regresyon testi
- [x] Trendyol settlement senkronunda 15 günlük API sınırına uygun parçalı tarih aralığı ve sayfalama
- [x] `019_trendyol_finance_history` ile 15 Aralık 2025'ten itibaren güvenli settlement geçmişi tamamlama
- [x] Aylık finans sorgularında Türkiye saati ay sınırı ve sipariş tarihi kullanımı
- [x] İade, kupon ve indirim komisyon düzeltmeleri dahil Haziran 2026 Trendyol mutabakatı
- [x] `020_trendyol_cargo_reconciliation` ile gerçek Trendyol kargo faturası tutarı ve kargodan alınan desi senkronu
- [x] Kargo faturası yokken eksiksiz barkod mapping desisinden güvenli sipariş kargo tahmini
- [x] Satış & Kâr ekranında sipariş bazlı faturalanan/mapping tahmini/eksik kargo kaynağı ayrımı
- [x] Railway preview kabulü: sürüm `2.8.0`, required migration `020`, 210 başarılı kargo fatura satırı ve gerçek desili sipariş doğrulaması
- [ ] Eski aylarda ürün adedi, iptal kırılımı ve geçmiş maliyet/kâr kesinliği için Trendyol panel raporu içe aktarma

## PR Öncesi Kapsam Denetimi

- [x] Şartnamedeki backend, migration, job, güvenlik ve entegrasyon maddeleri kaynak kod ve testlerle eşleştirildi
- [x] Şartnamedeki panel sayfaları, kolonlar, filtreler, durumlar ve günlük yönetim akışları yeniden denetlendi
- [x] Menekşe 312,28 TL, mapping atomic replace ve repricer safety regresyonları yeniden geçti
- [x] Desktop, mobil, CSV, toplu maliyet ve öğrenme detayı Chrome akışları geçti
- [x] Kullanıcı açık onayından sonra tek draft pull request oluşturulması

## Kullanıcı İncelemesi

- Preview'da 33 öneri kullanıcı incelemesine hazırdır; hiçbir öneri onaylanmadı veya mappinge uygulanmadı.

## Dış Ortamda Bekleyen

- [ ] Production DB backup/snapshot ve production dry-run migration/deploy (PR merge sonrasında ayrı işlem)
- [ ] Railway preview deneme planı sona ermeden kalıcı plan veya ortam kapatma kararı
- [ ] Railway preview'a `HB_MERCHANT_ID` ve gizli `HB_INTEGRATOR_KEY` tanımlayıp salt-okunur bağlantı testi
- [ ] Hepsiburada gerçek sipariş cevabıyla alan eşlemesini doğrulama ve komisyon/hizmet kesintisi mutabakatı
- [ ] Hepsiburada Merchant ID ve tam katalog/buybox/fiyat API kimlikleriyle hazır veri yüzeylerini canlı adaptöre bağlama
- [ ] Global dry-run kapatma ve canlı Trendyol repricer başlatma için ayrı kullanıcı onayı ve pilot kabulü

## Güvenlik Durumu

- Gerçek Trendyol fiyat çağrısı yapılmadı.
- Production veritabanına migration veya write yapılmadı.
- Preview'da Trendyol ürün/buybox verisi yalnızca read-only çekildi; manuel fiyat aksiyonu `DRY_RUN` durumunda tamamlandı ve fiyat değişmedi.
- Preview'da `DRY_RUN=true`, `REPRICER_ENABLED=false`, `JOBS_ENABLED=false` bırakıldı; Sheets sync ayarı ve jobları V2'den kaldırıldı.
- Akıllı mapping geliştirmesi Trendyol fiyat endpointlerini çağırmaz; öneri onayı tek başına mapping veya maliyet verisini değiştirmez.
- Çoklu tedarikçi fiyat kademeleri yalnız maliyet havuzu ve mapping maliyet kalemi hesabını etkiler; Trendyol fiyat gönderimi yapmaz.
- Global migration varsayılanı dry-run açık, repricer kapalıdır; bu iki korumayı riskli yöne çevirmek ayrıca canlı-mod onayı ister.
- Eski gerçek fiyat GET endpointi devre dışıdır.
- Hepsiburada servis anahtarı repository, log ve test fixture'larına yazılmadı.
- Hepsiburada sipariş adaptörü salt-okunurdur. Diğer ekranlar ve veri modeli platform bazında hazırdır; canlı katalog/buybox/fiyat adaptörü kimlikler gelene kadar sert kilitlidir.
