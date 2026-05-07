import "dotenv/config";
import { Beav3r } from "@beav3r/sdk";
import { privateKeyToAccount } from "viem/accounts";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  getAddress,
  http,
  keccak256,
  parseUnits,
  stringToHex,
} from "viem";

const REQUIRED = [
  "BEAV3R_API_KEY",
  "BEAV3R_PROJECT_ID",
  "BEAV3R_BASE_URL",
  "BEAV3R_AGENT_ID",
  "BEAV3R_DEFAULT_EXPIRY_SECONDS",
  "ONCHAIN_RPC_URL",
  "ONCHAIN_CHAIN_ID",
  "ONCHAIN_PRIVATE_KEY",
  "ONCHAIN_ACTOR_ACCOUNT",
  "ONCHAIN_EXECUTOR_ADDRESS",
  "ONCHAIN_TOKEN_ADDRESS",
  "ONCHAIN_RECIPIENT",
  "ONCHAIN_AMOUNT",
  "ONCHAIN_TOKEN_DECIMALS",
  "ONCHAIN_REASON",
  "ONCHAIN_GAS_LIMIT",
  "ONCHAIN_KEEPER_ADDRESS",
];

const missing = REQUIRED.filter((k) => !(process.env[k] ?? "").trim());
if (missing.length) {
  console.error(`Missing required env vars: ${missing.join(", ")}`);
  process.exit(1);
}

const baseUrl = process.env.BEAV3R_BASE_URL.trim();
const pollIntervalMs = Number.parseInt((process.env.BEAV3R_POLL_INTERVAL_MS || "2000").trim(), 10);
const timeoutMs = Number.parseInt((process.env.BEAV3R_TIMEOUT_MS || "300000").trim(), 10);
const chainId = Number.parseInt(process.env.ONCHAIN_CHAIN_ID, 10);
const rpcUrl = process.env.ONCHAIN_RPC_URL.trim();
const actorAccount = getAddress(process.env.ONCHAIN_ACTOR_ACCOUNT.trim());
const executorAddress = getAddress(process.env.ONCHAIN_EXECUTOR_ADDRESS.trim());
const tokenAddress = getAddress(process.env.ONCHAIN_TOKEN_ADDRESS.trim());
const recipient = getAddress(process.env.ONCHAIN_RECIPIENT.trim());
const amount = process.env.ONCHAIN_AMOUNT.trim();
const decimals = Number.parseInt(process.env.ONCHAIN_TOKEN_DECIMALS, 10);
const keeperAddressRaw = process.env.ONCHAIN_KEEPER_ADDRESS.trim();
const now = Math.floor(Date.now() / 1000);
const nonce = Number.parseInt((process.env.ONCHAIN_NONCE || `${now}`).trim(), 10);
const expiresAt = Number.parseInt((process.env.ONCHAIN_EXPIRES_AT || `${now + 1200}`).trim(), 10);

if (!Number.isInteger(chainId) || chainId <= 0) throw new Error("ONCHAIN_CHAIN_ID must be a positive integer");
if (!Number.isInteger(pollIntervalMs) || pollIntervalMs <= 0) throw new Error("BEAV3R_POLL_INTERVAL_MS must be a positive integer");
if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new Error("BEAV3R_TIMEOUT_MS must be a positive integer");
if (!Number.isInteger(decimals) || decimals < 0) throw new Error("ONCHAIN_TOKEN_DECIMALS must be a non-negative integer");
if (!Number.isInteger(nonce) || nonce < 0) throw new Error("ONCHAIN_NONCE must be a non-negative integer");
if (!Number.isInteger(expiresAt) || expiresAt <= 0) throw new Error("ONCHAIN_EXPIRES_AT must be a positive integer");

if (!keeperAddressRaw) throw new Error("ONCHAIN_KEEPER_ADDRESS is required");

const executorAbi = [
  {
    type: "function",
    name: "executeWithAuth",
    stateMutability: "payable",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
      {
        name: "auth",
        type: "tuple",
        components: [
          { name: "actionHash", type: "bytes32" },
          { name: "account", type: "address" },
          { name: "executor", type: "address" },
          { name: "chainId", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "expiresAt", type: "uint256" },
          { name: "keyId", type: "bytes32" },
        ],
      },
      { name: "signature", type: "bytes" },
    ],
    outputs: [{ name: "", type: "bytes" }],
  },
];

