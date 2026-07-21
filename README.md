# Aşlamacı ERP V2

Trendyol ve Hepsiburada ürün maliyeti, minimum fiyat, buybox ve repricer operasyonlarını PostgreSQL merkezli tek bir web panelde yöneten Node.js/React uygulamasıdır. Üst bardaki pazaryeri seçimi bütün ekranı değiştirir; iki platformun ürün, mapping, komisyon, kargo, finans, buybox ve aksiyon verileri birbirine karışmaz.

## Özellikler

- Güvenli admin girişi, HttpOnly session ve CSRF koruması
- Ürün, maliyet kalemi, mapping, komisyon, kargo ve ambalaj yönetimi
- Açıklamalı minimum fiyat ve net kâr kırılımı
- Buybox takibi ve ürün bazlı repricer ayarları
- Sıra bazlı kâr optimizasyonu, onaylı fiyat aksiyonları ve çok katmanlı safety gate
- Trendyol Product V2 okuma, gönderim öncesi pazar fiyatı kontrolü ve batch doğrulaması
- 5/15/60 dakika taze buybox sonuç ölçümü ve açıklanabilir öğrenme
- Yeniden onay gerektiren izlenebilir fiyat geri alma akışı
- PostgreSQL advisory lock kullanan job sistemi
- Audit, entegrasyon ve job logları
- Mobil uyumlu Türkçe React paneli
- Kolon görünürlüğü, güvenli toplu mapping önizlemesi ve mapping çoğaltma
- Buybox geçmiş grafiği, kargo hesaplayıcı ve eksik tarife uyarıları
- Bakım modu, migration-aware readiness ve fiyat aksiyonu düzenleyip onaylama
- Tüm operasyon tablolarında CSV dışa aktarma ve kalıcı kolon görünürlüğü
- Transaction içinde toplu maliyet kalemi upsert ve silme onayları
- Mapping, Buybox ve fiyat aksiyonu listelerinde gerçek veri hacmine uygun sayfalama
- Son fiyat denemeleri, strateji puanları ve açıklamalı sonraki adımla öğrenme detayı
- Dashboard üzerinde dry-run, global repricer ve ayrı ürün/buybox sync durumu
- File Market fiyat havuzu, fiyat değişim geçmişi ve 30 günlük güncellik koruması
- Eski manuel mappinglerden öğrenen, paket adedini ölçekleyen güven skorlu mapping önerileri
- Öneri onayı ile gerçek mapping uygulamasını ayıran toplu önizleme ve atomik uygulama akışı
- File, Bizim ve BİM fiyatlarını her gece Türkiye saatiyle 00:00'da yenileyen maliyet zinciri
- Barkod rekabetine göre 1 dakika ile 1 gün arasında adaptif buybox kontrolü
- Günlük veri/entegrasyon/job sağlık taraması ve desi kontrol kuyruğu
- Aylık sipariş, operasyonel nakit kârı, ambalaj ve aktarılacak tutar raporu
- Tek panelde global Trendyol/Hepsiburada seçimi ve pazaryeri bazlı veri izolasyonu
- Hepsiburada read-only sipariş adaptörü, ayrı finans/maliyet yüzeyi ve 13 Temmuz 2026 kargo tarifesi
- Hepsiburada için varsayılan `hepsiJET`, KDV dahil `10,50 TL` hizmet bedeli ve ayrı sepet baremleri
- Merkezi PIM, reçete/bundle, katalog eşleşmesi ve ayrı listing kimlik katmanları
- Açık onaylı reçete, ürün yayınlama dry-run'ı ve idempotent kanala kopyalama önizlemesi
- Hedef pazaryerine özel maliyet ve ekonomik 1/2/3. sıra fiyat önerisi
- PIM kaynak gerçeklerinden güvenli taslak üreten İçerik Stüdyosu
- Diff, snapshot, insan onayı ve yalnız dry-run içerik yayınlama akışı
- Kanıt, öneri, beklenen etki ve KPI içeren açıklanabilir Listing Sağlığı

## Gereksinimler

- Node.js 20+
- pnpm 10.34.5 (repo `packageManager` alanıyla sabitlenmiştir)
- PostgreSQL 14+

