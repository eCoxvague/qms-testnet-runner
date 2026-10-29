# Günlük QMS testnet modu

19–26 Ekim streak kaydı ayrı kalır. Bu mod günlük küçük test işlemleri içindir; Quanta veya başka ödül kazandırdığı iddia edilmez.

## Günlük plan

| Adım | Tutar / işlem |
| --- | --- |
| Swap 1 | 0.1 test QMS → güncel test USDC |
| Swap 2 | 0.1 test QMS → güncel test USDC |
| LP ekleme | 0.05 test QMS + karşılığı USDC |
| Kontrat etkileşimi | Önceden kurulmuş QmsCounter sayacını artırma |

Gerekirse LP için bir exact-amount USDC onayı da gönderilir. **Toplam günlük üst sınır 5 zincir işlemidir; onay ve başarısız/revert işlemleri de bu sınıra dahildir.** Yeniden deneme bu sınırı artırmaz. Aynı günde her swap slotu, LP ve sayaç etkileşimi en fazla bir başarılı işlemle tamamlanır.

Native tutar toplamı en fazla **0.25 QMS/gün**, gas üst sınırı **0.25 QMS/gün**, elde tutulan rezerv **0.1 QMS**. Varsayılan ilk kontrol için konservatif bakiye 0.6 QMS. 30 günlük native tutar 7.5 QMS'dir; gas ayrıca tüketilir. Bakiye yetersizse işlem durur; faucet otomatik kullanılmaz.

## Hazırlık ve çalıştırma

```sh
npm run daily:prepare
npm run daily -- --dry-run
npm run daily
npm run daily:status
```

Hazırlık mevcut yerel test cüzdanını ve daha önce deploy edilmiş, bytecode'u eşleşen test sayacını kullanır; zincire işlem göndermez. Sayaç hiç kurulmamışsa bir defa şu komut gerekir; bu ilk kurulum, günlük akışın dışında ayrı bir işlemdir:

```sh
npm run qms -- deploy --broadcast
npm run daily:prepare
```

Hazırlanan cüzdan, sayaç ve aktif havuzlar yerel bir plan parmak izine bağlanır. Ayarlar/deployment değişirse otomatik imzalama durur ve yeniden hazırlık ister. Aynı güne ait bir plan değişikliği o günün kayıtlarını otomatik silmez.

## Otomatik Windows görevi

```sh
npm run daily:install
npm run daily:uninstall
```

Mevcut profil **29 Ekim 2026 16:00 Türkiye** ile **28 Kasım 2026 16:00 Türkiye** arasında geçerlidir. İlk günlük kontrol **16:15 Türkiye**, ardından saatlik kontrollerdir. Gün sınırı **16:00 Türkiye / 13:00 UTC**. Tamamlanan gün/adımlar yeniden gönderilmez. Bilgisayar kapalı/uykudayken işlem yapılamaz; açılıp aynı Windows kullanıcısı oturum açınca uygun kontrolde devam eder. VS Code veya terminalin açık kalması gerekmez.

Bu profil 30 gün sonra kendi sınırında durur. Daha uzun çalıştırma veya yeni testnet için profil bilinçli olarak güncellenip yeniden hazırlanmalıdır. Eski streak görevi ve kayıtları değiştirilmez.

Task Scheduler görevi `QMS-Daily-Activity-2026-10-29`; aynı Windows kullanıcısının DPAPI dosyasını kullanır. Görev tanımında private key veya parola bulunmaz. `daily:prepare` tek başına zamanlama kurmaz.

## Kayıtlar ve tekrar güvenliği

- `reports/daily-2026-10-29/<adres>/<gün>.json`: adım kanıtları ve günlük durum.
- Aynı klasörde `run-*.log`: okunur akış kayıtları.
- `reports/daily-scheduler/`: arka plan stdout/stderr kayıtları.
- `.cache/daily-wallet.json`: public adres, sayaç ve plan bağı; Git'e eklenmez.

Doğrulama, gerçek receipt, gönderici, calldata, token transferi / LP Mint ve sayaç event'i üzerinden yapılır. Gün, işlemin bloklandığı zamana göre belirlenir. Bir işlem RPC yanıtı kaybolmadan önce bloklandıysa kayıtlı hash'ten toparlanır. Belirsiz işlem varken yeni işlem gönderilmez. Cüzdan kilidi altında tekrar kontrolü ile günlük işlem/tutar/gas sınırı ayrıca uygulanır; üst akış kaydı kaybolsa da journal aynı adımı tekrar göndermez. Hem journal hem kanıt kayıtları korunmalıdır; kilit veya hash dosyalarını körlemesine silmeyin.

Tüm tokenler testnet içindir ve parasal değer taşımaz. Mevcut eski LP pozisyonları bu günlük mod tarafından çekilmez veya taşınmaz.