const keeperAbi = [
  {
    type: "function",
    name: "transferToken",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
];

function normalizeKeyId(value) {
  if (typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value.trim())) {
    return value.trim();
  }
  if (typeof value === "string") {
    return keccak256(stringToHex(value.trim()));
  }
  throw new Error("authorization keyId must be a string");
}

function debugDeniedGuardResult(result) {
  const payload = {
    status: result?.status,
    actionId: result?.actionId,
    reason: result?.reason ?? result?.denialReason ?? null,
    error: result?.error ?? null,
    evaluation: result?.evaluation ?? result?.lastEvaluation ?? null,
    approval: result?.approval ?? null,
    raw: result ?? null,
  };
  console.error("Guard request denied or not approved:");
  console.error(JSON.stringify(payload, null, 2));
}

async function main() {
  const client = new Beav3r({
    apiKey: process.env.BEAV3R_API_KEY.trim(),
    baseUrl,
    agentId: process.env.BEAV3R_AGENT_ID.trim(),
    defaultExpirySeconds: Number.parseInt(process.env.BEAV3R_DEFAULT_EXPIRY_SECONDS, 10),
  });

  const publicClient = createPublicClient({ transport: http(rpcUrl) });
  const rpcChainId = await publicClient.getChainId();
  if (rpcChainId !== chainId) {
    throw new Error(`RPC chain mismatch: expected ${chainId}, got ${rpcChainId}`);
  }

  const amountBaseUnits = parseUnits(amount, decimals);
  const keeperAddress = getAddress(keeperAddressRaw);
  const authTarget = keeperAddress;
  const authData = encodeFunctionData({
    abi: keeperAbi,
    functionName: "transferToken",
    args: [tokenAddress, recipient, amountBaseUnits],
  });

  const guardResult = await client.guardAndWait(
    {
      actionType: "payments.send_usdt",
      payload: {
        token: tokenAddress,
        to: recipient,
        amount,
        amountBaseUnits: amountBaseUnits.toString(),
        actorAccount,
        executor: executorAddress,
        chainId,
        callTo: authTarget,
        calldata: authData,
        keeperAddress,
        reason: process.env.ONCHAIN_REASON.trim(),
      },
      attributes: {
        source: "sdk_demo",
        mode: "onchain",
        projectId: process.env.BEAV3R_PROJECT_ID.trim(),
      },
    },
    {
      pollIntervalMs,
      timeoutMs,
    }
  );

  if (guardResult.status !== "approved" && guardResult.status !== "executed") {
    debugDeniedGuardResult(guardResult);
    return;
  }

  const authorization = await client.authorizeOnchainAction({
    projectId: process.env.BEAV3R_PROJECT_ID.trim(),
    account: actorAccount,
    to: authTarget,
    value: "0",
    data: authData,
    chainId,
    nonce,
    expiresAt,
    executor: executorAddress,
  });

  const payload = authorization.item.artifact.payload;
  const signature = authorization.item.artifact.signature;
  if (!payload || !signature) throw new Error("Missing authorization payload/signature");

  const executeCalldata = encodeFunctionData({
    abi: executorAbi,
    functionName: "executeWithAuth",
    args: [
      authTarget,
      0n,
      authData,
      {
        actionHash: payload.actionHash,
        account: getAddress(payload.account),
        executor: getAddress(payload.executor),
        chainId: BigInt(payload.chainId),
        nonce: BigInt(payload.nonce),
        expiresAt: BigInt(payload.expiresAt),
        keyId: normalizeKeyId(payload.keyId),
      },
      signature,
    ],
  });

  const account = privateKeyToAccount(process.env.ONCHAIN_PRIVATE_KEY.trim());
  const wallet = createWalletClient({ account, transport: http(rpcUrl) });
  const txHash = await wallet.sendTransaction({
    chain: null,
    to: executorAddress,
    data: executeCalldata,
    value: 0n,
    gas: BigInt(process.env.ONCHAIN_GAS_LIMIT),
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  console.log({
    status: receipt.status,
    actionId: guardResult.actionId,
    authorizationId: authorization.item.authorizationId,
    txHash,
    blockNumber: Number(receipt.blockNumber),
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