## Yerel Kurulum

```bash
pnpm install
cp .env.example .env
pnpm migrate
pnpm dev
```

Backend `http://localhost:3000`, Vite geliştirme sunucusu `http://localhost:5173` üzerinde açılır.

Gerçek DB olmadan UI incelemek için:

```bash
pnpm build
pnpm demo
```

Demo girişi yalnızca yerel fixture sunucusunda `admin / demo12345678` şeklindedir. Production girişi environment değişkenlerinden gelir.

## Komutlar

| Komut                      | Açıklama                                                 |
| -------------------------- | -------------------------------------------------------- |
| `pnpm dev`                 | Backend ve frontend geliştirme modu                      |
| `pnpm build`               | Production React build                                   |
| `pnpm start`               | Migration + tek servis production başlangıcı             |
| `pnpm migrate`             | Bekleyen migrationları uygular                           |
| `pnpm migrate:down`        | Son migration setlerini geri alır; önce yedek zorunludur |
| `pnpm test`                | Unit, integration ve regression testleri                 |
| `pnpm test:ui`             | React bileşen testleri                                   |
| `pnpm test:e2e`            | Yerel dry-run fixture üzerinde Chrome uçtan uca testleri |
| `pnpm lint`                | Backend ve frontend statik kontrolü                      |
| `pnpm hash-password "..."` | Production parola hash'i üretir                          |

## Environment Variables

Mevcut zorunlu entegrasyon değişkenleri:

- `DATABASE_URL`
- `TY_API_KEY`
- `TY_API_SECRET`
- `TY_SUPPLIER_ID`
- `TY_STOREFRONT_CODE`: varsayılan `TR`
- `PORT`
- `NODE_ENV`

V2 ile eklenenler:

- `ADMIN_USERNAME`: varsayılan `admin`
- `ADMIN_PASSWORD`: en az 12 karakter; hash kullanılmıyorsa
- `ADMIN_PASSWORD_HASH`: önerilen production parola biçimi
- `SESSION_SECRET`: en az 32 rastgele karakter
- `ALLOWED_ORIGIN`: virgülle ayrılmış CORS allowlist
- `DRY_RUN`: varsayılan `true`
- `REPRICER_ENABLED`: varsayılan `false`
- `JOBS_ENABLED`: varsayılan `true`
- `DEFAULT_CARRIER`: varsayılan `TEX`
- `DEFAULT_SERVICE_FEE`: varsayılan `13.19`
- `DEFAULT_TARGET_PROFIT`: varsayılan `40`
- `DEFAULT_MAX_INCREASE_TL`: varsayılan `10`
- `BUYBOX_MAX_AGE_MINUTES`: varsayılan `20`
- `GLOBAL_MAX_PRICE_CHANGE_PCT`: varsayılan `15`
- `MIN_PRICE_CHANGE_TL`: varsayılan `0.10`
- `LOG_RETENTION_DAYS`: varsayılan `90`
- `SKIP_MIGRATIONS`: yalnızca kontrollü bakımda migration başlangıcını atlar; varsayılan `false`
- `HB_MERCHANT_ID`: Hepsiburada Satıcı ID
- `HB_USERNAME`: varsa ayrı Hepsiburada API kullanıcı adı; boşsa Satıcı ID kullanılır
- `HB_PASSWORD`: varsa doğrudan API parolası
- `HB_INTEGRATOR_KEY`: panelde üretilen servis anahtarı; yalnız secret store'da tutulur
- `PRODUCT_PUBLISHING_ENABLED`: varsayılan `false`; mevcut sürüm gerçek yayına izin vermez
- `CONTENT_AUTO_UPDATE_ENABLED`: varsayılan `false`
- `OPPORTUNITY_AUTO_PUBLISH_ENABLED`: varsayılan ve fiilî değer `false`

Tam liste [.env.example](.env.example) dosyasındadır.

## Güvenli İlk Çalıştırma

