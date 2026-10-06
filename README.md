# QMS Testnet Runner

[![Checks](https://github.com/eCoxvague/qms-testnet-runner/actions/workflows/test.yml/badge.svg)](https://github.com/eCoxvague/qms-testnet-runner/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

One command to deploy a contract, call it, swap on QWAP, add liquidity, and verify a block's QUBO solution value.

**[Türkçe kurulum ve kullanım](README.tr.md)**

Community tooling based on the [official QMS onboarding guide](https://qms.finance/news/welcome-to-qms-testnet).
Independently maintained; not an official QMS or QWAP product.

## Quick start

Install **Node.js 22+** and Git, then clone:

```sh
git clone https://github.com/eCoxvague/qms-testnet-runner.git
cd qms-testnet-runner
```

**Windows — one command to install dependencies, set up your wallet, and run:**

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\start.ps1
```

**Linux / macOS:**

```sh
bash start.sh
```

On the first run, the launcher asks for your test wallet's private key with hidden input.
Use a separate test wallet. There is no private key to edit inside the source code.
Windows stores it with **DPAPI**; Linux/macOS use a password-encrypted **ethers JSON keystore**.
The setup does not print keys or passwords. Reports do not contain them.
The runner signs locally; it does not upload your key to a service.

Copy your public address into the [official faucet](https://faucet.testnet.qms.finance/).
The default workflow requires **0.65 test QMS**, including conservative gas reserves.
If the balance is insufficient, claim test QMS and run the launcher again.
Faucet browser checks are manual. Testnet tokens have no monetary value.

After dependencies are installed:

```sh
npm start
```

Each normal run broadcasts a new test round. Linux/macOS ask for the keystore password once per run.

## Workflow

| Step | Check |
| --- | --- |
| Network & QWAP | Chain ID 19480 and router/factory/token/pool relationships |
| Wallet & budget | Balance, gas limits and native QMS reserve |
| Deploy QmsCounter | Receipt, runtime bytecode, initial count=0 |
| Increment | Count 0 → 1 and event verification |
| Swap | 0.2 QMS → test USDC; receipt and balance increase |
| Liquidity | Exact-amount approval if needed, then 0.1 QMS + USDC into WQMS/USDC; LP increase |
| Final balances | Wallet, test USDC and LP balances |
| Block / QUBO | Block hash match and integer calculation of xᵀQx |

Transactions are simulated before sending and wait for two block confirmations.
Actions run sequentially; an error stops later actions. Confirmed transactions remain on chain.
QUBO verification checks the objective value of a supplied solution; it does not prove global optimality.

## Options

```sh
npm start -- --dry-run
npm start -- --swap-amount 0.2 --liquidity-amount 0.1 --slippage-bps 100
npm start -- --verbose
npm start -- --no-color
```

Launcher preview: `bash start.sh --dry-run`, or
`powershell -NoProfile -ExecutionPolicy Bypass -File .\start.ps1 --dry-run`.
A dry run broadcasts nothing and explicitly skips dependent increment/liquidity actions.

Defaults: 1% slippage, max 1 QMS per native action, max 0.05 QMS gas per transaction,
0.1 QMS retained for gas. Slippage accepts 1–500 bps (0.01%–5%).

## Wallet setup

```sh
npm run key:import
```

This replaces the local saved wallet. Windows DPAPI is tied to your Windows user and machine.
Linux/macOS require a keystore password of at least 12 characters. Keep your own wallet backup.
Existing Windows users can still use `npm run all`. For JSON keystores, use `npm start` for password entry.
Advanced integrations may supply `QMS_PRIVATE_KEY` or `QMS_KEYSTORE_PASSWORD` in the process environment;
never put either in committed files or command arguments.

`scripts/read-key.ps1` is an internal helper. The CLI captures its stdout in memory.
Do not run the helper directly or redirect its output to a log.

## Logs and recovery

Numbered steps, transaction links, confirmations, timings and balance/gas summaries.
Times use `Europe/Istanbul`. All these outputs are excluded from Git:

- `.secrets/`: encrypted wallet files
- `reports/run-latest.json`: latest workflow state
- `reports/run-*.json` and `.log`: individual runs and readable logs
- `reports/tx-*.json`: submitted hashes and receipt status
- `reports/block-*.json` and `.mtx.gz`: QUBO evidence
- `deployments/` and `artifacts/`: addresses and compiler output

Receipt timeout is 180 seconds; a timeout does not prove failure.
Hash/nonce metadata are journaled before broadcast. Unresolved sends block new submissions; signed payloads are not saved.
Check recorded hashes in the explorer before repeating a run.
If approval succeeds but deposit fails, that limited approval remains on chain.
If a stopped process leaves `.cache/run-all.lock`, verify no runner is active and check transaction status before removing it.

## Network

| Setting | Value |
| --- | --- |
| Chain ID | 19480 |
| RPC | https://rpc.testnet.qms.finance |
| Explorer | https://testnet.qmsscan.io |
| Faucet | https://faucet.testnet.qms.finance |
| DEX | https://testnet.qwap.xyz |

The router getter is `WQMS()`, confirmed on chain.
The current testnet returns genesis for `safe`/`finalized` tags; receipt checks use block confirmations.
Testnet state can be reset.

## Development

```sh
npm ci
npm test
npm run security:check
npm run compile
npm audit
```

Optional live read-only simulation: `npm run smoke`. Individual tools: `npm run qms -- help`.
CI checks Windows, Linux and macOS without wallet keys. DPAPI tests run on Windows.
Standard JSON for optional explorer verification: `artifacts/standard-input.json`.
Source verification is not automatically submitted. [MIT](LICENSE).

[Security controls and review scope](SECURITY.md).
