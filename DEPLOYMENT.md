# Railway Deployment

## Önerilen Topoloji

Tek Railway servisi kullanılır. Build sırasında React derlenir, runtime sırasında Express hem API'yi hem statik frontend'i sunar. PostgreSQL mevcut Railway database servisidir.

## Preview Sırası

1. `feature/aslamaci-erp-v2` branch'i GitHub'a push edilir.
2. Pull request branch'inden Railway preview environment oluşturulur.
3. Production PostgreSQL'in doğrudan kopyası kullanılacaksa önce snapshot/backup alınır; tercihen ayrı preview DB kullanılır.
4. Aşağıdaki V2 environment değişkenleri preview'a eklenir.
5. `DRY_RUN=true` ve `REPRICER_ENABLED=false` doğrulanır.
6. Deploy health check `/health` yeşil olana kadar beklenir.
7. Login, dashboard, ürün detayı, Menekşe kırılımı, buybox sync, repricer preview ve dry-run aksiyonu test edilir.

## Production Öncesi Yedek

Railway PostgreSQL backup/snapshot özelliği kullanılır. CLI erişimi varsa standart PostgreSQL yedeği de alınabilir:

```bash
pg_dump --format=custom --no-owner --file=aslamaci-before-v2.dump "$DATABASE_URL"
```

Yedek dosyasının boş olmadığı ve restore edilebilir olduğu kontrol edilmeden production migration uygulanmaz.

## Railway Ayarları

`railway.toml`:

- Build: `pnpm install --frozen-lockfile && pnpm build`
- Start: `pnpm start`
- Health: `/health`
- Health timeout: 120 saniye
- Failure restart: 3 deneme

Sunucu açılırken bekleyen migrationlar transaction içinde idempotent olarak uygulanır.

## Yeni Environment Variables

Zorunlu:

- `ADMIN_USERNAME`
- `ADMIN_PASSWORD_HASH` veya `ADMIN_PASSWORD`
- `SESSION_SECRET`

Önerilen production değerleri:

```text
NODE_ENV=production
DRY_RUN=true
REPRICER_ENABLED=false
JOBS_ENABLED=true
GOOGLE_SHEETS_SYNC_ENABLED=true
ALLOWED_ORIGIN=https://<preview-veya-production-domain>
```

Parola hash'i yerelde üretilir:

```bash
pnpm hash-password "en-az-12-karakter-guvenli-parola"
```

Çıktı Railway'de `ADMIN_PASSWORD_HASH` değeridir. Düz parola repo veya loga yazılmaz.

## Deploy Sonrası Smoke Test

- `GET /health`: DB connected
- Login ve logout
- Dashboard KPI ve grafikler
- Ürün arama, filtre ve detay drawer
- `8690609598109` maliyet kırılımı: yaklaşık 312,28 TL
- Mapping validation ve test transaction
- Buybox sync job
- Repricer preview
- Onay + apply: sonuç `DRY_RUN`, Trendyol çağrısı yok
- Job geçmişi ve audit log
- Google metadata test
- Mobil sidebar ve tablolar

## Production'a Geçiş

İlk production deploy da dry-run olarak yapılır. Gerçek fiyat gönderimi bu deployment işinin parçası değildir. Canlı mod, ayrı bir kullanıcı kararı ve pilot ürün doğrulamasından sonra panelde iki global güvenlik anahtarının bilinçli değişimiyle açılır.
