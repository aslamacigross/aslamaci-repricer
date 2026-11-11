# FAZ 2D.20 — Cross-Marketplace Verification Safety

11 Kasım 2026. Kapsam: mevcut HB branch'inde kod, izole testler ve lokal commit.

- **HB C1 CLOSED: YES**
- **TRENDYOL VERIFICATION SAFETY: FIXED**
- **HB BRANCH MERGE-READY: YES** — bu karar lokal kodun merge incelemesine hazır olmasıdır; deployment veya pilot aktivasyonu kararı değildir.

**FAZ 2D.20 — CROSS-MARKETPLACE VERIFICATION SAFETY COMPLETE — AWAITING MERGE REVIEW**

## Ortam ve referanslar

| Kontrol                 | Sonuç                                                                                                           |
| ----------------------- | --------------------------------------------------------------------------------------------------------------- |
| Worktree                | `/Users/bekiraslamaci/Developer/aslamaci-erp-return-20261021/aslamaci-erp-worktrees/faz-2d16-hb-floor-recovery` |
| Branch                  | `codex/faz-2d16-hb-floor-recovery`                                                                              |
| Geliştirme base SHA     | `9d4491feb4dbebe80fa6a3fffd1fc5c6ad49f62f`                                                                      |
| Başlangıç çalışma ağacı | Temiz                                                                                                           |
| Release / ortak ata     | `2011383896a436001af53c78d7c42e1bae22c6c4`                                                                      |
| Railway environment     | `preview-v2`, `c21381be-7ccf-44b6-a871-3be189c8c57b`                                                            |
| Aktif ERP deployment    | `ad174e1e-375a-4f12-9e7a-3bb7f5fe4d59`, SUCCESS                                                                 |
| Deployment kaynağı      | `release/production`, tam SHA `2011383896a436001af53c78d7c42e1bae22c6c4`                                        |
| Servisler               | ERP ve PostgreSQL Online; birer çalışan replika; diagnostic servis Offline                                      |
| Pending work            | Ağustos tarihli, `changes=[]` staged patch görüldü; değiştirilmedi/onaylanmadı                                  |
| Recovery branch HEAD    | `3965f8c0d3d1573adb065ab943c7cd8b026c2f15`, değiştirilmedi                                                      |

Yeni HEAD, bu raporu da içeren lokal commit'in SHA'sıdır; teslim mesajında ayrıca verilir. Release atası korunduğundan mevcut lokal release referansından FF-only teknik olarak mümkündür. Merge/push/deploy yapılmadı; ilerideki merge öncesinde hareket etmiş olabilecek release yeniden okunmalıdır.

## Bağımsız bulgular ve düzeltmeler

### 1. HB C1 ve Trendyol karşı örneği

Yeni testler önce eski kaynak üzerinde gerçek PostgreSQL 17.6 ve mock provider ile çalıştırıldı. Hem HB Processing hem TY IN_PROGRESS sonucu 61/180 dakikada `FAILED` oldu. `findOpen` ilk kaydı kaybetti; sonraki normal validity bucket yeni idempotency anahtarı ve ikinci mock POST üretti. TY bulgusu HB'den varsayılmadı, bağımsız üretildi.

`LearningService.verifyPendingActions` artık süre geçti diye `PENDING`, `MISMATCH` veya belirsiz sonucu terminalize etmiyor. Yalnız marketplace doğrulayıcısının kesin `FAILED` sonucu failure yoluna gider. GET/yerel kayıt hatası gönderimin reddedildiğine kanıt sayılmaz. Belirsiz aksiyon `AWAITING_RESULT` kalır; mevcut `findOpen` ve executor kontrolleri aynı SKU'daki aynı/farklı hedefi ve yeni anahtarı bloke eder. Yeni fiyat/idempotency algoritması eklenmedi.

