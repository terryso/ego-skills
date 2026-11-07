// Delivery receipts and plan signatures. A boolean on an analysis file is not a receipt.

import crypto from "node:crypto";
import {
  WorkflowError,
  sha256Text,
  stableStringify,
} from "../../../x-bookmark-export/scripts/lib/pure.mjs";

export const RECEIPT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const PLAN_TTL_MS = 24 * 60 * 60 * 1000;

export function signPayload(keyHex, payload) {
  if (typeof keyHex !== "string" || !/^[0-9a-f]{64}$/.test(keyHex)) {
    throw new WorkflowError("invalid_key", "account mac key is missing");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new WorkflowError("invalid_schema", "payload must be an object");
  }
  if (Object.prototype.hasOwnProperty.call(payload, "mac")) {
    throw new WorkflowError("invalid_schema", "payload must not already include mac");
  }
  const mac = crypto.createHmac("sha256", Buffer.from(keyHex, "hex"))
    .update(stableStringify(payload))
    .digest("hex");
  return { ...payload, mac };
}

export function verifyPayload(keyHex, signed) {
  if (typeof keyHex !== "string" || !/^[0-9a-f]{64}$/.test(keyHex)) return false;
  if (!signed || typeof signed !== "object" || typeof signed.mac !== "string") return false;
  const rest = { ...signed };
  delete rest.mac;
  const expected = crypto.createHmac("sha256", Buffer.from(keyHex, "hex"))
    .update(stableStringify(rest))
    .digest("hex");
  const left = Buffer.from(signed.mac, "hex");
  const right = Buffer.from(expected, "hex");
  if (left.length === 0 || left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

export function issueReceipt({ keyHex, accountId, recommendationId, postIds, body, nowMs }) {
  const deliveredSha = sha256Text(body);
  const receiptId = sha256Text(`${accountId}\n${recommendationId}\n${deliveredSha}`).slice(0, 24);
  return signPayload(keyHex, {
    schema: "x-bookmark-delivery-receipt/1",
    receipt_id: receiptId,
    account_id: accountId,
    recommendation_id: recommendationId,
    post_ids: [...postIds].sort(),
    delivered_sha256: deliveredSha,
    issued_at: new Date(nowMs).toISOString(),
    expires_at: new Date(nowMs + RECEIPT_TTL_MS).toISOString(),
  });
}

export function receiptProblem(keyHex, receipt, { accountId, nowMs, body, postId, recommendationId }) {
  if (!receipt || typeof receipt !== "object") return "receipt_forged";
  if (!verifyPayload(keyHex, receipt)) return "receipt_forged";
  if (receipt.schema !== "x-bookmark-delivery-receipt/1") return "receipt_forged";
  if (receipt.account_id !== accountId) return "account_mismatch";
  if (!(Date.parse(receipt.expires_at) > nowMs)) return "receipt_expired";
  if (typeof body !== "string" || sha256Text(body) !== receipt.delivered_sha256) return "receipt_body_mismatch";
  if (recommendationId && receipt.recommendation_id !== recommendationId) return "receipt_mismatch";
  if (postId && (!Array.isArray(receipt.post_ids) || !receipt.post_ids.includes(postId))) {
    return "receipt_mismatch";
  }
  return null;
}
