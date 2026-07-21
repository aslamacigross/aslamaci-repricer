# Mimari

## Genel Yapı

```mermaid
flowchart LR
  UI[React Web Panel] --> API[Express REST API]
  API --> AUTH[Auth ve Safety Middleware]
  API --> SERVICES[Domain Services]
  SERVICES --> REPOS[Repositories]
  REPOS --> DB[(PostgreSQL)]
  SERVICES --> TY[Trendyol Seller API]
  SERVICES --> HB[Hepsiburada API Adapter]
  SERVICES --> SUPPLIERS[File / Bizim / BİM fiyat kaynakları]
  JOBS[Job Scheduler + Advisory Lock] --> SERVICES
```

Frontend build'i Express tarafından sunulur; Railway'de tek servis yeterlidir.

## Katmanlar

- `src/domain`: minimum fiyat, net kâr ve repricer kararlarının saf fonksiyonları
- `src/repositories`: parametreli SQL ve veri erişimi
- `src/services`: entegrasyon, transaction, job ve iş akışları
- `src/routes`: HTTP sözleşmesi; SQL ve fiyat iş mantığı içermez
- `src/middleware`: auth, CSRF, CORS, rate limit, security headers ve hata yönetimi
- `src/db`: versioned, transactional migrationlar
- `client`: React/Vite web panel

## Veri Sahipliği

PostgreSQL ürün, ayar, maliyet, buybox, aksiyon, öğrenme ve audit verilerinin tek gerçek kaynağıdır. Trendyol ürün, fiyat, stok ve komisyon verileri Trendyol Seller API üzerinden alınır. Panel ayarları `product_settings` ve `system_settings` tablolarına yazılır.

## Pazaryeri İzolasyonu

Tek React kabuğundaki üst seçici aktif pazaryerini bütün sayfalara taşır. Repository sorguları ürün, mapping, komisyon, kargo, ambalaj, dashboard, finans, buybox ve repricer tablolarında `marketplace` filtresi olmadan çalışmaz. Aynı barkod iki pazaryerinde bulunsa bile anahtarı `(marketplace, barcode)` olduğu için hesap ve aksiyonlar birbirinden bağımsızdır.

Merkezi PIM bu izolasyonun üstünde üç katman kullanır: fiziksel ürün
(`pim_physical_products`), satış reçetesi (`pim_recipes` ve bileşenleri) ve
pazaryeri listing'i (`marketplace_listings`). Fiziksel maliyet ve reçete kanallar
arasında paylaşılabilir; katalog/listing kimlikleri, içerik ve fiyat alanları
marketplace bazında ayrıdır. Ayrıntılar `PIM_AND_LISTING_MODEL.md` içindedir.

Yayınlama katmanı `PublicationService` ve `PublicationRepository` üzerinden
çalışır. Hedef kanal bağlamı merkezi reçeteyi o kanalın komisyon, kargo, hizmet,
ambalaj, kategori, özellik, katalog eşleşmesi ve listing barkoduyla birleştirir.
`product_publication_drafts` gerçek mutasyon payload'ından önceki denetlenebilir
snapshot'tır; `channel_transfer_batches/items` yüzlerce reçetenin aynı istekle
ama ürün bazında ayrı sonuçla değerlendirilmesini sağlar.

Fırsat katmanı `OpportunityService` üzerinden PIM, tedarikçi maliyeti, mevcut
listing, buybox ve sipariş sinyallerini birleştirir. Puan saf domain fonksiyonunda
hesaplanır; her katkı kaynağı ve eksik veri kullanıcıya döner. Öneri üretimi,
reçete onayı, katalog araması ve yayın ayrı workflow adımlarıdır.

İçerik katmanı `ContentService`, `ContentRepository` ve sağlayıcıdan bağımsız
`ContentProvider` sözleşmesini kullanır. Sağlayıcıya yalnız PIM kaynak gerçekleri
verilir; provenance taslakla birlikte saklanır. `CURRENT`, `PROPOSED` ve
`APPROVED` snapshot'ları diff ve rollback önizlemesini besler. İçerik onayı ile
yayın dry-run'ı ayrı açık onaylardır; bu sürümde adapter mutasyonu çağrılmaz.
Listing sağlık puanı saf domain kontrollerinden oluşur ve her sorun için kanıt,
öneri, beklenen etki ile ölçülecek KPI döndürür.