Makbuz, submission, upload/batch ID, `auditPending`, `sent_at` ve önceki provider kanıtı korunur. Geç gelen sonuç aynı action ID ve beklenen batch üzerinden doğrulanır. Repository'de satır kilidi ve batch eşleşmesi, eski pending/failure gözleminin doğrulanmış aksiyonu ezmesini önler. İki verifier tek fiyat logu oluşturur.

### 2. Fiyat uygulaması ve Buybox sonucu

`pendingOutcomes` zaten `verified_at IS NOT NULL` koşulunu taşıyordu. Dolayısıyla eski 60m outcome yazımı, normal repository sorgusuyla doğrulanmamış aksiyona doğrudan erişmiyordu; aynı metodun başındaki verifier timeout'u ise bu aksiyonu yanlış kapatıyordu.

Ayrı hata: gerçekten doğrulanmış fiyat, Buybox hedefi kaçırılınca `checkOutcomes` tarafından tekrar `FAILED` yapılıyordu. Bu statü yazımı kaldırıldı. Fiyat uygulaması `SUCCESS`, strateji sonucu ise `price_change_outcomes`, `repricer_outcomes`, `repricer_results` ve learning verisinde kalır. `BUYBOX_LOST`/`TARGET_RANK_MISSED` öğrenme başarısızlığıdır; dispatch başarısızlığı değildir. Buybox kazanmak tek başına uygulamayı doğrulamaz.

Outcome kaydını eşzamanlı ikinci worker yazamamışsa öğrenme/recovery tekrar uygulanmaz. Normal 5m recovery, acquisition/retention ve maliyet korumaları korunur. Outcome kaydı ile learning yazımı arasında genel crash recovery/transactional outbox eklenmedi; bu görev bütün learning işlemleri için exactly-once iddiasında bulunmaz.

### 3. Trendyol executor ve job hata yolları

Eski TY executor'ü, provider kabul edip batch ID kaydedildikten sonra audit yazımı hata verirse `FAILED` yapıyordu. POST yanıtı kaybolduğunda da `FAILED` yazıyordu. Eski executor modülü base SHA'dan yüklenip aynı disposable fixture ile iki karşı örnek üretildi; kanıt JSON'unda ikisinde de açık blokajın kalktığı görülür. Bunlar canlı olay kanıtı değildir.

Yeni davranış:

- POST başlamadan önceki kesin preflight hataları mevcut FAILED/STALE yolunu korur.
- POST başladıktan sonra yanıt/makbuz belirsizse önceden kalıcı `SENDING` korunur; otomatik tekrar yasaktır.
- Kabul edilen batch, expected-state receipt metodu ile `AWAITING_RESULT` olur. Audit hatasında receipt + `auditPending=true` ayrı güvenli transaction ile korunur.
- Her iki receipt yazımı başarısızsa açık `SENDING` kalır; otomatik terminalizasyon veya yeniden POST yapılmaz.
- TY otomatik job hata yakalayıcısı `SENDING` kapatamaz. HB job'ında başka worker'ın `DUPLICATE_APPLY` hatasının açık gönderimi kapatma yolu da engellendi.

Bu, yeni dispatch'in belirsizliğini korur; eski SENDING kayıtlarını kurtaran bir mekanizma değildir. TY #54910, #95699, #1118735 üzerinde hiçbir işlem yapılmadı.

### 4. Doğru own listing ve eski statü okumaları

HB normal doğrulayıcısında floor/pilot dışı yol, aynı `hbSku` üzerindeki başka `merchantSku` fiyatını uygulama kanıtı sayabiliyordu. Mock karşı örneğinde yanlış listing ile `SUCCESS` üretildi. Artık normal doğrulama da ürünün tam merchantSku/hbSku eşleşmesini ister; pilot yolu mevcut configured Merchant ID/proof politikasını kullanmaya devam eder. Eksik/çelişkili listing `PENDING` kalır. Buybox kimlik flag'i açılmaz, mapping değiştirilmez.

TY'de own-product GET zaten configured seller endpoint'inden exact barcode seçer; HB tuple kontrolü TY'ye kopyalanmadı.

