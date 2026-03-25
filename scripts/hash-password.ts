import bcrypt from "bcryptjs";

const password = process.argv[2];
if (!password) {
  console.error("Usage: npm run hash-password <your-password>");
  process.exit(1);
}

const hash = bcrypt.hashSync(password, 10);
console.log(`\nPassword: ${password}`);
console.log(`Hash:     ${hash}`);
console.log(`\nAdd this to your .env:`);
console.log(`APP_PASSWORD_HASH="${hash}"`);
