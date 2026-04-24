import "dotenv/config";
import * as beav3rSdk from "@beav3r/sdk";
import {
  createExecutorAuthMiddleware,
  ExecutorAuthError,
  InMemoryReplayStore,
} from "./executor-auth-middleware.mjs";

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
const { Beav3r, verifyExecutionAuthorization } = beav3rSdk;

const client = new Beav3r({
  apiKey: process.env.BEAV3R_API_KEY,
  baseUrl: process.env.BEAV3R_BASE_URL ?? "https://staging.server.beav3r.ai",
  agentId: process.env.BEAV3R_AGENT_ID ?? "sdk_quickstart",
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

  const executionAuthorizationArtifact = await requireExecutionAuthorizationArtifact(
    client,
    {
      guardResult,
      actionId: guardResult.actionId,
      audience: EXECUTOR_AUDIENCE,
    },
  );
  const exactActionRequest = toActionRequest(
    await client.getAction(guardResult.actionId),
  );
  const trustedPublicKeys = await getTrustedExecutionVerificationKeys(
    client,
    EXECUTOR_AUDIENCE,
  );

  const authorizeExecution = createExecutorAuthMiddleware({
    audience: EXECUTOR_AUDIENCE,
    verifyExecutionAuthorization,
    trustedPublicKeys,
    replayStore: new InMemoryReplayStore(),
  });

  const authz = await authorizeExecution({
    executionAuthorizationArtifact,
    actionRequest: exactActionRequest,
  });

  await executePaymentSendUsdt(exactActionRequest);

  console.log("Execution completed with verified execution authorization artifact.");
  console.log({
    actionId: guardResult.actionId,
    actionHash: authz.actionHash,
    artifactId: authz.artifactId ?? authz.jti,
    audience: EXECUTOR_AUDIENCE,
  });
}

async function requireExecutionAuthorizationArtifact(beav3rClient, context) {
  const { guardResult, actionId, audience } = context;

  const fromGuardResult = extractStructuredArtifact(
    guardResult?.executionAuthorizationArtifact,
    "guardAndWait result",
  );
  if (fromGuardResult) {
    return fromGuardResult;
  }

  const response = await beav3rClient.mintExecutionAuthorization({
    actionId,
    audience,
  });

  const fromResponse = extractStructuredArtifact(
    response?.executionAuthorizationArtifact ?? response,
    "mintExecutionAuthorization response",
  );
  if (!fromResponse) {
    throw new Error(
      "Execution authorization artifact was not returned from mintExecutionAuthorization.",
    );
  }
  return fromResponse;
}

function extractStructuredArtifact(value, sourceLabel) {
  if (!value) {
    return undefined;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return parsed;
        }
      } catch (error) {
        throw new Error(
          `${sourceLabel} returned a malformed JSON artifact string.`,
        );
      }
    }
    throw new Error(
      `${sourceLabel} returned a token string; expected a structured executionAuthorizationArtifact object.`,
    );
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return value;
  }
  throw new Error(
    `${sourceLabel} returned an unsupported artifact type (${typeof value}).`,
  );
}

async function getTrustedExecutionVerificationKeys(beav3rClient, audience) {
  const keyFetchMethod =
    beav3rClient.getExecutionVerificationKeys ??
    beav3rClient.listExecutionVerificationKeys ??
    beav3rClient.getTrustedPublicKeys;

  if (typeof keyFetchMethod === "function") {
    const response = await keyFetchMethod.call(beav3rClient, { audience });
    const normalized = normalizeTrustedPublicKeys(response);
    if (normalized.length > 0) {
      return normalized;
    }
  }

  const keysFromEnv = process.env.BEAV3R_EXECUTION_VERIFICATION_KEYS_JSON?.trim();
  if (!keysFromEnv) {
    return undefined;
  }

  const parsed = JSON.parse(keysFromEnv);
  const normalized = normalizeTrustedPublicKeys(parsed);
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeTrustedPublicKeys(input) {
  if (!input) {
    return {};
  }

  if (!Array.isArray(input) && typeof input === "object") {
    const directMap = {};
    for (const [key, value] of Object.entries(input)) {
      if (typeof value === "string" && value.trim().length > 0) {
        directMap[key] = value.trim();
      }
    }
    if (Object.keys(directMap).length > 0) {
      return directMap;
    }
  }

  const rawItems = Array.isArray(input)
    ? input
    : Array.isArray(input?.keys)
      ? input.keys
      : Array.isArray(input?.items)
        ? input.items
        : [];

  const normalized = {};
  for (const key of rawItems) {
    const keyId =
      (typeof key?.keyId === "string" && key.keyId.trim()) ||
      (typeof key?.kid === "string" && key.kid.trim());
    const publicKey =
      (typeof key?.publicKey === "string" && key.publicKey.trim()) ||
      (typeof key?.publicKeyBase64 === "string" && key.publicKeyBase64.trim());
    if (keyId && publicKey) {
      normalized[keyId] = publicKey;
    }
  }
  return normalized;
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

  // Replace with real executor integration (wallet signer / payment rail).
}

function toActionRequest(action) {
  return {
    actionId: action.actionId,
    agentId: action.agentId,
    actionType: action.actionType,
    payload: action.payload,
    attributes: action.attributes ?? {},
    timestamp: action.timestamp,
    nonce: action.nonce,
    expiry: action.expiry,
  };
}

main().catch((error) => {
  if (error instanceof ExecutorAuthError) {
    console.error(`Execution authorization failed (${error.code}): ${error.message}`);
    process.exit(2);
  }

  console.error("Demo failed.");
  console.error(error);
  process.exit(1);
});
