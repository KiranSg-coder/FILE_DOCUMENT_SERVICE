"use strict";
const crypto = require("crypto");

/**
 * Authentication for the File & Document service (production review S11).
 *
 * - User requests must carry the gateway-issued bearer token (HS256, JWT_SECRET).
 *   The user id comes only from the verified token.
 * - Internal service calls may instead present x-service-key (INTERNAL_SERVICE_KEY).
 * - Anything else is rejected (401). Implemented with Node's crypto module so the service
 *   needs no extra dependency; only HS256 is accepted, signature and expiry are checked.
 */
function base64UrlDecode(input) {
  const normalized = String(input).replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, "base64");
}

function safeEqual(a, b) {
  const left = Buffer.isBuffer(a) ? a : Buffer.from(String(a));
  const right = Buffer.isBuffer(b) ? b : Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

/** Verify an HS256 JWT. Returns the payload or null. */
function verifyHs256(token, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!token || !secret) return null;
  const parts = String(token).split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, signatureB64] = parts;
  let header;
  let payload;
  try {
    header = JSON.parse(base64UrlDecode(headerB64).toString("utf8"));
    payload = JSON.parse(base64UrlDecode(payloadB64).toString("utf8"));
  } catch {
    return null;
  }
  if (!header || header.alg !== "HS256") return null;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest();
  if (!safeEqual(base64UrlDecode(signatureB64), expected)) return null;
  if (typeof payload.exp === "number" && payload.exp <= nowSeconds) return null;
  if (typeof payload.nbf === "number" && payload.nbf > nowSeconds) return null;
  return payload;
}

// A7: shared dual-key helper (current or, during rotation, previous key).
const { hasValidServiceKey } = require("../lib/serviceKey");

function toUserId(value) {
  const n = parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function authenticateUser(req, res, next) {
  if (hasValidServiceKey(req)) {
    req.isInternal = true;
    req.userId = toUserId(req.headers["x-user-id"]);
    return next();
  }

  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  const payload = verifyHs256(token, process.env.JWT_SECRET);
  const userId = payload ? toUserId(payload.userId ?? payload.userid ?? payload.sub) : null;

  if (!userId) {
    return res.status(401).json({ success: false, message: "Authentication required" });
  }

  req.isInternal = false;
  req.userId = userId;
  return next();
}

/** True when the authenticated caller may access a file record. */
function canAccessFile(req, fileRow) {
  if (req.isInternal) return true;
  if (!fileRow || req.userId == null) return false;
  return String(fileRow.UPLOADEDBY ?? "") === String(req.userId);
}

module.exports = { authenticateUser, canAccessFile, verifyHs256 };