```mermaid
flowchart LR
  R["Onaylı reçete"] --> M["Hedef katalog eşleşmesi"]
  M -->|"eş ürün"| O["Mevcut katalog teklifi taslağı"]
  M -->|"eş yok"| B["Listing barkodu kontrolü"]
  B --> N["Yeni ürün taslağı"]
  O --> V["Maliyet + kategori + özellik doğrulaması"]
  N --> V
  V --> D["Adapter payload dry-run"]
  D --> X["mutationPerformed=false"]
```

`system_settings` içinde `default_carrier_trendyol`, `service_fee_trendyol`, `default_carrier_hepsiburada` ve `service_fee_hepsiburada` ayrı tutulur. Hepsiburada varsayılanı `hepsiJET` ve KDV dahil `10,50 TL` hizmet bedelidir. Kargo baremleri ile ambalaj kuralları da `marketplace` kolonuyla ayrılır.

Para hesapları JavaScript kayan nokta aritmetiğiyle biriktirilmez; tutarlar kuruşa, oranlar ölçekli tam sayıya çevrilip yuvarlanarak hesaplanır. PostgreSQL tarafında parasal alanlar `NUMERIC` olarak saklanır.

## Fiyat Akışı

```mermaid
sequenceDiagram
  participant Job
  participant Engine as Repricer Engine
  participant DB
  participant Admin
  participant TY as Trendyol
  Job->>Engine: Preview üret
  Engine->>DB: Hedef sıra + karar + safety sonucu kaydet
  Admin->>DB: Aksiyonu onayla
  DB->>Engine: Uygulama anında yeniden doğrula
  alt Dry-run açık
    Engine->>DB: DRY_RUN sonucu
  else Tüm kontroller güvenli
    Engine->>TY: Barkodun güncel pazar fiyatını oku
    TY-->>Engine: Gerçek satış fiyatı
    Engine->>Engine: Beklenen eski fiyatla eşleştir
    Engine->>TY: İdempotent fiyat isteği
    TY-->>Engine: Batch ID
    Engine->>DB: AWAITING_RESULT; ürün fiyatını değiştirme
  end
  Job->>TY: Batch item sonucu + güncel ürün fiyatı
  Job->>DB: Doğrulanan fiyatı atomik kesinleştir
  Job->>TY: İlgili barkodlarda taze buybox sorgusu
  Job->>DB: 5/15/60 dk sonucu ölç
```

API kabulü yalnızca batch takip numarasını ve `AWAITING_RESULT` durumunu kaydeder. Ürün fiyatı, kâr alanları, fiyat geçmişi ve rollback ilişkisi; batch item `SUCCESS` olduktan ve Product V2 okuması önerilen fiyatı gerçekten gösterdikten sonra tek transaction içinde kesinleşir. 5/15/60 dakika jobları ayrıca ilgili barkodların buybox verisini yeniden çekmeden outcome yazmaz.

## Sıra Bazlı Optimizasyon

Repricer önce ekonomik olarak mümkün olan en iyi sırayı arar. Birinci sıra minimum fiyatın altındaysa ikinci, ikinci de mümkün değilse üçüncü sıra hedeflenir. Üst sıraya çıkılamadığında mevcut sıra korunarak bilinen bir sonraki fiyatın hemen altında mümkün olan en yüksek kâr aranır. Tüm artış ve düşüşler ayrı tek işlem ve günlük toplam değişim, maksimum artış ve minimum fiyat sınırlarıyla kademelenir.

## Güvenli Geri Alma

Başarılı bir aksiyon geri alınırken doğrudan API çağrısı yapılmaz. Eski fiyata bağlı `ROLLBACK` aksiyonu oluşturulur; bu kayıt yeniden onaylanır ve uygulama anında tüm safety kontrollerinden geçer. Batch ve pazar fiyatı doğrulandıktan sonra asıl aksiyon `REVERTED` olarak ilişkilendirilir.

## Veri Yönetimi

V2 Google Sheets import/export katmanına bağlı değildir. Maliyet kalemi, mapping, kargo ve ambalaj verileri panel API'leriyle PostgreSQL'e yazılır. Toplu işlemler doğrulama ve transaction kullanır; hatalı veri mevcut çalışan kaydı bozmaz.

## Akıllı Mapping Akışı

