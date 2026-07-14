# Aşlamacı ERP V2

Trendyol ürün maliyeti, minimum fiyat, buybox ve öğrenen repricer operasyonlarını PostgreSQL merkezli tek bir web panelde yöneten Node.js/React uygulamasıdır.

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

Paneldeki toplu mapping işlemi önce maliyet/desi önizlemesi ister ve yalnızca gönderilen barkodları transaction içinde yeniler. Tüm mapping tablosunu değiştiren uyumluluk endpointi ayrıca `MAPPING_TAM_YENILE` açık onayı ister. Cost code mevcut olsa bile birim maliyeti veya desisi sıfır olan kalem `Maliyet eksik` gösterilir ve panelden yeni toplu mappinge alınmaz. Maliyet kalemleri panelden kopyala-yapıştır yöntemiyle toplu upsert edilebilir; tüm satırlar doğrulanmadan transaction başlamaz.

Job sıklıkları environment yerine PostgreSQL ve Sistem Ayarları ekranından yönetilir. Böylece panelde yapılan değişiklikler servis yeniden başladığında korunur.

Mapping ekranı tüm mapping kümesini alıp 100 satırlık sayfalara böler. Buybox ve fiyat aksiyonları büyüyen katalog için server-side aranıp sayfalanır. Ürün ve Buybox CSV aktarımı gerekirse bütün API sayfalarını birleştirir; diğer tablolar seçili kolonları ve filtrelenmiş kayıt kümesini kullanır.

## Railway

Repo kökündeki `railway.toml` build, start ve health check ayarlarını içerir. Ayrıntılı akış [DEPLOYMENT.md](DEPLOYMENT.md), acil durum adımları [RUNBOOK.md](RUNBOOK.md) içindedir.

## Bilinen Sınırlamalar

- Öğrenme motoru ilk sürümde açıklanabilir ve deterministik kurallıdır; bağımsız bir makine öğrenmesi modeli yoktur.
- Trendyol yanıtında rakip satıcı puanı veya kupon ayrıntısı bulunmadığında bu alanlar gözlem tablosunda boş kalır ve karar motoru yalnız doğrulanabilen fiyat/sıra verisini kullanır.
- Railway preview veritabanı production'dan ayrıdır; gerçek öğrenen pilot geçmişi preview'a kopyalanmamıştır. Migrationlar production'daki `price_war_log`, `buybox_snapshots` ve `repricer_learning` kayıtlarını koruyup backfill eder.
- Hepsiburada adaptörü V2 veri modeline eklenebilir durumdadır ancak bu sürümde yalnız Trendyol entegrasyonu çalışır.
- Production migration/deploy, PR incelemesi ve ayrı DB snapshot sonrasında yapılmalıdır; preview kabulü production'a otomatik geçiş yapmaz.

## Dokümantasyon

- [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md)
- [ARCHITECTURE.md](ARCHITECTURE.md)
- [DATABASE.md](DATABASE.md)
- [REPRICER_RULES.md](REPRICER_RULES.md)
- [DEPLOYMENT.md](DEPLOYMENT.md)
- [RUNBOOK.md](RUNBOOK.md)
