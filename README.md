# Aşlamacı ERP V2

Trendyol ürün maliyeti, minimum fiyat, buybox ve öğrenen repricer operasyonlarını PostgreSQL merkezli tek bir web panelde yöneten Node.js/React uygulamasıdır.

## Özellikler

- Güvenli admin girişi, HttpOnly session ve CSRF koruması
- Ürün, maliyet kalemi, mapping, komisyon, kargo ve ambalaj yönetimi
- Açıklamalı minimum fiyat ve net kâr kırılımı
- Buybox takibi ve ürün bazlı repricer ayarları
- Sıra bazlı kâr optimizasyonu, onaylı fiyat aksiyonları ve çok katmanlı safety gate
- 5/15/60 dakika taze buybox sonuç ölçümü ve açıklanabilir öğrenme
- Yeniden onay gerektiren izlenebilir fiyat geri alma akışı
- PostgreSQL advisory lock kullanan job sistemi
- Atomic Google Sheets importu ve geriye uyumlu export
- Audit, entegrasyon ve job logları
- Mobil uyumlu Türkçe React paneli

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

| Komut | Açıklama |
|---|---|
| `pnpm dev` | Backend ve frontend geliştirme modu |
| `pnpm build` | Production React build |
| `pnpm start` | Migration + tek servis production başlangıcı |
| `pnpm migrate` | Bekleyen migrationları uygular |
| `pnpm migrate:down` | Son migration setlerini geri alır; önce yedek zorunludur |
| `pnpm test` | Unit, integration ve regression testleri |
| `pnpm lint` | Backend ve frontend statik kontrolü |
| `pnpm hash-password "..."` | Production parola hash'i üretir |

## Environment Variables

Mevcut zorunlu entegrasyon değişkenleri:

- `DATABASE_URL`
- `TY_API_KEY`
- `TY_API_SECRET`
- `TY_SUPPLIER_ID`
- `GOOGLE_SHEET_ID`
- `GOOGLE_SERVICE_ACCOUNT_JSON`
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
- `GOOGLE_SHEETS_SYNC_ENABLED`: varsayılan `true`
- `DEFAULT_CARRIER`: varsayılan `TEX`
- `DEFAULT_SERVICE_FEE`: varsayılan `13.19`
- `DEFAULT_TARGET_PROFIT`: varsayılan `40`
- `DEFAULT_MAX_INCREASE_TL`: varsayılan `10`
- `BUYBOX_MAX_AGE_MINUTES`: varsayılan `20`
- `GLOBAL_MAX_PRICE_CHANGE_PCT`: varsayılan `15`
- `MIN_PRICE_CHANGE_TL`: varsayılan `0.10`
- `PRODUCT_SYNC_CRON_MINUTES`: varsayılan `360`
- `BUYBOX_SYNC_CRON_MINUTES`: varsayılan `10`
- `REPRICER_CRON_MINUTES`: varsayılan `10`
- `SHEETS_SYNC_CRON_MINUTES`: varsayılan `1440`
- `LOG_RETENTION_DAYS`: varsayılan `90`

Tam liste [.env.example](.env.example) dosyasındadır.

## Güvenli İlk Çalıştırma

1. `DRY_RUN=true` ve `REPRICER_ENABLED=false` bırakılır.
2. Migration uygulanır ve `/health` kontrol edilir.
3. Panelden ürün, Menekşe maliyet kırılımı ve buybox sync doğrulanır.
4. Repricer yalnızca pilot ürünlerde önizlenir.
5. Gerçek fiyat modu ayrı kullanıcı onayıyla daha sonra açılır.

Panelde dry-run kapatılırken veya global repricer açılırken ikinci bir canlı-mod onayı gerekir. Manuel aksiyonlar otomasyon kapalıyken kullanılabilir; yine de dry-run, minimum fiyat, maliyet, kâr, buybox güncelliği, günlük limit ve cooldown kontrollerini geçmek zorundadır.

## Google Sheets

PostgreSQL ana veri kaynağıdır. Sheets yalnızca geçiş, toplu düzenleme ve export katmanıdır. Import tüm sekmeleri önce okur ve doğrular; geçerli veri tamamlanmadan transaction veya silme başlamaz. Aynı değerli tekrarlar uyarıyla tekilleştirilir, boş mapping adedi `1` kabul edilir, eksik maliyet tutarı `0` olarak içe alınıp ilgili ürün eksik işaretlenir. Çelişkili tekrarlar transaction başlamadan reddedilir. Mapping replace ve maliyet hesaplama aynı transaction içinde tamamlanır. `KargoMaliyetleri` ve `KargoBarem` tutarlarına yüzde 20 KDV eklenir.

## Railway

Repo kökündeki `railway.toml` build, start ve health check ayarlarını içerir. Ayrıntılı akış [DEPLOYMENT.md](DEPLOYMENT.md), acil durum adımları [RUNBOOK.md](RUNBOOK.md) içindedir.

## Dokümantasyon

- [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md)
- [ARCHITECTURE.md](ARCHITECTURE.md)
- [DATABASE.md](DATABASE.md)
- [REPRICER_RULES.md](REPRICER_RULES.md)
- [DEPLOYMENT.md](DEPLOYMENT.md)
- [RUNBOOK.md](RUNBOOK.md)