Normal onay/ret ve job failure yazımlarına beklenen statü için atomik compare-and-set eklendi. Eski PENDING/APPROVED okuması, arada SENDING/AWAITING_RESULT olmuş kaydı tekrar APPROVED/REJECTED/FAILED yapamaz. Pilot/bulk approval ve edit işlemlerinin mevcut transaction kilitleri korunur. Bu CAS, genel ownership/fencing protokolü değildir.

## Gerçek callsite ve provider sözleşmesi

| Akış              | Gerçek kaynak ve parametreler                                                                                                                                                 |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TY learning       | `src/container.js`: `new LearningService({ actions, sync, audit })`; default marketplace `TRENDYOL`                                                                           |
| HB learning       | `src/container.js`: marketplace `HEPSIBURADA`; verify → `hepsiburadaActionService.verifyPriceAction`; buybox → `sync.hepsiburadaBuybox`                                       |
| Otomatik TY       | `run-auto-repricer`: önce `learning.verifyPendingActions()`, sonra generation/approval/apply                                                                                  |
| Otomatik HB       | `HepsiburadaAutoRepricerService.runOnce`: önce HB verification, sonra HB generation/approval/apply                                                                            |
| Sonuç job'ları    | İki marketplace için ayrı 5/15/60m `checkOutcomes` kayıtları                                                                                                                  |
| Manuel recheck    | `src/routes/repricer.routes.js`: action.marketplace ile doğru learning seçilir; `elapsedMinutes` ve action ID geçirilir                                                       |
| Generation        | `RepricerService.generate`: preview/safety → marketplace-scoped `findOpen` → validity bucket/hash → create; HB pilot creation ürün satırında yeniden kontrol eder             |
| Approval/dispatch | `ActionService` onayları; TY `ActionService.apply`, HB ayrı executor; action kilidi → safety/open-action kontrolü → committed SENDING → mock/gerçek provider sınırı → receipt |
| Idempotency       | Aynı anahtarda repository ON CONFLICT; farklı anahtarda güvenlik bariyeri `findOpen` + executor state kontrolüdür                                                             |

TY `SyncService.verifyPriceAction`:

- Batch içindeki **aynı barcode** item'ının `FAILED` statüsü ve failureReasons → kesin `FAILED`.
- Item yok, IN_PROGRESS veya SUCCESS dışındaki bilinmeyen item statüsü → `PENDING`.
- Item SUCCESS fakat own-product GET okunamıyor → `PENDING`.
- Item SUCCESS ve own salePrice hedefle farklı → `MISMATCH`; provider işleminin başarısızlığı değildir.
- Item SUCCESS ve seller-scoped exact barcode fiyatı hedefle aynı → `VERIFIED`.
- GET hatası exception'dır; LearningService bunu UNKNOWN/pending gözlemi olarak tutar.

HB, configured merchant'ın upload ID status GET'ini kullanır. Mevcut `uploadState` terminal ret durumlarını FAILED, tamamlanmış upload'ı SUCCESS, Processing/diğer belirsiz durumları PENDING olarak sınıflar. Upload başarıdan sonra doğru listing kimliği ve hedef fiyat birlikte aranır. API sözleşmeleri birleştirilmedi; ilgili provider okuma/sınıflandırma farkları korunur.

Doğrulama ve outcome statü yazımları için `src` callsite taraması yapıldı. Ayrı bir 60m terminalizasyon job'ı bulunmadı; yukarıdaki ortak learning ve iki auto-job hata yolu kapsandı.

## Operasyonel görünürlük ve şema

Yeni terminal statü veya migration **gerekmiyor**. `AWAITING_RESULT`, belirsiz ve henüz doğrulanmamış uygulamayı zaten temsil ediyor. Yeni `UNKNOWN` DB state veya FAZ 2D.14'ün `RECONCILED_UNKNOWN` protokolü eklenmedi.

