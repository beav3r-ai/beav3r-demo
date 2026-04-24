# beav3r-demo

Minimal Node.js quickstart plus an executor auth e2e sample for `payments.send_usdt`.

Reference docs: https://docs.beav3r.ai/sdk/run-your-first-script
Official repo: https://github.com/beav3r-ai/beav3r-demo

## Requirements

- Node.js 20+

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

4. Run the base quickstart:

   ```bash
   npm start
   ```

5. Run the exec-auth e2e sample:

   ```bash
   npm run exec-auth-demo
   ```

## Exec-Auth E2E Flow (`payments.send_usdt`)

`payments-send-usdt-exec-auth-demo.mjs` demonstrates:

1. `guardAndWait` for `payments.send_usdt` with `audience=payments-executor`
2. require `executionAuthorizationArtifact` from `guardAndWait` result or artifact mint/get API
3. fetch exact action request via `getAction(actionId)`
4. verify structured artifact with SDK `verifyExecutionAuthorization`
5. recompute `actionHash` from exact action request and enforce replay one-time consumption (`artifactId`/`jti`)
6. execute payment only after middleware authorization succeeds

`executor-auth-middleware.mjs` fail-closes on:

- missing artifact
- invalid artifact verification
- expired artifact
- action hash mismatch (artifact vs recomputed hash)
- replay (`artifactId`/`jti` reuse)

## Exec-Auth Config

Optional env fallback if SDK key-fetch API is unavailable:

```env
BEAV3R_EXECUTION_VERIFICATION_KEYS_JSON={"exec_key_1":"base64-ed25519-public-key"}
```

## Threat Model Notes

- Replay: middleware requires single-use `jti` and rejects reused tokens.
- Tampering: structured execution artifact must pass SDK verification and action hash recomputation before execution.
- Bypass: executor must route all `payments.send_usdt` calls through middleware; no direct execute path.
- Trust boundaries: guard/mint service is trusted to issue artifacts, executor trusts only pinned verification keys and exact action hash recomputation.

## Assumptions

- This demo uses expected SDK method shapes for planned exec-auth APIs.
- `verifyExecutionAuthorization` helper is required for structured artifact verification.
- Expected artifact field is `executionAuthorizationArtifact` on guard/artifact responses.
- If your SDK version does not expose `verifyExecutionAuthorization`, the demo fails closed with an explicit error.

## Notes

- `.env` is ignored by git and should not be committed.
- The script loads `.env` with `dotenv` and exits early if `BEAV3R_API_KEY` is missing.
- You can override `BEAV3R_BASE_URL`, `BEAV3R_AGENT_ID`, and `BEAV3R_DEFAULT_EXPIRY_SECONDS` in `.env` if needed.
