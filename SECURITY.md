# Security and review scope

This is a **testnet-only** local CLI, not a hosted wallet service. Use a separate test wallet.

## Credential handling

- Interactive key input is masked. No key is embedded in the source code.
- Windows stores encrypted data with DPAPI; Linux/macOS use an ethers password-encrypted JSON keystore.
- Secret files are excluded from Git. The CI scanner also rejects local secret/report paths and suspicious literal credentials in Git history/index.
- The secret scan reports filenames and rule names, never matched credential values.
- Private keys are used locally for signing. Network calls contain public requests or signed transactions, not private keys.
- Read-only workflow subprocesses do not inherit the QMS private key or keystore password variables.
- The recorded wallet address is enforced on later workflow actions to stop an accidental wallet switch.

Local processes with access to your account, unlocked process memory, or Windows DPAPI identity may access credentials.
Encryption at rest does not defend against a compromised computer or malicious changes to this repository.
JavaScript does not guarantee immediate erasure of immutable secret strings from memory.
The internal Windows read helper returns decrypted data over a captured pipe; do not execute it directly.

## Transaction safeguards

- Chain ID is checked before signing and again on the serialized signed transaction.
- Native value, gas budget, slippage and remaining reserve are bounded.
- Hash/nonce/public metadata are persisted **before** sending. The signed payload and private key are not written to the journal.
- Per-wallet locks prevent overlapping CLI submissions. Unresolved earlier sends block new submissions until confirmed receipts can be reconciled.
- RPC response loss and receipt timeout remain explicitly unresolved; the code does not automatically resend them.
- Atomic file replacement avoids partially written JSON/keystore records. Secret symlink targets are rejected.
- Error messages are stripped of terminal controls and long hexadecimal payloads.

If a send is unresolved, inspect `reports/tx-*.json` and the explorer. Do not delete records to bypass the check.
If a crashed process leaves `.cache/tx-*.lock`, first check its PID, stop any active runner, and resolve recorded hashes before removing that stale lock.
Other wallet apps can still submit transactions using the same account; this CLI cannot lock those apps.

## Dependency and CI controls

Dependencies are pinned through the lockfile and verified with `npm audit`.
Launchers disable dependency lifecycle scripts with `--ignore-scripts`.
GitHub Actions are pinned to commit SHAs; CI has read-only repository permissions and does not receive wallet keys.
CI includes a Git history/index secret scan, local mocked transaction tests and platform checks.

## Review on 6 October 2026

The published Git history and files were checked for the owner's actual key and public wallet address; neither was found.
No outbound key upload path was found in the CLI review.
Two reproducible weaknesses were corrected: missing pre-send journaling after RPC response loss, and terminal control sequences surviving error formatting.
Additional hardening covers credential subprocess inheritance, wallet consistency, atomic secret/report writes and CI/install controls.

Tests use generated or intentionally dummy keys. No funded user wallet is used by CI.
This review is scoped to the repository and its current dependencies; it is not an independent cryptographic audit or a guarantee of zero vulnerabilities.

Report a suspected issue without posting private keys, seed phrases, keystore passwords, or local secret files.