1. `DRY_RUN=true` ve `REPRICER_ENABLED=false` bırakılır.
2. Migration uygulanır; `/health` ve `/ready` kontrol edilir.
3. Panelden ürün, Menekşe maliyet kırılımı ve buybox sync doğrulanır.
4. Repricer yalnızca pilot ürünlerde önizlenir.
5. Gerçek fiyat modu ayrı kullanıcı onayıyla daha sonra açılır.

Panelde dry-run kapatılırken veya global repricer açılırken ikinci bir canlı-mod onayı gerekir. Manuel aksiyonlar otomasyon kapalıyken kullanılabilir; yine de dry-run, minimum fiyat, maliyet, kâr, buybox güncelliği, tek işlem/günlük limit ve cooldown kontrollerini geçmek zorundadır. Canlı gönderim öncesinde Trendyol Product V2 üzerinden barkodun gerçek fiyatı yeniden okunur; DB fiyatıyla eşleşmezse istek gönderilmez. Batch kabulü ürün fiyatını kesinleştirmez; batch item sonucu ve pazaryerinde görülen fiyat doğrulanana kadar ürün kaydı değişmez.

## Veri Yönetimi

PostgreSQL ana ve tek uygulama veri kaynağıdır. Trendyol ürün, fiyat, stok ve komisyon bilgileri Trendyol API üzerinden alınır. Maliyet kalemleri, mapping, kargo, ambalaj ve repricer ayarları web panelden yönetilir; V2 içinde Google Sheets import/export veya eski Sheet komutları kullanılmaz.

Hepsiburada seçildiğinde aynı ekranlar yalnız `marketplace='HEPSIBURADA'` kayıtlarını kullanır. Ortak fiziksel maliyet kalemleri paylaşılabilir; barkod mappingi, ürün hesapları, kargo/barem/ambalaj, hizmet bedeli, dashboard önbelleği, buybox geçmişi, repricer aksiyonu ve finans kaydı pazaryeri anahtarıyla ayrıdır. Hepsiburada varsayılan kargosu `hepsiJET`, hizmet bedeli KDV dahil `10,50 TL`'dir.

`Ürün Yayınlama` ve `Kanal Aktarımı` ekranları bu sürümde yalnız dry-run üretir.
Taslaklar hedef kanalın kategori, özellik, marka, maliyet, desi, komisyon, kargo,
ambalaj, listing barkodu ve capability durumunu açık blocker kodlarıyla gösterir.
Adapter doğrulaması başarılı olsa bile gerçek ürün, teklif, içerik, fiyat veya stok
çağrısı yapılmaz.

`Ürün Fırsatları` ekranı tedarikçi havuzları, PIM reçeteleri, hedef listingler,
buybox ve sipariş geçmişinden açıklanabilir adaylar üretir. Skor bir satış vaadi
değildir; kullanılan sinyaller, eksik veriler ve güven seviyesi ayrı gösterilir.
Öneri reçetesi insan onayı almadan PIM'e eklenmez, katalog araması listing barkodu
tüketmez ve hiçbir fırsat otomatik yayınlanmaz. Ayrıntılar
[PRODUCT_OPPORTUNITY_ENGINE.md](PRODUCT_OPPORTUNITY_ENGINE.md) dosyasındadır.

`İçerik Stüdyosu` anahtar olmadan deterministic `MOCK_DRAFT` modunda çalışır.
Başlık, açıklama, arama terimleri ve görsel brief'ler yalnız PIM kaynak
gerçeklerinden üretilir. Paket adedi veya desteklenmeyen iddia doğrulaması
başarısızsa içerik onaylanamaz. İçerik yayınlama bu sürümde yalnız dry-run'dır;
adapter mutasyon metodu çağrılmaz. `Listing Sağlığı` skorları algoritmik yükselme
vaadi değil, kanıtlı kalite sorunları ve ölçülebilir iyileştirme önerileridir.
Ayrıntılar [AI_CONTENT_SAFETY.md](AI_CONTENT_SAFETY.md) dosyasındadır.

