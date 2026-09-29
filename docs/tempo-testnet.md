# Use Tempo testnet (Moderato)

| | |
|---|---|
| Chain id | `42431` |
| RPC | `https://rpc.moderato.tempo.xyz` |
| Explorer | `https://explore.testnet.tempo.xyz` |
| Token | pathUSD `0x20c0000000000000000000000000000000000000` (6 decimals, also the fee token) |
| Escrow | TIP-1034 `TIP20EscrowChannel` precompile `0x4d50500000000000000000000000000000000000` |
| Faucet | RPC method `tempo_fundAddress` (`Actions.faucet.fund` in `viem/tempo`) |

These values come from viem's `tempoModerato` chain definition and mppx's precompile constants.

## 1. Generate and fund keys

```bash
npm run tempo:setup
```

This writes testnet-only keys for the PACT operator, the demo agent and two demo providers to
`.env` (gitignored, mode 600), sets `PACT_RAIL=tempo`, and funds each address from the faucet.
It prints addresses and balances, never keys.

## 2. Prove the primitive

```bash
npm run tempo:smoke
```

Opens two escrow channels, signs vouchers and closes them — once capturing `0` (refund) and once
capturing the price (settle) — and prints explorer links for every transaction.

## 3. Run the gateway on Tempo

```bash
npm run dev
```

The Control Center sidebar shows **Tempo Moderato**; every pact now has an escrow-open transaction
and a settlement transaction you can open on the explorer.

## 4. Live tests

```bash
npm run test:live
```

Runs one verified pact (price captured on-chain) and one failing pact (full refund on-chain).

## Costs

Each pact is two transactions: the agent opens the channel, the operator closes it. On Moderato fees
are paid in pathUSD and are fractions of a cent; `tempo:smoke` prints the exact balance deltas.