60 dakika sonrasında mevcut `verification_error` alanına `PRICE_VERIFICATION_RECONCILIATION_REQUIRED` uyarısı yazılır. Mevcut Actions ekranı bu alanı gösterir. Mevcut integration log altyapısına WARN kaydı gider; her poll aynı uyarıyı tekrar üretmez. `batch_checked_at` ve provider gözlemi kaydedilir; makbuz silinmez. Audit sink yoksa kalıcı action uyarısı kaybolmaz.

Eski belirsiz ilk 200 kaydın yenileri sürekli engellememesi için verification kuyruğu son kontrol zamanına göre döner. Yeni bir job veya canlı alarm servisi kurulmadı. Çözülemeyen SENDING/receipt debt ve uzun süren AWAITING_RESULT kayıtları kontrollü operasyonel mutabakat gerektirir; güvenli kanıt gelmeden otomatik retry/terminalizasyon yoktur.

Geçmişte eski kodla zaten FAILED yapılmış kayıtlar bu geliştirmede yeniden sınıflandırılmadı veya doğrulamaya açılmadı. Deployment öncesi geçmiş makbuzların salt okunur envanteri ve gerekiyorsa ayrıca yetkilendirilmiş mutabakat gerekir. Canlıda C1 nedeniyle gerçek çift gönderim yaşandığı doğrulanmış değildir.

## PostgreSQL ve regresyon kanıtı

FAZ 2D.18'in işaretli Unix-socket helper'ı ve yerel PostgreSQL 17.6 binary'si yeniden kullanıldı; yeni, ayrı `/private/tmp/aslamaci-faz2d20-postgres` cluster'ı oluşturuldu. Railway URL/DB kullanılmadı. Test DB'leri rastgele isimli ve disposable idi; provider fiyat POST'ları mock idi. Birbirinden farklı backend PID'leri **11143 / 11146** ve gerçek transaction kilidi çatışması **55P03** kaydedildi.

| Son kontrol                                          |              Sonuç | Kanıt                            |
| ---------------------------------------------------- | -----------------: | -------------------------------- |
| Tam backend                                          | 846/846, skipped 0 | `evidence/faz-2d20/backend.txt`  |
| Tam frontend                                         |    84/84, 12 dosya | `evidence/faz-2d20/frontend.txt` |
| HB pilot/floor/identity + repricer/executor/learning |            313/313 | `evidence/faz-2d20/focused.txt`  |
| Gerçek PostgreSQL                                    | 101/101, skipped 0 | `evidence/faz-2d20/postgres.txt` |
| ESLint                                               |               PASS | `evidence/faz-2d20/eslint.txt`   |
| Production build                                     |               PASS | `evidence/faz-2d20/build.txt`    |
| Değişen kodlarda Prettier / git diff --check         |               PASS | Lokal son kontrol                |

Paketler birbiriyle örtüşür; sayılar benzersiz test toplamı diye toplanmamalıdır. Tam backend'in varsayılan testleri PGlite/diğer izole harness'leri de içerir; gerçek çok oturumlu kanıt ayrı PostgreSQL paketidir. Node v24.22.1 kullanıldı. Canlı PostgreSQL minor sürümüyle tam ortam paritesi iddia edilmiyor.

### Statü ve ikinci POST sayısı

| Senaryo                                         | Düzeltme öncesi | Yeni statü      | Yeni action | Toplam mock POST | İkinci POST |
| ----------------------------------------------- | --------------- | --------------- | ----------: | ---------------: | ----------: |
| Normal HB Processing 61m                        | FAILED, 2 POST  | AWAITING_RESULT |           0 |                1 |           0 |
| Normal HB Processing 180m                       | FAILED, 2 POST  | AWAITING_RESULT |           0 |                1 |           0 |
| TY IN_PROGRESS 61m                              | FAILED, 2 POST  | AWAITING_RESULT |           0 |                1 |           0 |
| TY IN_PROGRESS 180m                             | FAILED, 2 POST  | AWAITING_RESULT |           0 |                1 |           0 |
| Özgün FAZ 2D.19 floor açık, 61m, hedef 569,14   | FAILED, 2 POST  | AWAITING_RESULT |           0 |                1 |           0 |
| Özgün FAZ 2D.19 iki flag OFF, 61m, hedef 569,14 | FAILED, 2 POST  | AWAITING_RESULT |           0 |                1 |           0 |

