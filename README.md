# beav3r-demo

Protocol-focused Beav3r SDK demos for:
- offchain permissioned execution (`index.mjs`)
- onchain executor + keeper execution (`onchain-example.mjs`)

Reference docs: https://docs.beav3r.ai/sdk/run-your-first-script  
Official repo: https://github.com/beav3r-ai/beav3r-demo

## Requirements

- Node.js 20+
- npm

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Create env file:
   ```bash
   cp .env.example .env
   ```
3. Set required values in `.env`.

## Offchain Flow (`index.mjs`)

Run:

```bash
npm start
```

Runtime behavior:
1. `guardAndWait(...)` requests approval for `payments.send_usdt`.
2. `getExecutionAuthorizationKeys()` loads trusted verification keys from server transport (`/.well-known/execution-authorization-keys`).
3. `getAction(...)` fetches the exact request to execute.
4. `authorizeAndExecute(...)` verifies artifact integrity, redeems once, and executes callback logic.

Security model:
- one-time redemption blocks replay
- local verification blocks tampering
- execution path is routed through `authorizeAndExecute(...)`

## Onchain Flow (`onchain-example.mjs`)

Run:

```bash
npm run onchain-demo
```

Runtime behavior:
1. `guardAndWait(...)` requests approval.
2. Script encodes keeper calldata:
   `TokenKeeper.transferToken(ONCHAIN_TOKEN_ADDRESS, ONCHAIN_RECIPIENT, amount)`.
3. `authorizeOnchainAction(...)` returns auth payload + signature.
4. Script encodes `executeWithAuth(...)` and submits transaction to `ONCHAIN_EXECUTOR_ADDRESS`.

This script is keeper-first and explicit:
- `ONCHAIN_KEEPER_ADDRESS` is required
- no call-mode switching
- no alternate transfer path

Optional timing overrides:
- `BEAV3R_POLL_INTERVAL_MS` (default `2000`)
- `BEAV3R_TIMEOUT_MS` (default `300000`)
- `ONCHAIN_NONCE` (default `current unix time`)
- `ONCHAIN_EXPIRES_AT` (default `nonce + 1200`)

## Demo Contracts

- `contracts/TokenKeeper.sol`: token holder with executor allowlist
- `contracts/DemoUSDT.sol`: 6-decimal ERC20 demo token

Suggested order:
1. Deploy `TokenKeeper` with owner + initial executor.
2. Deploy `DemoUSDT` and seed keeper balance.
3. Set `.env` values for keeper/token/executor/actor.
4. Run `npm run onchain-demo`.
