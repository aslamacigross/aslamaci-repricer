# Katalog Eşleştirme ve Listing Barkodları

## Önce Katalog Araması

Bir reçete hedef kanala taşınırken sıra şöyledir:

1. Mevcut recipe-to-listing ilişkisi kontrol edilir.
2. Kullanıcının daha önce onayladığı katalog eşleşmesi kontrol edilir.
3. Adapter destekliyorsa hedef katalog aranır.
4. Marka, ürün ailesi, varyant, birim hacim/gramaj, paket adedi, kategori ve
   bundle bileşenleri karşılaştırılır.
5. Güven skoru ve bütün kanıtlar kullanıcıya gösterilir.
6. Eş ürün yoksa ancak o zaman yeni ürün ve listing barkodu akışına geçilir.

Eksik kritik alanlar yüksek güven veremez. Paket yapısı veya varyant uyuşmazlığı
eşleşmeyi reddeder. Bu nedenle `1,5 L x 2`, `3 L x 1` ile; Menekşe paketi de
Çiçek Rüyası veya karma paketle aynı kabul edilmez.

Motor güvenli hibrit çalışır: hacim, gramaj, paket adedi, varyant ve bundle
bileşenleri hard constraint'tir. `1,5 L` ile `1500 ml`, `1,5 kg` ile
`1500 g` ortak birime normalize edilir. Ürün adı ve ürün ailesi alias/token
benzerliği yalnız yardımcı sinyaldir. Fuzzy sinyal kullanan aday yüksek puan alsa
dahi otomatik `CONFIRMED` olmaz; `REVIEW_REQUIRED` ile insan incelemesine gider.

## Kimlik Ayrımı

- ERP fiziksel ürün kimliği: alınan gerçek ürün.
- ERP reçete kimliği: satılan paket/bundle.
- Katalog ürün kimliği ve katalog barkodu: hedef pazaryerinin ortak kataloğu.
- Seller listing barkodu ve SKU: satıcının o kanaldaki teklifi.
- Dış listing kimliği: adapterın döndürdüğü yayın kimliği.

Kaynak pazaryeri barkodu hedef kanala kör biçimde kopyalanmaz.

## Listing Barkodu

`listing_barcode_pools`, yalnız yeni ürün gereken reçeteler için barkod
rezervasyonu yapar. Otomatik aday `ASL-{KANAL}-{HASH}` biçimindedir; bu bir
üretici GTIN'i değildir. Aynı marketplace/reçete için tahsis idempotenttir,
repository genelinde barkod benzersizdir ve manuel değer kullanılacaksa format
doğrulaması yapılır.

Önizleme barkodu tüketmez. Rezervasyon için kullanıcıdan
`LISTING_BARKODU_TAHSIS_ET` onayı alınır. Başarısız yayın barkodu başka reçeteye
aktarmaz; yayın ve doğrulama akışı ayrı durumlarla izlenir.

## Dry-run Yayın ve Kanal Aktarımı

`Ürün Yayınlama` bir reçeteyi önce açık insan onayından geçirir. Taslak hedef
kategori, marka, zorunlu özellikler, içerik, görseller, stok ve pazaryeri bazlı
fiyat kırılımını saklar. `publish-dry-run` yalnız adapter payload doğrulamasını
çalıştırır ve sonuçta daima `mutationPerformed=false` üretir.

`Kanal Aktarımı` aynı değerlendirmeyi seçilen reçeteler için idempotent batch
olarak çalıştırır. Her satır `EXISTING_MATCH_CONFIRMED`,
`EXISTING_MATCH_REVIEW_REQUIRED`, `NEW_PRODUCT_REQUIRED`, `READY_TO_LIST` veya
açık maliyet/kimlik/capability blocker durumlarından birine ayrılır. Batch işlemi
ürün, içerik, fiyat ya da stok göndermez.

Idempotency anahtarı draft üretiminden önce hesaplanır. Mevcut batch bulunduğunda
taslak değerlendirmesi ve DB yazımı yapılmadan aynı batch döner. Yeni batch,
publication draft ve batch item kayıtları tek transaction içinde oluşur; ikinci
aynı isteğin orphan veya duplicate draft bırakmaması backend E2E ile doğrulanır.