Son iki satır eski script'in mevcut fixture zinciriyle kalıcı regresyon testine taşınmış tekrarlarıdır. Aynı upload geç tamamlanınca ilk action SUCCESS olur; ikinci action'a sonuç taşınmaz ve POST sayısı artmaz. Canlı POST sayısı **0**.

### İstenen güvenlik senaryolarının kapsamı

| No    | Kanıtlanan davranış                                                                                                                            |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 1–2   | İki pazaryerinde kabul + uygulama SUCCESS; kesin provider reddi belgeli FAILED                                                                 |
| 3–4   | 61/180m Processing açık blokajı korur                                                                                                          |
| 5–6   | GET alınamaması, bilinmeyen provider sonucu ve POST yanıtı kaybı kesin failure sayılmaz                                                        |
| 7–8   | Eski/değişmeyen/mismatched own price açık kalır; HB yanlış tuple da doğrulama yapamaz                                                          |
| 9–10  | Geç tamamlanma ilk ID'yi doğrular; timeout sonrası normal generation bloke                                                                     |
| 11–14 | Aynı SKU/same target, farklı target ve yeni anahtar denemeleri ikinci POST yapamaz; findOpen ilk kaydı tutar                                   |
| 15    | Kabul sonrası audit hatasında receipt/auditPending korunur; HB mevcut çift persistence hatası regresyonu da geçer                              |
| 16–17 | Özgün C1 hem flags OFF normal HB hem floor açık fixture ile tekrarlandı                                                                        |
| 18–19 | Uygulanan fiyat + Buybox kaybı SUCCESS kalır; Buybox kazanımı + doğrulanmamış uygulama outcome'a alınmaz                                       |
| 20    | Geç sonuç yalnız kendi action/batch'ini günceller; diğer onaylı action değişmez                                                                |
| 21–22 | İki verifier tek price logu; ayrı worker/executor ve SKU barrier; gerçek PG oturum/kilit davranışı; stale approval/rejection/job yazımı engeli |
| 23–24 | Eski SENDING otomatik kapanmaz; normal kesin FAILURE ve doğrulanmış SUCCESS korunur                                                            |

## Değişen dosyalar

Üretim kodu:

- `src/services/learning.service.js`: belirsizliği koruma, uyarı, Buybox/application ayrımı, duplicate outcome yan etkilerini engelleme.
- `src/repositories/action.repository.js`: pending gözlemi, expected batch/row lock, receipt metotları, queue rotation, optional expected-status CAS.
- `src/services/action.service.js`: TY receipt/unknown güvenliği; normal approval/rejection CAS.
- `src/services/hepsiburada-action.service.js`: normal doğrulamada da doğru own listing tuple'ı.
- `src/services/hepsiburada-auto-repricer.service.js`, `src/container.js`: auto-job hata yolunda SENDING koruması ve stale failure CAS.

Test/çalıştırma:

- `tests/integration/price-verification-lifecycle.test.js`: bağımsız TY/HB lifecycle, timeout/retry, geç sonuç, concurrency ve CAS kanıtları.
- `tests/integration/hepsiburada-floor-lifecycle.test.js`: iki özgün FAZ 2D.19 C1 tekrarı.
- `tests/integration/hepsiburada-action-execution.test.js`, `tests/integration/action-dry-run.test.js`: olumlu fixture'larda yeni doğrulama/receipt sözleşmesi.
- `tests/unit/hepsiburada-auto-repricer.test.js`, `tests/unit/learning.test.js`: job/learning sözleşmeleri.
- `scripts/test-verification-postgres.js`, `package.json`: işaretli disposable PG runner'ı.
- Bu rapor ve `docs/evidence/faz-2d20/`: before/after karşı örnekleri, ham test çıktıları, checksum ve cleanup kaydı.

