# QWAP pool update — 29 October 2026

QWAP deprecated and re-added its test USDC, USDT, WBTC, WETH and affected pools. The runner uses only the WQMS/USDC pair, so its USDC and pair pins have been updated.

| Contract | Active address |
| --- | --- |
| USDC | `0xDd4D61DF875cc613E1372c78827a5F4C2741bf11` |
| WQMS/USDC pair | `0xc9c07DC80B9381615ef5a575c333125F711465eD` |

The router, factory and WQMS addresses are unchanged. The active pins were checked against the official https://testnet.qwap.xyz/ chain 19480 configuration and against RPC bytecode, router getters, factory pair lookup, pair tokens, reserves and a swap quote. The configuration records the verification block.

## Current commands

```sh
npm run status
npm run qms -- wallet
npm run qms -- quote --amount 0.2
```

These commands do not send transactions. `wallet` now reports active USDC/LP and deprecated USDC/LP separately. Old USDC does not satisfy the new pool's USDC requirement.

For a manual test, the explicit transaction commands are:

```sh
npm run qms -- swap --amount 0.2 --broadcast
npm run qms -- liquidity --amount 0.1 --broadcast
```

The liquidity command deposits into the active pool. Existing deprecated LP positions are not withdrawn, exchanged or moved by these commands. Removing liquidity and moving a position are separate actions; an address change alone does not migrate assets. Do not assume a deprecated token can be redeemed for its replacement.

## Existing streak records

The configured 19–26 October streak is finished. This update does not extend it, create another campaign, or enable another scheduled task.

Historic transactions remain verifiable against the original router/token/pair tuple when their mined timestamp precedes the announced 29 October 09:00 UTC cutoff. Deprecated routes at or after that cutoff are not accepted as current streak evidence. Token and pair addresses from different deployments cannot be mixed to satisfy a proof.

References: [QWAP](https://testnet.qwap.xyz/), [QMS announcements](https://t.me/s/QMSNetworkOfficial).
