"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveReceiverAddressSync, signValidatorTx } = require("../src/keystore_sign");

test("resolveReceiverAddressSync detects live aliases", () => {
  // Public resolve — no auth. Use a known shape; skip if offline.
  const r = resolveReceiverAddressSync("http://127.0.0.1:8080", "GoCuRjtzEPNUzGxGBVTACbWLACt54DCS9mzVHaHasees1U");
  if (!r.ok) {
    console.log("skip resolve (offline)", r.error);
    return;
  }
  // May or may not be alias depending on DB; just ensure schema
  assert.equal(typeof r.is_alias, "boolean");
  assert.ok(r.canonical.startsWith("Go"));
});

test("signValidatorTx refuses Transfer to alias without confirm", () => {
  // Without binary/keystore we only exercise the resolve gate when receiver set.
  // If resolve says is_alias, must refuse before spawn.
  const resolved = resolveReceiverAddressSync(
    "http://127.0.0.1:8080",
    "Go2jBgxtLG9ewwSVB9h3bLV68nmdpAb31KfGVYHfou75vC",
  );
  if (!resolved.ok || !resolved.is_alias) {
    console.log("skip refuse test", resolved);
    return;
  }
  const out = signValidatorTx({
    binaryPath: "/nonexistent/goldogram-core",
    keystorePath: "/tmp/no-keystore.json",
    password: "x",
    address: "GoAU9gAErR1mup4r4pmRrjoPPqMyHFCJVNvoEGajqVvQpv",
    txType: "Transfer",
    amountMicro: 1000,
    feeMicro: 1000,
    nonce: 1,
    receiver: resolved.receiver,
    apiBase: "http://127.0.0.1:8080",
  });
  assert.equal(out.ok, false);
  assert.equal(out.is_alias, true);
  assert.match(String(out.error), /legacy alias/i);
});
