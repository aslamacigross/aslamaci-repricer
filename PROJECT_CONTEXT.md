# Aşlamacı ERP V2 Proje Bağlamı

## İş Bağlamı

Aşlamacı Gross, stok tutmadan sipariş üzerine tedarik yapan bir süpermarket pazaryeri mağazasıdır. Trendyol kataloğu yaklaşık 755 barkoddur ve ayda yaklaşık 100 barkod büyümektedir. Aynı fiziksel ürün farklı paket adetleriyle birden fazla barkodda satıldığı için maliyet kalemleri `MaliyetIndex`, barkod bileşimleri `UrunMaliyetMap` mantığıyla yönetilir.

## Canlı Sistem

- Repo: `aslamacigross/aslamaci-repricer`
- Railway: `https://aslamaci-repricer-production.up.railway.app`
- Google Sheet: `Aşlamacı ERP`
- Spreadsheet ID: `1VBPFRY43BPU7tvx6e8rZo5WMJBlBhVsKKEr6NDfx-DE`
- Production sürümü (V2 öncesi): `2026-07-10-learning-buybox-pilot`
- Production DB gözlemi: 755 toplam ürün, 709 aktif ürün, 451 mapping eksik, 399 komisyon eksik, 7 auto-update açık.

## Korunacak Davranışlar

- Trendyol ürün ve buybox senkronizasyonu
- Sheets import/export ve mevcut sekme sözleşmeleri
- KDV dahil maliyet hesabı
- Geçmiş `price_war_log`, `buybox_snapshots` ve `repricer_learning` verileri
- Öğrenen pilotun ürün bazlı fiyat kırma değeri
- Mevcut minimum fiyat ve net kâr davranışı

## Maliyet Kararı

`KargoMaliyetleri` ve `KargoBarem` sekmeleri KDV hariçtir ve yüzde 20 KDV eklenerek gerçek ödenen maliyete çevrilir. Diğer alış ve satış fiyatları KDV dahildir.

Minimum fiyat:

`(ürün maliyeti + kargo + ambalaj + hizmet bedeli + hedef kâr) / (1 - komisyon oranı)`

Menekşe fixture (`8690609598109`): 112 + 79 + 15 + 13,19 + 40, yüzde 17 komisyon ile 312,28 TL.

## Güvenlik Kararları

- Production varsayılanı `DRY_RUN=true`.
- Global repricer varsayılanı kapalıdır.
- Ürün auto-update varsayılanı kapalıdır.
- Gerçek Trendyol fiyat gönderimi kullanıcının açık onayı olmadan çalıştırılmaz.
- V2 migrationları mevcut production tablolarını veya geçmiş aksiyonları silmez.
- PostgreSQL ana kaynak, Google Sheets geçiş/import/export katmanıdır.

## Branch ve Çalışma Şekli

