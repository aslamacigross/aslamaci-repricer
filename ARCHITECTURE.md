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
  SERVICES --> GS[Google Sheets API]
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

PostgreSQL ürün, ayar, maliyet, buybox, aksiyon, öğrenme ve audit verilerinin tek gerçek kaynağıdır. Google Sheets import/export adaptörüdür. Panel ayarları `product_settings` ve `system_settings` tablolarına yazılır.

## Fiyat Akışı

```mermaid
sequenceDiagram
  participant Job
  participant Engine as Repricer Engine
  participant DB
  participant Admin
  participant TY as Trendyol
  Job->>Engine: Preview üret
  Engine->>DB: Karar + safety sonucu kaydet
  Admin->>DB: Aksiyonu onayla
  DB->>Engine: Uygulama anında yeniden doğrula
  alt Dry-run açık
    Engine->>DB: DRY_RUN sonucu
  else Tüm kontroller güvenli
    Engine->>TY: İdempotent fiyat isteği
    TY-->>Engine: Batch ID
    Engine->>DB: AWAITING_RESULT
  end
  Job->>DB: 5/15/60 dk sonucu ölç
```

DB fiyatı gönderim anında kesin gerçek kabul edilmez; sonraki ürün/buybox sync ile doğrulanır.

## Google Dayanıklılığı

Tek token cache, exponential backoff, jitter, AbortController timeout ve circuit breaker kullanılır. Sheet okuma/validation bitmeden DB transactionı başlamaz. Mapping ve kural değişimleri temp tablolar üzerinden atomic replace edilir.

## Geriye Uyumluluk

Read-only özet endpointleri korunur. Eski fiyat uygulama GET endpointi kasıtlı olarak `410` döndürür. Mutasyonlar auth + CSRF isteyen POST/PATCH/DELETE endpointlerine taşınmıştır.
