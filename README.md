# beav3r-demo

Minimal Beav3r v2 `payments.send_usdt` demo for the permission -> spend -> execute flow.

Reference docs: https://docs.beav3r.ai/sdk/run-your-first-script
Official repo: https://github.com/beav3r-ai/beav3r-demo

## Requirements

- Node.js 20+
- `@beav3r/sdk@2.0.0-beta.4` (installed via `npm install`)

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a local env file:

   ```bash
   cp .env.example .env
   ```

3. Replace the placeholder API key in `.env`:

   ```env
   BEAV3R_API_KEY=replace-with-your-real-beav3r-api-key
   ```

4. Run the v2 demo:

   ```bash
   npm start
   ```

## Permission -> Spend -> Execute (`payments.send_usdt`)

`index.mjs` is the only demo script and demonstrates the intended offchain executor flow:

1. `guardAndWait(...)` asks Beav3r for permission for `payments.send_usdt`
2. if approved, use the structured execution authorization artifact returned by `guardAndWait(...)`
3. fetch the exact action request via `getAction(actionId)`
4. load trusted Beav3r verification keys from `BEAV3R_EXECUTION_VERIFICATION_KEYS_JSON`
5. `authorizeAndExecute(...)` verifies the artifact locally, redeems it once with Beav3r, then runs the real payment callback

The important split is:

- `guardAndWait` = permission
- `authorizeAndExecute` = spend + execute

That keeps replay protection inside the spend phase rather than making every integrator hand-roll verification, redemption, and callback sequencing.

The SDK verifier automatically ignores Beav3r display-only `payload.presentation` metadata, so the `getAction(...)` response can flow directly into executor verification without manual stripping.

## Exec-Auth Config

Optional env fallback if SDK key-fetch API is unavailable:

```env
BEAV3R_EXECUTION_VERIFICATION_KEYS_JSON={"your-server-execution-auth-key-id":"base64-ed25519-public-key"}
```

The JSON key must match the server signing `keyId` embedded in the artifact payload. In the current server setup, that is the same value as `EXECUTION_AUTH_KEY_ID`.

## Threat Model Notes

- Replay: the same artifact must be redeemed once before execution; a second redemption fails closed.
- Tampering: structured execution artifacts must pass SDK verification and exact action hash recomputation before execution.
- Bypass: executor must route all `payments.send_usdt` calls through `authorizeAndExecute(...)`; no direct execute path.
- Trust boundaries: guard/mint service is trusted to issue artifacts, executor trusts only pinned verification keys and the exact action hash recomputed from the request it will actually execute.

## Assumptions

- This demo targets the published beta API (`@beav3r/sdk@2.0.0-beta.4`).
- `guardAndWait(..., { audience })` returns `executionAuthorizationArtifact` on allow states.
- `authorizeAndExecute(...)` is the recommended executor entrypoint for offchain spend protection.