- Branch: `feature/aslamaci-erp-v2`
- Draft PR: [#1 Aşlamacı ERP V2 production web panel](https://github.com/aslamacigross/aslamaci-repricer/pull/1)
- Production branch’e doğrudan yazılmaz.
- Her ana aşamada bu dosya ve `IMPLEMENTATION_STATUS.md` güncellenir.
- Tek pull request draft olarak hazırlanmıştır; merge ve production deploy ayrı onay gerektirir.

## V2 Mimari Kararları

- Railway'de Express API ve build edilmiş React panel tek serviste çalışır.
- `index.js` yalnızca `src/server.js` bootstrap dosyasını çağırır.
- Aksiyon uygulaması önce DB'de `SENDING` durumuna alınır; gerçek gönderim öncesi barkod Product V2 ile yeniden okunur ve pazar fiyatı aksiyondaki eski fiyatla eşleştirilir.
- API kabulünden sonra yalnızca batch ID ve `AWAITING_RESULT` kaydedilir; DB ürün fiyatı değiştirilmez.
- Batch item `SUCCESS` ve Product V2 satış fiyatı önerilen değer olarak doğrulanınca ürün fiyatı, kâr alanları ve `price_war_log` tek transaction içinde kesinleşir.
- Tek işlem değişim yüzdesi ile gün başına toplam değişim yüzdesi ayrı ürün ayarlarıdır.
- Repricer mümkün olan en iyi 1/2/3. sırayı, mümkün değilse mevcut sıradaki en yüksek güvenli kârı hedefler.
- Öğrenme anlık refresh içinde çalışmaz; 5/15/60 dakika outcome jobları kullanılır.
- Outcome jobu ilgili barkodların buybox verisini yenileyemezse eski veriyle sonuç yazmaz.
- Beş ardışık başarısızlıkta ürün öğrenmesi duraklatılır.
- Başarılı fiyat aksiyonları doğrudan değiştirilmeyip bağlı ve yeniden onaylanan rollback aksiyonuyla geri alınır.
- Manuel aksiyon otomasyon kapılarından bağımsızdır; dry-run ve mali güvenlik kurallarını geçemez.
- Sheet importu başarısızsa DB transactionı başlamaz.
- Sheet importu aynı değerli tekrarları tekilleştirir, boş mapping adedini `1` kabul eder ve eksik maliyet kalemini `0` ile eksik durumda tutar; çelişkili tekrarlar transaction başlamadan reddedilir.
- Mapping replace, kargo/ambalaj/komisyon güncellemesi ve ürün maliyet hesabı aynı DB transactionı içinde tamamlanır.
- Orphan mappingler kaybolmaz; uyarı olarak import edilip ilgili ürünü otomatik olarak eksik durumda tutar.

## Doğrulama Durumu

- 78 backend unit/integration/regression, 5 React bileşen ve 3 Chrome uçtan uca testi geçiyor.
- Menekşe minimum fiyat testi 312,28 TL.
- Vite production build ve ESLint geçiyor.
- Gerçek PostgreSQL motorunda migration, dashboard SQL'i, Menekşe hesabı ve eksik maliyet statüsü doğrulandı.
- `004_market_price_verification` migrationı ve batch sonrası atomik fiyat kesinleştirme gerçek PostgreSQL motorunda up/down doğrulandı.
- Railway `preview-v2` ortamı `https://aslamaci-repricer-preview-v2.up.railway.app` adresinde çalışıyor.
- Preview DB'de Product V2 ile 768 ürün varyantı, 717 buybox kaydı ve 4.230 satırlık güvenli Sheet importu doğrulandı.
- Product V2 sync jobu 6,3 saniyede 768 başarılı, 0 hatalı kayıtla tamamlandı.
- Preview panel ayarlarında dry-run açık; global repricer ve Google Sheets otomatik sync kapalı olarak yeniden doğrulandı.
- Menekşe manuel aksiyonu `PENDING -> APPROVED -> DRY_RUN` oldu; Trendyol çağrısı yapılmadı ve ürün fiyatı 322,00 TL kaldı.
- Login, dashboard, ürün detay/maliyet kırılımı, buybox, repricer, aksiyon, öğrenme, job, log ve ayar ekranları desktopta; dashboard ve ürün listesi 390x844 mobil viewportta görsel olarak doğrulandı.
- Preview güvenlik durumu: dry-run açık; global repricer, scheduler ve otomatik Sheet sync kapalı.
- Son kabulde `/version` branch HEAD ile eşleşmiş; `/health` ve migration-aware `/ready` başarılıdır.
- Panel kabuğu `Cache-Control: no-store`, içerik hash'li statik dosyalar `immutable` olarak sunulur; yeni deploy sonrası eski panel sürümünün tarayıcıda kalması engellenmiştir.
- Production uygulaması, veritabanı ve öğrenen pilot geçmişi değiştirilmedi.
- Para motoru kuruş/oran ölçekli tam sayı aritmetiği kullanıyor; mapping önizlemesi de aynı hassasiyeti koruyor.
- `005_operational_controls` migrationı bakım modu ekliyor; `/ready` gerekli migration sürümünü denetliyor.
- Panelde kolon görünürlüğü, mapping önizleme/çoğaltma, maliyet kullanım/geçmişi, eksik komisyon ve kargo tarifesi uyarıları, kargo hesaplayıcı, buybox geçmiş grafiği ve fiyat düzenleyip onaylama akışları tamamlandı.
- Cost code mevcut olsa bile birim maliyet veya desisi sıfır olan mapping panelde `Maliyet eksik` gösterilir ve yeni toplu mappinge alınmaz.
- Gerçek preview verisinde 201 satırlık buybox tablosu ve geçmiş grafiği, fiyat aksiyonu listesi ve sistem ayarları son kez görsel olarak doğrulandı.
- PR öncesi kapsam denetiminde toplu maliyet kalemi yönetimi, tüm tablolarda CSV, veri hacmine uygun Mapping/Buybox/aksiyon sayfalaması, öğrenme detayı ve silme onayları tamamlandı.
- Ürün CSV aktarımı API'nin talep edilen sayfa limitini küçültmesi durumunda dönen gerçek limiti izleyerek tüm sayfaları toplar; regresyon testi ve 768 kayıtlı Railway preview kataloğu üzerinde doğrulandı.
- Yeni kurulumlarda otomatik Google Sheets sync hem environment hem panel kapısı açılana kadar kapalıdır.
- GitHub PR #1 açık, draft, merge edilmemiş ve `main <- feature/aslamaci-erp-v2` yönünde birleştirilebilir durumdadır.