Maliyet/fiyat algoritması, CostEngine, destination shipping baremleri, minimum kâr, supplier sync, canonical mapping, Rossmann politikaları, allowlist veya flag varsayılanları değiştirilmedi. İki bağımsız HB flag default-off ve allowlist boş kalır. Yeni değişiklikler flag-off normal HB/TY verification davranışını da bilinçli olarak güvenli hale getirir; flag-off eski lifecycle semantiğiyle birebir eşitlik anlamına gelmez.

## FAZ 2D.14 ve kalan sınırlar

Recovery branch'e dokunulmadı/merge edilmedi. Release ortak atasına göre ortak dosyalar hâlâ **container.js** ve **action.repository.js**. Son lokal commit üzerinde salt okunur üç yönlü `git merge-tree` sınaması: container'da **1**, repository'de **1** conflict hunk. Repository'deki yeni metin çakışması, expected-status CAS koşulunun recovery terminal guard'ıyla aynı UPDATE satırını değiştirmesinden doğar. Temiz metin birleşimi semantik uyumluluk kanıtı değildir.

Özellikle daha sonra recovery entegre edilirken `updateStatus` üzerindeki yeni `$8` expected-status koşulu ile recovery'nin `RECONCILED_UNKNOWN` terminal guard'ı birlikte korunmalıdır. Yeni receipt state/batch kontrolleri, doğrulama transaction'ı, confirmed-floor CostEngine recalculation ve recovery ownership/fencing birbiriyle yeniden sınanmalıdır. `043_sending_recovery.DRAFT.sql` taşınmadı; genel recovery protokolü tamamlanmış kabul edilmiyor.

Kalan dış POST sınırı: DB transaction'ı provider POST'unu atomik olarak kapsamaz. Son kontrol ile dış POST arasında maliyet/policy değişebilir; provider idempotency/ownership fencing olmadan global exactly-once garantisi verilemez. Mevcut TY in-flight recipe değişimi characterization testi bu önceden bilinen sınırı hâlâ gösterir. Bu görev repricer algoritması veya SENDING ownership tasarımı geliştirmedi. C1'deki **timeout ile blokajın kaldırılması** bu kalan maliyet/dispatch yarışından ayrı olarak kapatıldı.

Merge incelemesi kararı bu sınırları kabul edilmiş/çözülmüş gibi sunmaz. Deployment ve pilot öncesi eski worker/binary kalmaması, in-flight/legacy kayıt envanteri, şema ledger'ı, effective config ve ayrı operasyonel rollout kontrolleri gerekir. Bu görev canlıya çıkış onayı veya canlı veri mutabakatı değildir.

## Tekrar çalıştırma ve temizlik

Standart Node ortamında backend/frontend/lint/build komutları `package.json` içindedir. Çok oturumlu paket:

```sh
ASLAMACI_DISPOSABLE_PG_ROOT=/tmp/aslamaci-your-marked-pg \
ASLAMACI_DISPOSABLE_PG_PORT=55482 pnpm test:verification:postgres
```

Ön koşul: yalnız test için başlatılmış Unix-socket PostgreSQL, `pilot_test` rolü ve kökte `.aslamaci-disposable` dosyasında tam `HB_ISOLATED_TEST_ONLY` işareti. Helper uzaktaki host/URL kabul etmez. Her test DB'si helper tarafından silinir; server'ın başlatma/durdurma sorumluluğu cluster'ı açan süreçtedir.

Bu çalışmada testler bitince kalan disposable DB sayısı **0** olarak ayrıca okundu. Yeni server durduruldu ve bu faz için oluşturulan cluster dizini tamamen kaldırıldı. Eski FAZ 2D.18 binary/cluster'ı değiştirilmedi. Sonuç ve SHA-256 manifesti: `evidence/faz-2d20/validation.json`.

Release merge, remote push, Railway deployment, canlı DB mutation/migration, canlı fiyat POST'u, worker restart/drain, canlı job çalıştırma, flag/allowlist/policy/mapping/supplier değişikliği yapılmadı.
