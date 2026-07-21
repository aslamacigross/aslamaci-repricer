# AI İçerik Güvenliği

## Amaç

İçerik Stüdyosu, pazaryeri listing içeriklerini hazırlayan ve insan incelemesine
sunan bir taslak aracıdır. Bu sürümde canlı listing içeriğini değiştirmez.

## Kaynak Gerçekliği

Taslak girdileri merkezi PIM ve onaylı reçeteden alınır:

- marka ve ürün ailesi
- varyant, koku veya aroma
- hacim ve gramaj
- reçete bileşenleri ve adetleri
- kategori ve mevcut listing içeriği
- kaynak kayıt kimlikleri ve oluşturma zamanı

Her taslak `source_facts` ve provenance ile saklanır. Kaynağı olmayan sertifika,
sağlık iddiası, performans vaadi veya ürün özelliği üretilemez.

## Paket Adedi Kilidi

Başlık ve açıklamadaki paket adedi reçetedeki toplam bileşen adediyle uyumlu
olmalıdır. Örneğin Menekşe 1,5 L x 4 reçetesi dört ürün olarak gösterilir.
Menekşe ve Çiçek Rüyası karma reçetesi tek varyant gibi anlatılamaz. Uyuşmazlık
`PACKAGE_COUNT_MISMATCH` ile onayı engeller.

## Sağlayıcı Sözleşmesi

İçerik üretimi `ContentProvider` adapterı üzerinden yapılır. Harici AI anahtarı
olmayan ortamda deterministic `MOCK_DRAFT` sağlayıcısı kullanılır ve ağ isteği
yapılmaz. Gelecekteki sağlayıcılar da aynı kaynak gerçekliği ve doğrulama
kapılarından geçmek zorundadır; sağlayıcı çıktısı güvenilir veri sayılmaz.

## Workflow ve Onaylar

1. `AI_DRAFT`: kaynak gerçeklerinden taslak hazırlanır.
2. `HUMAN_REVIEW`: kullanıcı başlık, açıklama ve brief'leri inceler.
3. `APPROVED`: güvenlik doğrulaması ve açık kullanıcı onayı tamamlanır.
4. `MARKETPLACE_SUBMITTED`: gelecekte ayrıca yayın onayıyla kullanılabilir.
5. `VERIFIED`: pazaryerindeki gerçek içerik yeniden okunmadan verilmez.

Taslak üretme, düzenleme, onaylama ve yayın dry-run'ı ayrı audit olaylarıdır.
`CONTENT_AUTO_UPDATE_ENABLED=false` varsayılan ve zorunlu güvenlik durumudur.

## Diff, Snapshot ve Rollback

Panel mevcut ve önerilen değerleri yan yana gösterir. `CURRENT`, `PROPOSED` ve
`APPROVED` snapshot'ları checksum ile saklanır. Rollback doğrudan içerik yazmaz;
önce eski snapshot için yeni bir diff ve açık kullanıcı onayı gerekir.

## Listing Sağlığı

Sağlık puanı başlık, marka, paket adedi, açıklama, zorunlu özellikler, görseller,
video, stok ve fiyat sinyallerini değerlendirir. Her sorun şu alanlarla açıklanır:

- gözlenen kanıt
- önerilen değişiklik
- beklenen etki
- güven düzeyi
- değişiklikten sonra ölçülecek KPI

Bu puan veya öneriler pazaryeri algoritmasında yükselme garantisi değildir.
Eksik dönüşüm, iade veya müşteri sorusu verisi açıkça eksik veri olarak gösterilir.

## Canlı Mutasyon Sınırı

Bu sürümde içerik yayınlama sonucu her zaman `mutationPerformed=false` olur.
Gerçek ürün, başlık, açıklama, özellik, görsel, video, fiyat veya stok mutasyonu
yapılmaz. Batch kabulü ve gerçek listing doğrulaması uygulanmadan hiçbir kayıt
`PUBLISHED` veya `VERIFIED` sayılmaz.