Paneldeki toplu mapping işlemi önce maliyet/desi önizlemesi ister ve yalnızca gönderilen barkodları transaction içinde yeniler. Tüm mapping tablosunu değiştiren uyumluluk endpointi ayrıca `MAPPING_TAM_YENILE` açık onayı ister. Cost code mevcut olsa bile birim maliyeti veya desisi sıfır olan kalem `Maliyet eksik` gösterilir ve panelden yeni toplu mappinge alınmaz. Maliyet kalemleri panelden kopyala-yapıştır yöntemiyle toplu upsert edilebilir; tüm satırlar doğrulanmadan transaction başlamaz.

Job sıklıkları environment yerine PostgreSQL ve Sistem Ayarları ekranından yönetilir. Böylece panelde yapılan değişiklikler servis yeniden başladığında korunur. File, Bizim ve BİM fiyat jobları `Europe/Istanbul` saat diliminde her gün 00:00'da sırayla çalışır. Onaylı tedarikçi bağlantılarında fiyat değişirse maliyet kalemi ve varsa Bizim adet kademesi güncellenir; bağlı barkodların minimum fiyatı aynı akışta yeniden hesaplanır. 00:20'de desi tahmini, 00:30'da sistem sağlık taraması çalışır.

Mapping ekranı tüm mapping kümesini alıp 100 satırlık sayfalara böler. Buybox ve fiyat aksiyonları büyüyen katalog için server-side aranıp sayfalanır. Ürün ve Buybox CSV aktarımı gerekirse bütün API sayfalarını birleştirir; diğer tablolar seçili kolonları ve filtrelenmiş kayıt kümesini kullanır.

### Akıllı Mapping ve Tedarikçi Fiyat Havuzları

`Ürün Mapping` sayfası mevcut mappingler, akıllı öneriler, File Market, Bizim Toptan ve BİM fiyat havuzları, teşhis, manuel maliyet kuyruğu ve karar geçmişini birlikte yönetir. Her tedarikçinin havuzu ve fiyat geçmişi ayrıdır. Öneri motoru aynı tedarikçideki ürünleri ürün adı, marka, gramaj/hacim, kategori ve paket adediyle karşılaştırır; farklı tedarikçi ürünlerini tek reçetede karıştırmaz.

File Market kendi canlı katalog kaynağından, Bizim Toptan herkese açık web kataloğundan ve BİM Yemeksepeti'nin ürün GraphQL servisinden panel üzerinden yenilenebilir. BİM senkronu hesap çerezi veya kullanıcı tokenı kullanmaz; sabit mağaza kataloğundaki ürün adı, fiyat, bulunabilirlik, kategori ve görselleri alır. BİM'de yalnız Dondurulmuş Gıda kategorisi otomatik toplama kapsamı dışındadır.

Aynı marka, ürün ailesi ve ölçüdeki farklı koku/aroma varyantları File'da aynı fiyatı taşıyorsa motor bunu `Varyant fiyatı` olarak açıkça işaretler. Yeni varyant örüntüleri `Kontrol gerekli` düzeyini aşmaz; en az 5 kullanıcı kararı ve yüzde 90 kabul oranından sonra yüksek güven kilidi açılabilir.

Her onay ve ret `Karar geçmişi` ekranında kullanıcı, tarih, cost code, ret notu ve karar anındaki güvenle saklanır. Aynı marka/kategori/cost code/File eşleşme türündeki kararlar bir öğrenme profili oluşturur; sonraki öneri skoru kontrollü biçimde yükselir veya düşer. Öğrenme etkisi artı/eksi 25 puanla sınırlıdır ve hiçbir zaman kullanıcı onayı ile toplu uygulama güvenliğini atlamaz.

Öneriyi onaylamak veriyi değiştirmez. Yalnız `Onaylandı` durumundaki satırlar toplu önizleme ve ikinci bir uygulama adımından sonra transaction içinde mappinge çevrilir; ürün maliyetleri aynı transactionda yeniden hesaplanır. Tedarikçi fiyatı 30 günden eskiyse maliyet güncellemesi engellenir. Birim desi kesirli saklanır; mapping reçetesinin nihai toplam desisi kargo ve ambalaj hesabından önce yukarı yuvarlanır (`0,25 → 1`, `1,5 → 2`). Ayrıntılı işletim akışı [MAPPING_AUTOMATION.md](MAPPING_AUTOMATION.md) dosyasındadır.