```mermaid
flowchart LR
  FILE["File canlı katalog"] --> FILEPOOL["File fiyat havuzu"]
  BIZIM["Bizim Toptan web kataloğu"] --> BIZIMPOOL["Bizim fiyat havuzu"]
  BIM["BİM / Yemeksepeti GraphQL kataloğu"] --> BIMPOOL["BİM fiyat havuzu"]
  HISTORY["Onaylı eski mappingler"] --> MATCH["Deterministik eşleştirme motoru"]
  FILEPOOL --> MATCH
  BIZIMPOOL --> MATCH
  BIMPOOL --> MATCH
  PRODUCTS["Aktif mapping eksiği ürünler"] --> MATCH
  MATCH --> QUEUE["Güven skorlu öneri kuyruğu"]
  QUEUE --> REVIEW["Kullanıcı inceleme ve onayı"]
  REVIEW --> FEEDBACK["Onay / ret olay günlüğü ve öğrenme profili"]
  FEEDBACK --> MATCH
  REVIEW --> PREVIEW["Toplu güncel önizleme"]
  PREVIEW --> TX["Transaction: mapping + maliyet + desi hesabı"]
  TX --> DB[(PostgreSQL)]
```

Eşleştirme motoru ürün adlarını Türkçe karakterlerden bağımsız normalize eder; marka, kategori, hacim/gramaj ve paket adedi sinyallerini ayrı ağırlıklarla değerlendirir. Adaylar tedarikçi havuzu içinde üretilir; farklı havuzlar tek reçetede birleşmez. Her onay ve ret immutable geri bildirim olayına yazılır. Yüksek güven önerisi dahi kendiliğinden uygulanmaz. Onay, önizleme ve uygulama ayrı durumlardır; hedef ürünün hâlâ aktif ve mapping eksik olması, cost code'ların geçerli olması ve kullanılacak tedarikçi fiyatının en fazla 30 günlük olması uygulama anında yeniden denetlenir.

Maliyet kalemleri fiziksel ürünün kesirli birim desisini korur. Nihai ürün desisi `SUM(adet × birim desi)` sonrasında `CEIL` ile yukarı yuvarlanır ve kargo/ambalaj seçimi bu tam sayı üzerinden yapılır.

## Operasyon ve Finans

Gece tedarikçi jobları İstanbul saatinde bir kez ve sırayla çalışır. Her tedarikçi importu önce tam veri setini doğrular, fiyat gözlemini kaydeder, bağlı cost code ve barkod mappinglerini günceller, ardından etkilenen ürünlerin maliyet/minimum fiyatını yeniden hesaplar. Aynı job PostgreSQL advisory lock nedeniyle eşzamanlı iki kez çalışamaz.

`marketplace_orders`, `marketplace_order_items` ve `marketplace_financial_transactions` sipariş anındaki maliyet snapshot'ını korur. Aylık rapor; ciro, komisyon, kargo, hizmet, ürün alış ve manuel ambalaj giderinden operasyonel nakit kârını üretir. Bu sonuç muhasebesel KDV kârı olarak kullanılmaz.

Hepsiburada katmanı şu anda Basic Auth ile sipariş okur. Ürün, mapping, komisyon, kargo, finans, buybox, aksiyon ve öğrenme ekranları platform anahtarıyla ayrı veri yüzeyine sahiptir. Kargo tarifeleri versiyonlu import edilir ve `marketplace='HEPSIBURADA'` ile Trendyol tarifelerinden ayrılır. Tam katalog/buybox/fiyat API kimlikleri gelene kadar Hepsiburada repricer yolu `MARKETPLACE_CREDENTIALS_MISSING` ile kapalıdır; bu yol Trendyol istemcisini çağıramaz.

## Operasyon Kontrolleri

`/health` servis ve DB bağlantısını, `/ready` gerekli migration sürümünü denetler. Bakım modu açıkken ayarlar dışında veri değiştiren yönetim istekleri `503` ile durur; okuma ekranları erişilebilir kalır.

## Geriye Uyumluluk

V2 panel ve `/api/*` REST sözleşmesi ana kullanım yüzeyidir. Eski Google Sheet ve URL komutları V2 runtime yüzeyinden kaldırılmıştır. Mutasyonlar auth + CSRF isteyen POST/PATCH/DELETE endpointleriyle yapılır.
