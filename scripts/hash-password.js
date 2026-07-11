const { hashPassword } = require("../src/services/auth.service");
const password = process.argv[2];
if (!password || password.length < 12) {
  console.error('Kullanim: pnpm hash-password "en-az-12-karakter-parola"');
  process.exit(1);
}
console.log(hashPassword(password));
