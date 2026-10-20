import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore, localStart } from "../lib/store.js";
import { checkOrigin, limitedBody } from "../lib/http.js";

test("time zones reject missing and ambiguous daylight-saving times", () => {
  assert.equal(
    localStart("2026-01-20T10:00", "Europe/Berlin"),
    Date.parse("2026-01-20T09:00:00Z"),
  );
  assert.throws(
    () => localStart("2026-03-29T02:30", "Europe/Berlin"),
    /invalid or ambiguous/,
  );
  assert.throws(
    () => localStart("2026-10-25T02:30", "Europe/Berlin"),
    /invalid or ambiguous/,
  );
});
test("body limits and origin checks run before mutations", async () => {
  assert.throws(
    () =>
      checkOrigin(
        new Request("http://localhost/api/jobs", {
          headers: { origin: "https://evil.example" },
        }),
      ),
    /not allowed/,
  );
  checkOrigin(
    new Request("http://localhost/api/jobs", {
      headers: { origin: "http://localhost" },
    }),
  );
  await assert.rejects(
    () =>
      limitedBody(
        new Request("http://localhost/api", {
          method: "POST",
          body: "x".repeat(20),
        }),
        10,
      ),
    /too large/,
  );
});
test("complete workspace lifecycle preserves roles, assignments, reports, and sessions", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "cleandesk-unit-"));
  const db = createStore(directory);
  t.after(() => db.close());
  assert.equal(db.workspace(), null);
  const manager = await db.setup({
    name: "Manager",
    email: "manager@example.test",
    password: "A_test_password_2040!",
    company: "Test team",
    timezone: "Europe/Berlin",
  });
  await t.test("setup is available only once", async () => {
    await assert.rejects(
      () =>
        db.setup({
          name: "Other",
          email: "other@example.test",
          password: "A_test_password_2040!",
          company: "Other",
          timezone: "Europe/Berlin",
        }),
      /already set up/,
    );
  });
  await t.test(
    "passwords and session tokens are never stored in plaintext",
    () => {
      assert.notEqual(
        db.db.prepare("SELECT password FROM users").get().password,
        "A_test_password_2040!",
      );
      assert.notEqual(
        db.db.prepare("SELECT token FROM sessions").get().token,
        manager.token,
      );
    },
  );
  const invitation = db.invite(manager.user);
  const worker = await db.acceptInvite({
    token: invitation,
    name: "Cleaner",
    email: "cleaner@example.test",
    password: "Another_test_password!",
  });
  await t.test(
    "invitations work only once and cannot create managers",
    async () => {
      assert.equal(worker.user.role, "cleaner");
      await assert.rejects(
        () =>
          db.acceptInvite({
            token: invitation,
            name: "Intruder",
            email: "bad@example.test",
            password: "Another_test_password!",
          }),
        /invalid or expired/,
      );
      assert.throws(() => db.invite(worker.user), /Manager/);
    },
  );
  const second = await db.acceptInvite({
    token: db.invite(manager.user),
    name: "Second cleaner",
    email: "second@example.test",
    password: "Another_test_password!",
  });
  const homeId = db.addHome(manager.user, {
    name: "Flat 12",
    address: "Example Street 12, Berlin",
    notes: "Collect the key",
    checklist: ["Kitchen", "Bathroom"],
  });
  assert.throws(
    () =>
      db.addHome(worker.user, {
        name: "No",
        address: "No home",
        checklist: ["X"],
      }),
    /Manager/,
  );
  const id = db.addJob(manager.user, {
    homeId,
    cleanerId: worker.user.id,
    localStart: "2026-11-10T09:00",
    minutes: 120,
    instruction: "Check the windows",
  });
  await t.test("overlapping staff and property bookings are rejected", () => {
    assert.throws(
      () =>
        db.addJob(manager.user, {
          homeId,
          cleanerId: second.user.id,
          localStart: "2026-11-10T10:00",
          minutes: 60,
        }),
      /already has a job/,
    );
  });
  await t.test("cleaners cannot see unassigned jobs or properties", () => {
    assert.equal(db.dashboard(second.user).jobs.length, 0);
    assert.equal(db.dashboard(second.user).homes.length, 0);
    assert.throws(
      () => db.updateJob(second.user, id, { action: "start" }),
      /not found/,
    );
  });
  db.updateJob(worker.user, id, { action: "start" });
  assert.throws(
    () =>
      db.updateJob(worker.user, id, {
        action: "submit",
        checklist: [true, false],
        report: "Done",
      }),
    /Finish every/,
  );
  assert.throws(
    () =>
      db.updateJob(worker.user, id, {
        action: "submit",
        checklist: [true, true],
        report: "Done",
      }),
    /photo/,
  );
  const photoId = db.addPhoto(worker.user, id, Buffer.from("unit-test-photo"));
  await t.test("photo reads use the same assignment boundary", () => {
    assert.equal(
      db.readPhoto(manager.user, photoId).toString(),
      "unit-test-photo",
    );
    assert.throws(() => db.readPhoto(second.user, photoId), /not found/);
  });
  db.updateJob(worker.user, id, {
    action: "submit",
    checklist: [true, true],
    report: "Ready for review",
  });
  await t.test("submitted reports and photos are immutable to cleaners", () => {
    assert.throws(
      () =>
        db.updateJob(worker.user, id, {
          action: "save",
          checklist: [true, true],
          report: "changed",
        }),
      /locked/,
    );
    assert.throws(() => db.removePhoto(worker.user, photoId), /locked/);
    assert.throws(
      () => db.updateJob(worker.user, id, { action: "approve" }),
      /Manager/,
    );
  });
  db.updateJob(manager.user, id, {
    action: "reopen",
    feedback: "Please wipe the mirror",
  });
  db.updateJob(worker.user, id, {
    action: "submit",
    checklist: [true, true],
    report: "Mirror cleaned",
  });
  db.updateJob(manager.user, id, { action: "approve" });
  await t.test("approved reports retain a timestamped actor history", () => {
    const job = db.dashboard(manager.user).jobs[0];
    assert.equal(job.status, "completed");
    assert.equal(job.report, "Mirror cleaned");
    assert.equal(job.history.at(-1).action, "approve");
  });
  await t.test("login, logout, and persistent storage are real", async () => {
    const session = await db.login({
      email: "CLEANER@example.test",
      password: "Another_test_password!",
    });
    assert.equal(db.userFromToken(session.token).id, worker.user.id);
    db.logout(session.token);
    assert.equal(db.userFromToken(session.token), null);
    const reopened = createStore(directory);
    assert.equal(reopened.dashboard(manager.user).jobs[0].status, "completed");
    reopened.close();
  });
  await t.test("login attempts are rate limited", async () => {
    for (let i = 0; i < 5; i++)
      await assert.rejects(
        () => db.login({ email: "missing@example.test", password: "bad" }),
        /incorrect/,
      );
    await assert.rejects(
      () => db.login({ email: "missing@example.test", password: "bad" }),
      /Too many/,
    );
  });
  await t.test(
    "local password recovery revokes existing sessions",
    async () => {
      const session = await db.login({
        email: worker.user.email,
        password: "Another_test_password!",
      });
      await db.resetPassword(worker.user.email, "A_recovered_password_2040!");
      assert.equal(db.userFromToken(session.token), null);
      await assert.rejects(
        () =>
          db.login({
            email: worker.user.email,
            password: "Another_test_password!",
          }),
        /incorrect/,
      );
      const recovered = await db.login({
        email: worker.user.email,
        password: "A_recovered_password_2040!",
      });
      assert.equal(recovered.user.id, worker.user.id);
    },
  );
});
