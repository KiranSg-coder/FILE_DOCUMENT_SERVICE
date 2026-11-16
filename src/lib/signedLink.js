"use strict";
/**
 * P0-R5 / B13 — signed, expiring file links.
 *
 * A file owner asks for a link (authenticated); the link works WITHOUT a token until it
 * expires, so it can be used in <img src>, a new tab or a download. It names one file and
 * one expiry, signed with HMAC-SHA256 using FILE_LINK_SECRET (its own secret — not the JWT
 * or service key). Fails closed when the secret is missing. Secret values are never logged.
 */
const crypto = require("crypto");

const DEFAULT_TTL_SECONDS = 300;
const MAX_TTL_SECONDS = 900;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function secret() {
  const s = process.env.FILE_LINK_SECRET;
  return s && String(s).length >= 32 ? String(s) : null;
}

function isConfigured() {
  return Boolean(secret());
}

function signature(fileUuid, exp, key) {
  return crypto.createHmac("sha256", key).update(`v1.${String(fileUuid).toLowerCase()}.${exp}`).digest("base64url");
}

/** @returns {{ exp: number, sig: string, expiresAt: string } | null} */
function sign(fileUuid, ttlSeconds = DEFAULT_TTL_SECONDS, nowMs = Date.now()) {
  const key = secret();
  if (!key || !UUID_RE.test(String(fileUuid))) return null;
  const ttl = Math.min(MAX_TTL_SECONDS, Math.max(30, Math.floor(Number(ttlSeconds) || DEFAULT_TTL_SECONDS)));
  const exp = Math.floor(nowMs / 1000) + ttl;
  return { exp, sig: signature(fileUuid, exp, key), expiresAt: new Date(exp * 1000).toISOString() };
}

/** @returns {{ ok: true, remainingSeconds: number } | { ok: false, reason: string }} */
function verify(fileUuid, exp, sig, nowMs = Date.now()) {
  const key = secret();
  if (!key) return { ok: false, reason: "NOT_CONFIGURED" };
  if (!UUID_RE.test(String(fileUuid || ""))) return { ok: false, reason: "BAD_LINK" };
  const e = Number(exp);
  if (!Number.isInteger(e) || typeof sig !== "string" || !sig) return { ok: false, reason: "BAD_LINK" };
  const now = Math.floor(nowMs / 1000);
  if (e <= now) return { ok: false, reason: "EXPIRED" };
  if (e - now > MAX_TTL_SECONDS + 5) return { ok: false, reason: "BAD_LINK" }; // never longer than the max
  const expected = Buffer.from(signature(fileUuid, e, key));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return { ok: false, reason: "BAD_LINK" };
  return { ok: true, remainingSeconds: e - now };
}

module.exports = { sign, verify, isConfigured, DEFAULT_TTL_SECONDS, MAX_TTL_SECONDS };
