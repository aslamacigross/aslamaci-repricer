const crypto = require("crypto");
const { env } = require("../config/env");

function encode(value) { return Buffer.from(value).toString("base64url"); }

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(":")) {
    const left = Buffer.from(String(password));
    const right = Buffer.from(String(stored || ""));
    return left.length === right.length && crypto.timingSafeEqual(left, right);
  }
  const [salt, hash] = stored.split(":");
  const actual = Buffer.from(crypto.scryptSync(password, salt, 64).toString("hex"));
  const expected = Buffer.from(hash);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

class AuthService {
  constructor(options = {}) {
    this.username = options.username || env.adminUsername;
    this.passwordHash = options.passwordHash || env.adminPasswordHash || env.adminPassword;
    this.secret = options.secret || env.sessionSecret;
    this.ttlSeconds = options.ttlSeconds || 12 * 60 * 60;
  }

  login(username, password) {
    if (username !== this.username || !verifyPassword(password, this.passwordHash)) return null;
    const csrf = crypto.randomBytes(24).toString("base64url");
    const payload = encode(JSON.stringify({ sub: username, exp: Math.floor(Date.now()/1000)+this.ttlSeconds, csrf }));
    const signature = crypto.createHmac("sha256", this.secret).update(payload).digest("base64url");
    return { token: `${payload}.${signature}`, csrf, user: { username } };
  }

  verify(token) {
    try {
      const [payload, signature] = String(token || "").split(".");
      if (!payload || !signature) return null;
      const expected = crypto.createHmac("sha256", this.secret).update(payload).digest("base64url");
      const a=Buffer.from(signature); const b=Buffer.from(expected);
      if (a.length!==b.length || !crypto.timingSafeEqual(a,b)) return null;
      const data=JSON.parse(Buffer.from(payload,"base64url").toString("utf8"));
      if (data.exp < Math.floor(Date.now()/1000)) return null;
      return data;
    } catch { return null; }
  }
}

module.exports={AuthService,hashPassword,verifyPassword};
