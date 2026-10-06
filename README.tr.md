# QMS Testnet Runner — Türkçe

[English README](README.md) · [GitHub](https://github.com/eCoxvague/qms-testnet-runner)

Tek komutla QMS kontrat deploy, sayaç testi, QWAP swap/likidite ve QUBO çözüm değeri kontrolü.
Bağımsız topluluk aracıdır; resmî QMS/QWAP ürünü değildir.

## Başlangıç

**Node.js 22+** ve Git kur, ardından:

```sh
git clone https://github.com/eCoxvague/qms-testnet-runner.git
cd qms-testnet-runner
```

Windows'ta tek komut:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\start.ps1
```

Linux / macOS:

```sh
bash start.sh
```

Bağımlılıkları kurar ve ilk çalıştırmada **test cüzdanının private key'ini gizli sorar**.
Anahtarı kaynak koda yazacağın bir alan yoktur. Windows'ta DPAPI, Linux/macOS'ta parola korumalı
JSON keystore olarak `.secrets/` içine şifreli kaydedilir. Anahtar dosyaları Git'e dahil edilmez.
Linux/macOS'ta en az 12 karakterli keystore parolası seçilir; sonraki çalıştırmada bu parola sorulur.

Public adresini [faucet](https://faucet.testnet.qms.finance/) alanına girip ücretsiz QMS al.
Varsayılan akış rezervlerle **0.65 test QMS** ister. Bakiye yetmezse durur;
token aldıktan sonra aynı komutu çalıştır. Faucet'in tarayıcı kontrolleri elle tamamlanır.
Testnet tokenlerinin parasal değeri yoktur; ayrı bir test cüzdanı kullan.

Kurulumdan sonra:

```sh
npm start
```

## Akış

1. Ağ, QWAP ve bakiye kontrolü.
2. Yeni QmsCounter deploy ve bytecode doğrulaması.
3. Sayaç 0 → 1 ve event kontrolü.
4. **0.2 QMS → test USDC** swap.
5. Gereken miktarda USDC izni, ardından **0.1 QMS ile WQMS/USDC likidite**.
6. Bakiye ve LP artışı kontrolü.
7. Deploy bloğundaki QUBO matrisini indirip xᵀQx değerini doğrulama.

Her işlem önce simüle edilir, ardından iki blok onayı beklenir. Hata olursa sonraki adıma geçmez.
Normal her çalıştırma yeni test turu gönderir. QUBO kontrolü çözüm değerini doğrular; optimumluğu kanıtlamaz.

```sh
npm start -- --dry-run
npm start -- --swap-amount 0.2 --liquidity-amount 0.1 --slippage-bps 100
```

Ön kontrol işlem göndermez; bağımlı sayaç ve likiditeyi atladığını raporlar.
`--verbose` JSON ayrıntılarını, `--no-color` renksiz çıktıyı açar.
Yeni anahtar için `npm run key:import`. Mevcut Windows kullanıcılarında `npm run all` da çalışır.

## Loglar

Renkli adımlar, işlem bağlantıları, onaylar, süre ve bakiye/gas özeti gösterilir.
Saat dilimi Europe/Istanbul. Son durum `reports/run-latest.json`; her tur için JSON ve `.log` tutulur.
Anahtar, log, deploy adresi ve derleme dosyaları yerelde kalır.
Hata verdiğinde önceki başarılı işlemler geri alınmaz. Kesintide rapordaki hash'i kontrol etmeden yeniden başlatma.
`scripts/read-key.ps1` iç yardımcıdır ve doğrudan çalıştırılmamalıdır.

[Teknik ayrıntılar](README.md) · [Resmî rehber](https://qms.finance/news/welcome-to-qms-testnet) · [MIT](LICENSE).
