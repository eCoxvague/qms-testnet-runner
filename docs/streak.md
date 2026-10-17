# QWAP Testnet Streak — 19 Ekim 2026

Kullanıcının paylaştığı Discord duyurusuna göre hazırlanmıştır. Resmî puan sistemiyle bağlantısı yoktur.
Kayıtlı test cüzdanı kullanılır; yeni cüzdan oluşturulmaz veya Discord'a yeniden adres gönderilmez.

## Tarihler

- Başlangıç: **19 Ekim 2026 Pazartesi 13:00 UTC / Türkiye 16:00**.
- Her görev günü 13:00 UTC'de başlar; yerel bilgisayarın saat dilimi gün hesabını değiştirmez.
- Yedi günlük pencerenin sonu: **26 Ekim 2026 13:00 UTC / Türkiye 16:00**.
- Başlangıçtan önce ve bu pencerenin sonunda işlem gönderilmez.
- İşlemin hangi güne ait olduğu, doğrulanmış bloğun zamanına göre belirlenir; bilgisayarda komutun başladığı saat kullanılmaz.

| Gün | Türkiye saatiyle aralık |
| --- | --- |
| 1 | 19 Ekim 16:00 – 20 Ekim 16:00 |
| 2 | 20 Ekim 16:00 – 21 Ekim 16:00 |
| 3 | 21 Ekim 16:00 – 22 Ekim 16:00 |
| 4 | 22 Ekim 16:00 – 23 Ekim 16:00 |
| 5 | 23 Ekim 16:00 – 24 Ekim 16:00 |
| 6 | 24 Ekim 16:00 – 25 Ekim 16:00 |
| 7 | 25 Ekim 16:00 – 26 Ekim 16:00 |

Bu pencere duyurudaki başlangıç + 7 gün esas alınarak hesaplanır. Duyuru değişirse `config/streak.json` güncellenmelidir.

## Hazırlık

```sh
npm run streak:prepare
npm run streak:status
```

Hazırlık mevcut şifreli test cüzdanını, ağı, QWAP kontratlarını ve bakiyeyi kontrol eder.
Swap, LP veya deploy göndermez. Zamanlanmış görev kendiliğinden kurulmaz.
Bu komut ilk cüzdan kurulumunu da destekler; anahtar girişi gizlidir.

Varsayılan tutarlar günlük **0.2 QMS swap** ve **0.1 QMS ile WQMS/USDC LP**.
Günlük konservatif bütçe **0.55 QMS**, yedi gün + tek seferlik gas rezervi için **3.25 QMS**.
Bu üst bütçe tahminidir; gerçek gas ücretleri daha düşük olabilir. Faucet tarayıcı kontrolleri elle tamamlanır.

## Günlük tek komut

```sh
npm run streak
```

Bu mod, genel `npm run all` akışından ayrıdır: sadece streak için swap + LP yapar.
Gerekirse LP öncesi sınırlı USDC approval gönderir; kontrat deploy etmez.

- Başlamadan çalıştırılırsa tarihleri gösterir ve işlem göndermez.
- Aynı görev günü tekrar çalıştırılırsa tamamlanan swap ve LP'yi atlar.
- Swap başarılı, LP başarısızsa sonraki denemede LP'den devam eder.
- Receipt ve gerçek swap/Mint/LP-transfer event'leri kontrol edilir; approval tek başına LP sayılmaz.
- Kaybolan RPC yanıtında kayıtlı hash'lerden kanıt toplanır; belirsiz işlem varken yeniden gönderim yapılmaz.
- İşlem kimliği imzalama katmanında da kontrol edilir; üst süreç durumu kaybolsa bile aynı güne ait başarılı görev tekrar gönderilmez.
- Gün sınırında kalan işlem ancak gerçekten bloklandığı güne yazılır. Önceki gün geriye dönük tamamlanamaz.

Ön kontrol:

```sh
npm run streak -- --dry-run
```

