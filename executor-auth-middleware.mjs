import * as beav3rSdk from "@beav3r/sdk";
import { hashAction } from "@beav3r/protocol";

const sdkVerifyExecutionAuthorization = beav3rSdk.verifyExecutionAuthorization;

export class ExecutorAuthError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ExecutorAuthError";
    this.code = code;
  }
}

export class InMemoryReplayStore {
  constructor() {
    this.seen = new Map();
  }

  consumeOnce(artifactKey, expSeconds) {
    const nowSeconds = Math.floor(Date.now() / 1000);
    this.prune(nowSeconds);
    if (this.seen.has(artifactKey)) {
      return false;
    }
    this.seen.set(artifactKey, expSeconds);
    return true;
  }

  prune(nowSeconds = Math.floor(Date.now() / 1000)) {
    for (const [artifactKey, expiry] of this.seen.entries()) {
      if (expiry <= nowSeconds) {
        this.seen.delete(artifactKey);
      }
    }
  }
}

export function createExecutorAuthMiddleware({
  audience,
  verifyExecutionAuthorization = sdkVerifyExecutionAuthorization,
  trustedPublicKeys,
  replayStore = new InMemoryReplayStore(),
  clockSkewSeconds = 5,
}) {
  if (!audience || typeof audience !== "string") {
    throw new Error("createExecutorAuthMiddleware requires a non-empty audience.");
  }
  if (!replayStore || typeof replayStore.consumeOnce !== "function") {
    throw new Error(
      "createExecutorAuthMiddleware requires a replay store with consumeOnce(key, exp).",
    );
  }
  const normalizedPublicKeys = normalizeTrustedPublicKeys(trustedPublicKeys);
  if (!normalizedPublicKeys || Object.keys(normalizedPublicKeys).length === 0) {
    throw new Error(
      "createExecutorAuthMiddleware requires trustedPublicKeys (keyId/publicKey base64 map).",
    );
  }

  return async function authorizeExecution({
    executionAuthorizationArtifact,
    artifact,
    actionRequest,
  }) {
    const resolvedArtifact = executionAuthorizationArtifact ?? artifact;
    if (!resolvedArtifact) {
      throw new ExecutorAuthError(
        "artifact_missing",
        "Execution authorization artifact is required.",
      );
    }
    if (typeof resolvedArtifact !== "object" || Array.isArray(resolvedArtifact)) {
      throw new ExecutorAuthError(
        "artifact_invalid",
        "Execution authorization artifact must be a structured object.",
      );
    }
    if (!actionRequest || typeof actionRequest !== "object") {
      throw new ExecutorAuthError(
        "action_request_missing",
        "Exact action request is required to authorize execution.",
      );
    }

    const verification = await verifyStructuredExecutionAuthorization({
      executionAuthorizationArtifact: resolvedArtifact,
      actionRequest,
      audience,
      trustedPublicKeys: normalizedPublicKeys,
      verifyExecutionAuthorization,
      clockSkewSeconds,
    });

    const recomputedActionHash = hashAction(actionRequest);
    if (verification.actionHash !== recomputedActionHash) {
      throw new ExecutorAuthError(
        "hash_mismatch",
        "Artifact actionHash does not match recomputed hash from the exact action request.",
      );
    }

    if (!replayStore.consumeOnce(verification.replayKey, verification.expirySeconds)) {
      throw new ExecutorAuthError(
        "replay_detected",
        "Execution authorization artifact replay detected.",
      );
    }

    return {
      actionHash: recomputedActionHash,
      artifactId: verification.artifactId,
      jti: verification.jti,
      replayKey: verification.replayKey,
      expirySeconds: verification.expirySeconds,
      verification: verification.rawResult,
    };
  };
}

