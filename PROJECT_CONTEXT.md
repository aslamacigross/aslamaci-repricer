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
- Production branch’e doğrudan yazılmaz.
- Her ana aşamada bu dosya ve `IMPLEMENTATION_STATUS.md` güncellenir.
- İş sonunda tek pull request hazırlanır.

## V2 Mimari Kararları

- Railway'de Express API ve build edilmiş React panel tek serviste çalışır.
- `index.js` yalnızca `src/server.js` bootstrap dosyasını çağırır.
- Aksiyon uygulaması önce DB'de `SENDING` durumuna alınır; Trendyol çağrısı transaction dışında yapılır ve batch sonucu ayrıca kaydedilir.
- API kabulünden sonra beklenen ürün fiyatı ve `price_war_log` transaction içinde güncellenir; bu değer pazar sonucu sayılmaz ve outcome joblarıyla doğrulanır.
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

- 48 unit/integration/regression testi geçiyor.
- Menekşe minimum fiyat testi 312,28 TL.
- Vite production build ve ESLint geçiyor.
- Gerçek PostgreSQL motorunda migration, dashboard SQL'i, Menekşe hesabı ve eksik maliyet statüsü doğrulandı.
- Railway `preview-v2` ortamı `https://aslamaci-repricer-preview-v2.up.railway.app` adresinde çalışıyor.
- Preview DB'de 764 ürün, 717 buybox kaydı ve 4.230 satırlık güvenli Sheet importu doğrulandı.
- Menekşe manuel aksiyonu `PENDING -> APPROVED -> DRY_RUN` oldu; Trendyol çağrısı yapılmadı ve ürün fiyatı 322,00 TL kaldı.
- Login, dashboard, ürün detay/maliyet kırılımı, buybox, repricer, aksiyon, öğrenme, job, log ve ayar ekranları desktopta; dashboard ve ürün listesi 390x844 mobil viewportta görsel olarak doğrulandı.
- Preview güvenlik durumu: dry-run açık; global repricer, scheduler ve otomatik Sheet sync kapalı.
- Production uygulaması, veritabanı ve öğrenen pilot geçmişi değiştirilmedi.
