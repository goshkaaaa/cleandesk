import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { store } from "../lib/store.js";
let muted = false;
const output = new Writable({
  write(chunk, encoding, done) {
    if (!muted) process.stdout.write(chunk, encoding);
    done();
  },
});
const prompt = createInterface({
  input: process.stdin,
  output,
  terminal: Boolean(process.stdin.isTTY),
});
try {
  if (!process.argv[2])
    throw new Error(
      "Usage: node --experimental-sqlite scripts/reset-password.mjs account@example.com",
    );
  process.stdout.write("New password (12–200 characters; input hidden): ");
  muted = true;
  const password = await prompt.question("");
  muted = false;
  process.stdout.write("\n");
  const database = store();
  await database.resetPassword(process.argv[2], password);
  database.close();
  console.log(
    "Password changed. Existing sessions for this account were revoked.",
  );
} catch (error) {
  muted = false;
  console.error(error.message);
  process.exitCode = 1;
} finally {
  prompt.close();
}