async function verifyStructuredExecutionAuthorization({
  executionAuthorizationArtifact,
  actionRequest,
  audience,
  trustedPublicKeys,
  verifyExecutionAuthorization,
  clockSkewSeconds,
}) {
  if (typeof verifyExecutionAuthorization !== "function") {
    throw new ExecutorAuthError(
      "artifact_invalid",
      "SDK verifyExecutionAuthorization helper is required for structured artifact verification.",
    );
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  let payload;
  try {
    payload = await verifyExecutionAuthorization({
      artifact: executionAuthorizationArtifact,
      action: actionRequest,
      audience,
      publicKeys: trustedPublicKeys,
      now: nowSeconds,
    });
  } catch (error) {
    throw new ExecutorAuthError(
      "artifact_invalid",
      `verifyExecutionAuthorization failed: ${error?.message ?? String(error)}`,
    );
  }
  const claimsSource = coalesceObject(payload);
  const artifactId = firstNonEmptyString(claimsSource?.artifactId);
  const jti = firstNonEmptyString(claimsSource?.jti);
  const replayKey = artifactId ?? jti;
  if (!replayKey) {
    throw new ExecutorAuthError(
      "artifact_invalid",
      "Execution authorization artifact is missing artifactId/jti for replay prevention.",
    );
  }

  const actionHash = firstNonEmptyString(claimsSource?.actionHash);
  if (!actionHash) {
    throw new ExecutorAuthError(
      "artifact_invalid",
      "Execution authorization artifact is missing actionHash.",
    );
  }

  const claimAudience = claimsSource?.audience;
  if (!audienceMatches(claimAudience, audience)) {
    throw new ExecutorAuthError(
      "artifact_invalid",
      `Execution authorization artifact audience does not include ${audience}.`,
    );
  }

  const expirySeconds = parseEpochSeconds(
    claimsSource?.expiresAt ?? claimsSource?.exp,
  );
  if (!Number.isFinite(expirySeconds)) {
    throw new ExecutorAuthError(
      "artifact_invalid",
      "Execution authorization artifact is missing expiry.",
    );
  }
  if (expirySeconds <= nowSeconds - clockSkewSeconds) {
    throw new ExecutorAuthError(
      "artifact_expired",
      "Execution authorization artifact is expired.",
    );
  }

  const nbfSeconds = parseEpochSeconds(
    claimsSource?.nbf,
  );
  if (Number.isFinite(nbfSeconds) && nbfSeconds > nowSeconds + clockSkewSeconds) {
    throw new ExecutorAuthError(
      "artifact_invalid",
      "Execution authorization artifact is not valid yet.",
    );
  }

  return {
    artifactId,
    jti,
    replayKey,
    actionHash,
    expirySeconds,
    rawResult: payload,
  };
}

function coalesceObject(...values) {
  for (const value of values) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value;
    }
  }
  return {};
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

function audienceMatches(value, expectedAudience) {
  if (typeof value === "string") {
    return value === expectedAudience;
  }
  if (Array.isArray(value)) {
    return value.includes(expectedAudience);
  }
  return false;
}

function parseEpochSeconds(value) {
  if (value === undefined || value === null) {
    return Number.NaN;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1_000_000_000_000 ? Math.floor(value / 1000) : Math.floor(value);
  }
  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric > 1_000_000_000_000
        ? Math.floor(numeric / 1000)
        : Math.floor(numeric);
    }
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return Math.floor(parsed / 1000);
    }
  }
  if (value instanceof Date) {
    return Math.floor(value.getTime() / 1000);
  }
  return Number.NaN;
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

  const items = Array.isArray(input)
    ? input
    : Array.isArray(input?.keys)
      ? input.keys
      : Array.isArray(input?.items)
        ? input.items
        : [];

  const normalized = {};
  for (const item of items) {
    const keyId = firstNonEmptyString(item?.keyId, item?.kid);
    const publicKey = firstNonEmptyString(item?.publicKey, item?.publicKeyBase64);
    if (!keyId || !publicKey) {
      continue;
    }
    normalized[keyId] = publicKey;
  }

  return normalized;
}