## Railway

Repo kökündeki `railway.toml` build, start ve health check ayarlarını içerir. Ayrıntılı akış [DEPLOYMENT.md](DEPLOYMENT.md), acil durum adımları [RUNBOOK.md](RUNBOOK.md) içindedir.

### Satış ve Kâr

`Satış & Kâr` sayfası Trendyol siparişlerini ve finansal hareketleri ay bazında toplar. Operasyonel nakit kârı:

`ciro - komisyon - kargo - hizmet bedeli - ürün alış maliyeti - aylık ambalaj`

olarak gösterilir. Komisyon/kargo/hizmet bedeli pazaryeri ödemesinden kesildiği için Bekir'in kişisel nakit çıkışına ikinci kez eklenmez. Ekrandaki “Sana aktarılacak” tutar, Bekir'in finanse ettiği ürün ve ambalaj gideri ile ambalaj sonrası operasyonel kârın toplamıdır. Bu görünüm şirketin KDV hariç muhasebe kârı değildir; ürün bazlı alış/satış KDV'si ve fatura kayıtları mali müşavirle ayrıca doğrulanmalıdır.

Trendyol kargo faturası oluştuğunda siparişin gerçek kargo tutarı ve kargodan alınan desi Cargo Invoice Details servisinden alınır. Fatura henüz yoksa siparişteki barkodların mapping desileri adetleriyle toplanıp yukarı yuvarlanır ve Trendyol sepet baremi/desi tarifesinden tahmini kargo hesaplanır. Siparişte tek bir desi dahi eksikse bu tahmin güvenilir kabul edilmez. Sipariş tablosu kaynağı `Faturalanan`, `Mapping tahmini` veya `Eksik` olarak açıkça gösterir.

## Bilinen Sınırlamalar

- Öğrenme motoru ilk sürümde açıklanabilir ve deterministik kurallıdır; bağımsız bir makine öğrenmesi modeli yoktur.
- Trendyol yanıtında rakip satıcı puanı veya kupon ayrıntısı bulunmadığında bu alanlar gözlem tablosunda boş kalır ve karar motoru yalnız doğrulanabilen fiyat/sıra verisini kullanır.
- Railway preview veritabanı production'dan ayrıdır; gerçek öğrenen pilot geçmişi preview'a kopyalanmamıştır. Migrationlar production'daki `price_war_log`, `buybox_snapshots` ve `repricer_learning` kayıtlarını koruyup backfill eder.
- Hepsiburada panel yüzeyleri ve veri modeli hazırdır; ancak ürün/listing, komisyon, buybox ve fiyat yazma için Merchant ID ile tam API kimlikleri ve gerçek hesap sözleşmesi doğrulanana kadar ilgili senkron ve repricer endpointleri sert kilitlidir. Kilit hiçbir isteği Trendyol servisine yönlendirmez.
- BİM canlı fiyatı Yemeksepeti'ndeki `fu9o` mağaza kataloğunu temsil eder. Fiyat veya ürün kapsamı lokasyona göre değişirse mağaza kodu ve kategori listesi kod seviyesinde güncellenmelidir.
- Bizim Toptan web fiyatları seçili mağaza/lokasyon kampanyalarından farklılaşabilir; maliyete uygulamadan önce havuzun kaynak zamanı ve fiyatı kontrol edilmelidir.
- Production migration/deploy, PR incelemesi ve ayrı DB snapshot sonrasında yapılmalıdır; preview kabulü production'a otomatik geçiş yapmaz.

## Dokümantasyon

- [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md)
- [ARCHITECTURE.md](ARCHITECTURE.md)
- [DATABASE.md](DATABASE.md)
- [REPRICER_RULES.md](REPRICER_RULES.md)
- [DEPLOYMENT.md](DEPLOYMENT.md)
- [RUNBOOK.md](RUNBOOK.md)
- [MAPPING_AUTOMATION.md](MAPPING_AUTOMATION.md)
- [PRODUCT_OPPORTUNITY_ENGINE.md](PRODUCT_OPPORTUNITY_ENGINE.md)
