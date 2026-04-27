import "dotenv/config";
import { Beav3r } from "@beav3r/sdk";

const requiredEnvVars = ["BEAV3R_API_KEY"];
const missingEnvVars = requiredEnvVars.filter((name) => {
  const value = process.env[name]?.trim();
  return !value || value.includes("replace-with-your");
});

if (missingEnvVars.length > 0) {
  console.error(
    `Missing required environment variables: ${missingEnvVars.join(", ")}.`,
  );
  console.error(
    "Copy .env.example to .env and replace BEAV3R_API_KEY before running the script.",
  );
  process.exit(1);
}

const EXECUTOR_AUDIENCE = "payments-executor";
const VERIFICATION_KEYS = JSON.parse(
  process.env.BEAV3R_EXECUTION_VERIFICATION_KEYS_JSON ?? "{}",
);

const client = new Beav3r({
  apiKey: process.env.BEAV3R_API_KEY,
  baseUrl: process.env.BEAV3R_BASE_URL ?? "https://staging.server.beav3r.ai",
  agentId: process.env.BEAV3R_AGENT_ID ?? "sdk_exec_auth_demo",
  defaultExpirySeconds: Number(process.env.BEAV3R_DEFAULT_EXPIRY_SECONDS ?? 180),
});

const intendedAction = {
  actionType: "payments.send_usdt",
  payload: {
    amount: 25,
    asset: "USDT",
    network: "base",
    recipient: "0x1111111111111111111111111111111111111111",
    summary: "Send 25 USDT to treasury wallet",
  },
  attributes: {
    executionAudience: EXECUTOR_AUDIENCE,
  },
};

async function main() {
  // Step 1: ask Beav3r for permission for one exact action.
  const guardResult = await client.guardAndWait(intendedAction, {
    pollIntervalMs: 2000,
    timeoutMs: 5 * 60 * 1000,
    audience: EXECUTOR_AUDIENCE,
  });

  if (guardResult.status !== "approved" && guardResult.status !== "executed") {
    throw new Error(
      `Action was not approved for execution. status=${guardResult.status} actionId=${guardResult.actionId}`,
    );
  }

  // Step 2: use the signed execution artifact returned on approval.
  const artifact = guardResult.executionAuthorizationArtifact;
  if (!artifact?.payload?.keyId) {
    throw new Error(
      "guardAndWait did not return an execution authorization artifact. Run this demo against the v2 execution-auth flow.",
    );
  }
  
  if (!VERIFICATION_KEYS[artifact.payload.keyId]) {
    throw new Error(
      `Missing trusted public key for keyId "${artifact.payload.keyId}" in BEAV3R_EXECUTION_VERIFICATION_KEYS_JSON.`,
    );
  }

  // Step 3: fetch the exact action request that the executor will spend.
  const action =
    typeof client.getExactActionRequest === "function"
      ? await client.getExactActionRequest(guardResult.actionId)
      : await client.getAction(guardResult.actionId);

  // Step 4: verify the artifact locally, redeem it once with Beav3r,
  // then run the real side effect.
  const execution = await client.authorizeAndExecute({
    action,
    artifact,
    audience: EXECUTOR_AUDIENCE,
    publicKeys: VERIFICATION_KEYS,
    execute: async ({ action, redemption }) => {
      await executePaymentSendUsdt(action);
      return {
        status: "executed",
        spentArtifactId: redemption.artifactId,
      };
    },
  });

  console.log("Execution completed. Permission spent once.");
  console.log({
    actionId: execution.actionId,
    actionHash: execution.actionHash,
    artifactId: execution.artifactId,
    redeemedAt: execution.redemption.redeemedAt,
    audience: EXECUTOR_AUDIENCE,
  });
}

async function executePaymentSendUsdt(exactActionRequest) {
  const { payload } = exactActionRequest;
  console.log("Executing payments.send_usdt");
  console.log({
    amount: payload.amount,
    asset: payload.asset,
    network: payload.network,
    recipient: payload.recipient,
    summary: payload.summary,
  });

  // Replace this with your real payment rail or wallet integration.
}

main().catch((error) => {
  console.error("Demo failed.");
  console.error(error);
  process.exit(1);
});
