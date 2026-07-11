const test = require("node:test");
const assert = require("node:assert/strict");
const {
  AuthService,
  hashPassword,
  verifyPassword,
} = require("../../src/services/auth.service");
test("scrypt parola dogrulama", () => {
  const hash = hashPassword("cok-guvenli-parola");
  assert.equal(verifyPassword("cok-guvenli-parola", hash), true);
  assert.equal(verifyPassword("yanlis", hash), false);
});
test("imzali oturum tokeni degistirilemez", () => {
  const auth = new AuthService({
    username: "admin",
    passwordHash: hashPassword("pass123456789"),
    secret: "x".repeat(32),
    ttlSeconds: 60,
  });
  const login = auth.login("admin", "pass123456789");
  assert.ok(auth.verify(login.token));
  assert.equal(auth.verify(login.token + "x"), null);
});