Kampanya aktifken salt okunur teklif/plan kontrolü yapar. Aktif değilken yalnızca takvimi gösterir.
Başlangıçtan önce cüzdan/ağ kontrolü için `streak:prepare` kullan.
Genel `all` komutuyla veya QWAP arayüzünde yapılan manuel işlemler bu modun yerel kampanya kimliğiyle etiketlenmez.
Streak runner'ın tekrar önleme kontrolü kendi etiketli işlemlerini kapsar; resmî platform tüm cüzdan aktivitelerini farklı şekilde değerlendirebilir.

## Windows otomatik çalışma

Hazırlık sonrasında otomatik görevi **etkinleştirmek için**:

```sh
npm run streak:install
```

Görev adı: `QMS-Testnet-Streak-2026-10-19`.
İlk çalışma **19 Ekim 13:05 UTC / Türkiye 16:05**; başlangıç sınırından beş dakika sonra.
Görev saatlik kontrol yapar: tamamlanan gün işlem üretmez; geçici hatada aynı gün kaldığı yerden devam edebilir.
Tanım UTC sınırı taşır ve kampanya sonunda kapanır. `StartWhenAvailable` kaçırılan tetiklemeyi bilgisayar tekrar uygun olduğunda çalıştırabilir.

**Bilgisayar açık ve aynı Windows kullanıcısının oturumu açık olmalı.** Bilgisayar kapalıyken işlem yapamaz;
kaçırılmış bir görev gününü sonradan dolduramaz. Uyku durumunda uyandırma zorlanmaz.
Windows otomasyonu mevcut kullanıcıya ait DPAPI dosyası gerektirir; görev tanımına private key veya parola yazılmaz.
Gizli arka plan süreci kullanılır. İlk hazırlıkta bağlanan public adres değiştirilirse görev imzalamayı durdurur.

Görev oluşturmadan doğrulama:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-streak-task.ps1 -ValidateOnly
```

Kaldırmak için:

```sh
npm run streak:uninstall
```

Linux/macOS'ta günlük `npm run streak` kullanılabilir; parola isteyen keystore için bu sürüm otomatik cron kurmaz veya parolayı dosyaya kaydetmez.

## Quanta takibi

Her gün hem swap hem LP doğrulanınca standart rolde 8, Pioneer/Qwabbit rolünde 10 Quanta **yerel tahmini** hesaplanır.
Herhangi 6/7 gün tamamlanırsa 14 veya 18 bonus eklenir; tek gün kaçırılması bonusu bozmaz.

| Tamamlanan gün | Standart | Pioneer / Qwabbit |
| --- | --- | --- |
| 6 | 62 | 78 |
| 7 | 70 | 88 |

Rol tahminini ayarlamak için:

```sh
npm run streak:prepare -- --role pioneer
```

`standard`, `pioneer`, `qwabbit` desteklenir. Rol değişikliği Discord üyeliği veya hak kazandırmaz.
Resmî Quanta kaydı, kampanyanın tanıdığı LP türü ve rol uygunluğu resmî arayüzden kontrol edilmelidir.
Bu araç zincirdeki işlemleri doğrular; puan verildiğini veya ödül kazanıldığını garanti etmez.

## Kayıtlar

- `reports/streak-2026-10-19/<public-address>.json`: gün bazında kanıt ve ilerleme.
- `reports/tx-*.json`: gönderim öncesi hash, nonce, kampanya işlem kimliği ve sonuç.
- `reports/streak-2026-10-19/run-*.log`: okunur günlük çalıştırma kaydı.
- `reports/streak-scheduler/*.log`: Windows arka plan görev çıktıları.
- `.cache/streak-wallet.json`: mevcut public adres/rol bağı; private key içermez.

Bu dosyalar Git'e dahil edilmez. Anahtarlar mevcut `.secrets/` korumasıyla yerelde kalır.
Kayıtları silmek tekrar önleme ve devam etme özelliğini zayıflatır.
Kilit veya belirsiz gönderim hatasında kayıtlı hash'i ve çalışan süreçleri kontrol et; kilitleri otomatik silen bir mekanizma yoktur.
