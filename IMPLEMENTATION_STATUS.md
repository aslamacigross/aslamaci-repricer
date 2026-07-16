# Implementation Status

Son güncelleme: 2026-07-16 (Europe/Istanbul)

## Tamamlanan

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
- [x] Unit/integration/regression testleri: 134/134 başarılı
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
- [x] React bileşen testleri: 14/14 başarılı
- [x] Chrome masaüstü/mobil uçtan uca testleri: 6/6 başarılı
- [x] Backend testleri: 134/134 başarılı
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
- [x] BİM/Yemeksepeti dondurulmuş gıda hariç tarayıcı destekli katalog aktarımı
- [x] Tedarikçi bazlı öneri filtresi ve farklı havuzların tek reçetede karışmasını engelleme
- [x] Tedarikçi ürünlerinde tahmini kesirli birim desi ve güven göstergesi
- [x] Nihai ürün desisinin toplam mapping sonrasında yukarı yuvarlanması

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

## Güvenlik Durumu

- Gerçek Trendyol fiyat çağrısı yapılmadı.
- Production veritabanına migration veya write yapılmadı.
- Preview'da Trendyol ürün/buybox verisi yalnızca read-only çekildi; manuel fiyat aksiyonu `DRY_RUN` durumunda tamamlandı ve fiyat değişmedi.
- Preview'da `DRY_RUN=true`, `REPRICER_ENABLED=false`, `JOBS_ENABLED=false` bırakıldı; Sheets sync ayarı ve jobları V2'den kaldırıldı.
- Akıllı mapping geliştirmesi Trendyol fiyat endpointlerini çağırmaz; öneri onayı tek başına mapping veya maliyet verisini değiştirmez.
- Global migration varsayılanı dry-run açık, repricer kapalıdır; bu iki korumayı riskli yöne çevirmek ayrıca canlı-mod onayı ister.
- Eski gerçek fiyat GET endpointi devre dışıdır.
