import { DatabaseSync } from "node:sqlite";
import {
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
import { mkdirSync, writeFileSync, readFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { Temporal } from "@js-temporal/polyfill";

const derive = promisify(scrypt);
const digest = (value) => createHash("sha256").update(value).digest("hex");
export class Problem extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export function text(value, name, min = 1, max = 200) {
  if (
    typeof value !== "string" ||
    value.trim().length < min ||
    value.length > max
  )
    throw new Problem(400, `${name}: enter ${min}–${max} characters.`);
  return value.trim();
}
const emailAddress = (value) => {
  const email = text(value, "Email", 3, 180).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new Problem(400, "Enter a valid email address.");
  return email;
};
async function passwordHash(password) {
  if (
    typeof password !== "string" ||
    password.length < 12 ||
    password.length > 200
  )
    throw new Problem(400, "Use a password between 12 and 200 characters.");
  const salt = randomBytes(16).toString("hex");
  const hash = await derive(password, salt, 64);
  return `${salt}:${hash.toString("hex")}`;
}
async function passwordMatches(password, stored) {
  if (typeof password !== "string" || password.length > 200 || !stored)
    return false;
  const [salt, expected] = stored.split(":");
  const actual = await derive(password, salt, 64);
  return timingSafeEqual(actual, Buffer.from(expected, "hex"));
}
export function localStart(value, timeZone) {
  try {
    if (
      typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)
    )
      throw new Error();
    return Number(
      Temporal.PlainDateTime.from(value, {
        overflow: "reject",
      }).toZonedDateTime(timeZone, { disambiguation: "reject" })
        .epochMilliseconds,
    );
  } catch {
    throw new Problem(
      400,
      "The start time is invalid or ambiguous in your workspace time zone. Choose another time.",
    );
  }
}

export function createStore(directory) {
  mkdirSync(directory, { recursive: true });
  const photosDirectory = resolve(directory, "photos");
  mkdirSync(photosDirectory, { recursive: true });
  const db = new DatabaseSync(resolve(directory, "cleandesk.sqlite"));
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS workspace(id INTEGER PRIMARY KEY CHECK(id=1), name TEXT NOT NULL, timezone TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('manager','cleaner')));
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS attempts(key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS invites(token TEXT PRIMARY KEY, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS homes(id TEXT PRIMARY KEY, name TEXT NOT NULL, address TEXT NOT NULL, notes TEXT NOT NULL, checklist TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, home_id TEXT NOT NULL REFERENCES homes(id), cleaner_id TEXT NOT NULL REFERENCES users(id), starts INTEGER NOT NULL, ends INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'scheduled', instruction TEXT NOT NULL, checklist TEXT NOT NULL DEFAULT '[]', report TEXT NOT NULL DEFAULT '', feedback TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS jobs_schedule ON jobs(cleaner_id, starts, ends);
    CREATE TABLE IF NOT EXISTS photos(id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id), file TEXT NOT NULL, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id), actor TEXT NOT NULL REFERENCES users(id), action TEXT NOT NULL, at INTEGER NOT NULL);
  `);
  const one = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  function transaction(action) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = action();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  function manager(user) {
    if (user?.role !== "manager")
      throw new Problem(403, "Manager access required.");
  }
  function publicUser(user) {
    return { id: user.id, name: user.name, email: user.email, role: user.role };
  }
  function sessionFor(user) {
    const token = randomBytes(32).toString("hex");
    run("DELETE FROM sessions WHERE expires < ?", Date.now());
    run(
      "INSERT INTO sessions VALUES(?,?,?)",
      digest(token),
      user.id,
      Date.now() + 30 * 86400000,
    );
    return { user: publicUser(user), token };
  }
  function userFromToken(token) {
    if (typeof token !== "string" || token.length !== 64) return null;
    const user = one(
      "SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token=? AND s.expires>?",
      digest(token),
      Date.now(),
    );
    return user ? publicUser(user) : null;
  }
  function requireUser(token) {
    const user = userFromToken(token);
    if (!user) throw new Problem(401, "Please sign in.");
    return user;
  }
  function jobFor(user, id) {
    const job = one("SELECT * FROM jobs WHERE id=?", id);
    if (!job || (user.role !== "manager" && job.cleaner_id !== user.id))
      throw new Problem(404, "Job not found.");
    return job;
  }
  const audit = (job, user, action) =>
    run(
      "INSERT INTO audit VALUES(?,?,?,?,?)",
      randomUUID(),
      job.id,
      user.id,
      action,
      Date.now(),
    );
  function checkAttempts(email) {
    const record = one("SELECT * FROM attempts WHERE key=?", digest(email));
    if (record && record.expires > Date.now() && record.count >= 5)
      throw new Problem(
        429,
        "Too many login attempts. Try again in 15 minutes.",
      );
    const global = one("SELECT * FROM attempts WHERE key=?", "global");
    if (global && global.expires > Date.now() && global.count >= 50)
      throw new Problem(429, "Too many login attempts. Try again shortly.");
    for (const [key, ttl] of [
      [digest(email), 900000],
      ["global", 60000],
    ]) {
      run(
        "INSERT INTO attempts VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires<? THEN 1 ELSE count+1 END, expires=CASE WHEN expires<? THEN excluded.expires ELSE expires END",
        key,
        Date.now() + ttl,
        Date.now(),
        Date.now(),
      );
    }
  }
  return {
    db,
    workspace: () => one("SELECT * FROM workspace WHERE id=1") || null,
    userFromToken,
    requireUser,
    async setup(value) {
      if (
        (process.env.NODE_ENV === "production" && !process.env.SETUP_TOKEN) ||
        (process.env.SETUP_TOKEN &&
          !timingSafeEqual(
            Buffer.from(digest(String(value.setupToken || "")), "hex"),
            Buffer.from(digest(process.env.SETUP_TOKEN), "hex"),
          ))
      )
        throw new Problem(
          403,
          "Enter the setup key configured by the server administrator.",
        );
      const name = text(value.name, "Your name", 2, 80);
      const company = text(value.company, "Workspace", 2, 100);
      const email = emailAddress(value.email);
      const hash = await passwordHash(value.password);
      const timezone = text(value.timezone, "Time zone");
      try {
        new Intl.DateTimeFormat("en", { timeZone: timezone });
      } catch {
        throw new Problem(400, "Choose a valid IANA time zone.");
      }
      return transaction(() => {
        if (one("SELECT id FROM workspace"))
          throw new Problem(
            409,
            "This workspace is already set up. Sign in or ask the manager for an invitation.",
          );
        run("INSERT INTO workspace VALUES(1,?,?)", company, timezone);
        const user = { id: randomUUID(), name, email, role: "manager" };
        run(
          "INSERT INTO users VALUES(?,?,?,?,?)",
          user.id,
          name,
          email,
          hash,
          user.role,
        );
        return sessionFor(user);
      });
    },
    async login(value) {
      const email = emailAddress(value.email);
      checkAttempts(email);
      const user = one("SELECT * FROM users WHERE email=?", email);
      if (!user || !(await passwordMatches(value.password, user.password)))
        throw new Problem(401, "Email or password is incorrect.");
      run("DELETE FROM attempts WHERE key=?", digest(email));
      return sessionFor(user);
    },
    logout(token) {
      if (token) run("DELETE FROM sessions WHERE token=?", digest(token));
    },
    async resetPassword(email, password) {
      const user = one(
        "SELECT id FROM users WHERE email=?",
        emailAddress(email),
      );
      if (!user) throw new Problem(404, "Account not found.");
      const hash = await passwordHash(password);
      transaction(() => {
        run("UPDATE users SET password=? WHERE id=?", hash, user.id);
        run("DELETE FROM sessions WHERE user_id=?", user.id);
      });
    },
    invite(user) {
      manager(user);
      run("DELETE FROM invites WHERE expires<?", Date.now());
      if (one("SELECT count(*) AS count FROM invites").count >= 50)
        throw new Problem(
          400,
          "There are already 50 active invitations. Wait for them to expire.",
        );
      const token = randomBytes(24).toString("hex");
      run(
        "INSERT INTO invites VALUES(?,?)",
        digest(token),
        Date.now() + 86400000,
      );
      return token;
    },
    async acceptInvite(value) {
      const token = text(value.token, "Invitation token", 48, 48);
      if (
        !one(
          "SELECT token FROM invites WHERE token=? AND expires>?",
          digest(token),
          Date.now(),
        )
      )
        throw new Problem(400, "This invitation is invalid or expired.");
      const name = text(value.name, "Name", 2, 80);
      const email = emailAddress(value.email);
      const hash = await passwordHash(value.password);
      return transaction(() => {
        if (
          !one(
            "SELECT token FROM invites WHERE token=? AND expires>?",
            digest(token),
            Date.now(),
          )
        )
          throw new Problem(400, "This invitation was already used.");
        if (one("SELECT id FROM users WHERE email=?", email))
          throw new Problem(409, "An account already uses this email address.");
        const user = { id: randomUUID(), name, email, role: "cleaner" };
        run(
          "INSERT INTO users VALUES(?,?,?,?,?)",
          user.id,
          name,
          email,
          hash,
          user.role,
        );
        run("DELETE FROM invites WHERE token=?", digest(token));
        return sessionFor(user);
      });
    },
    dashboard(user) {
      const jobs =
        user.role === "manager"
          ? all("SELECT * FROM jobs ORDER BY starts")
          : all(
              "SELECT * FROM jobs WHERE cleaner_id=? ORDER BY starts",
              user.id,
            );
      const ids = new Set(jobs.map((job) => job.home_id));
      const homes = all("SELECT * FROM homes")
        .filter((home) => user.role === "manager" || ids.has(home.id))
        .map((home) => ({ ...home, checklist: JSON.parse(home.checklist) }));
      const workers =
        user.role === "manager"
          ? all("SELECT id,name,email,role FROM users ORDER BY name")
          : [user];
      const visible = new Set(jobs.map((job) => job.id));
      const photos = all("SELECT id,job_id,created FROM photos").filter(
        (photo) => visible.has(photo.job_id),
      );
      const history = all(
        "SELECT a.*,u.name AS actor_name FROM audit a JOIN users u ON u.id=a.actor ORDER BY at",
      ).filter((event) => visible.has(event.job_id));
      return {
        workspace: this.workspace(),
        user,
        homes,
        workers,
        jobs: jobs.map((job) => ({
          ...job,
          checklist: JSON.parse(job.checklist),
          photos: photos.filter((photo) => photo.job_id === job.id),
          history: history.filter((event) => event.job_id === job.id),
        })),
      };
    },
    addHome(user, value) {
      manager(user);
      const name = text(value.name, "Property name", 2, 100);
      const address = text(value.address, "Address", 5, 250);
      const notes = text(value.notes || "", "Access notes", 0, 1000);
      if (
        !Array.isArray(value.checklist) ||
        !value.checklist.length ||
        value.checklist.length > 30
      )
        throw new Problem(400, "Add between 1 and 30 checklist items.");
      const checklist = value.checklist.map((item) =>
        text(item, "Checklist item", 1, 150),
      );
      const id = randomUUID();
      run(
        "INSERT INTO homes VALUES(?,?,?,?,?)",
        id,
        name,
        address,
        notes,
        JSON.stringify(checklist),
      );
      return id;
    },
    addJob(user, value) {
      manager(user);
      const home = one(
        "SELECT * FROM homes WHERE id=?",
        text(value.homeId, "Property"),
      );
      const cleaner = one(
        "SELECT * FROM users WHERE id=?",
        text(value.cleanerId, "Cleaner"),
      );
      if (!home || !cleaner)
        throw new Problem(400, "Choose an existing property and team member.");
      const starts = localStart(value.localStart, this.workspace().timezone);
      if (
        !Number.isInteger(value.minutes) ||
        value.minutes < 15 ||
        value.minutes > 720
      )
        throw new Problem(400, "Duration must be 15–720 whole minutes.");
      const ends = starts + value.minutes * 60000;
      const instruction = text(
        value.instruction || "",
        "Instructions",
        0,
        2000,
      );
      return transaction(() => {
        if (
          one(
            "SELECT id FROM jobs WHERE status!='cancelled' AND starts<? AND ends>? AND (cleaner_id=? OR home_id=?)",
            ends,
            starts,
            cleaner.id,
            home.id,
          )
        )
          throw new Problem(
            409,
            "This property or team member already has a job during that time.",
          );
        const id = randomUUID();
        const checklist = JSON.parse(home.checklist).map((label) => ({
          label,
          done: false,
        }));
        run(
          "INSERT INTO jobs(id,home_id,cleaner_id,starts,ends,instruction,checklist,created) VALUES(?,?,?,?,?,?,?,?)",
          id,
          home.id,
          cleaner.id,
          starts,
          ends,
          instruction,
          JSON.stringify(checklist),
          Date.now(),
        );
        audit({ id }, user, "scheduled");
        return id;
      });
    },
    updateJob(user, id, value) {
      return transaction(() => {
        const job = jobFor(user, id);
        const action = value.action;
        if (action === "start" && job.status === "scheduled")
          run("UPDATE jobs SET status='in_progress' WHERE id=?", id);
        else if (action === "save" || action === "submit") {
          if (job.status !== "in_progress")
            throw new Problem(
              409,
              "Start the job before editing its report. Submitted reports are locked.",
            );
          const original = JSON.parse(job.checklist);
          if (
            !Array.isArray(value.checklist) ||
            value.checklist.length !== original.length ||
            value.checklist.some((item) => typeof item !== "boolean")
          )
            throw new Problem(400, "Checklist does not match this job.");
          const checklist = original.map((item, index) => ({
            label: item.label,
            done: value.checklist[index],
          }));
          const report = text(value.report || "", "Report", 0, 5000);
          if (action === "submit" && checklist.some((item) => !item.done))
            throw new Problem(
              400,
              "Finish every checklist item before submitting.",
            );
          if (
            action === "submit" &&
            !one("SELECT id FROM photos WHERE job_id=?", id)
          )
            throw new Problem(
              400,
              "Add at least one completion photo before submitting.",
            );
          run(
            "UPDATE jobs SET checklist=?,report=?,status=? WHERE id=?",
            JSON.stringify(checklist),
            report,
            action === "submit" ? "submitted" : "in_progress",
            id,
          );
        } else if (action === "approve" && job.status === "submitted") {
          manager(user);
          run("UPDATE jobs SET status='completed' WHERE id=?", id);
        } else if (action === "reopen" && job.status === "submitted") {
          manager(user);
          run(
            "UPDATE jobs SET status='in_progress',feedback=? WHERE id=?",
            text(value.feedback, "Feedback", 2, 1000),
            id,
          );
        } else if (
          action === "cancel" &&
          ["scheduled", "in_progress"].includes(job.status)
        ) {
          manager(user);
          run("UPDATE jobs SET status='cancelled' WHERE id=?", id);
        } else
          throw new Problem(
            409,
            "That action is not available for the current job status.",
          );
        if (action !== "save") audit(job, user, action);
      });
    },
    authorizeUpload(user, id) {
      const job = jobFor(user, id);
      if (job.status !== "in_progress")
        throw new Problem(
          409,
          "Photos can be added only while the job is in progress.",
        );
    },
    addPhoto(user, id, bytes) {
      const job = jobFor(user, id);
      if (job.status !== "in_progress")
        throw new Problem(
          409,
          "Photos can be added only while the job is in progress.",
        );
      if (
        one("SELECT count(*) AS count FROM photos WHERE job_id=?", id).count >=
        12
      )
        throw new Problem(400, "A report can contain up to 12 photos.");
      const photoId = randomUUID();
      const filename = `${photoId}.webp`;
      const path = resolve(photosDirectory, filename);
      writeFileSync(path, bytes, { flag: "wx", mode: 0o600 });
      try {
        run(
          "INSERT INTO photos VALUES(?,?,?,?)",
          photoId,
          id,
          filename,
          Date.now(),
        );
      } catch (error) {
        unlinkSync(path);
        throw error;
      }
      return photoId;
    },
    readPhoto(user, id) {
      const photo = one("SELECT * FROM photos WHERE id=?", id);
      if (!photo) throw new Problem(404, "Photo not found.");
      jobFor(user, photo.job_id);
      return readFileSync(resolve(photosDirectory, photo.file));
    },
    removePhoto(user, id) {
      const photo = one("SELECT * FROM photos WHERE id=?", id);
      if (!photo) throw new Problem(404, "Photo not found.");
      const job = jobFor(user, photo.job_id);
      if (job.status !== "in_progress")
        throw new Problem(409, "Submitted photos are locked.");
      unlinkSync(resolve(photosDirectory, photo.file));
      run("DELETE FROM photos WHERE id=?", id);
    },
    close() {
      db.close();
    },
  };
}

const key = Symbol.for("cleandesk.store");
export function store() {
  return (globalThis[key] ||= createStore(
    process.env.DATA_DIR || resolve("data"),
  ));
}
