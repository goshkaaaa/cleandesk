"use client";
import { useEffect, useState } from "react";
import Auth from "../components/Auth";
import Calendar from "../components/Calendar";
import Report from "../components/Report";
import { api, dayInZone, statusNames } from "../lib/client";

export default function Home() {
  const [session, setSession] = useState(null);
  const [data, setData] = useState(null);
  const [invite, setInvite] = useState("");
  const [inviteLink, setInviteLink] = useState("");
  const [view, setView] = useState("schedule");
  const [date, setDate] = useState("");
  const [month, setMonth] = useState("");
  const [selected, setSelected] = useState(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh(id) {
    const value = await api("session");
    setSession(value);
    if (value.user) {
      const dashboard = await api("dashboard");
      setData(dashboard);
      setDate(
        (current) =>
          current || dayInZone(Date.now(), dashboard.workspace.timezone),
      );
      setMonth(
        (current) =>
          current ||
          dayInZone(Date.now(), dashboard.workspace.timezone).slice(0, 7),
      );
      if (id) setSelected(id);
    } else setData(null);
  }
  useEffect(() => {
    setInvite(new URLSearchParams(window.location.search).get("invite") || "");
    refresh().catch((error) => setMessage(error.message));
  }, []);

  async function create(event, endpoint) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    if (endpoint === "homes")
      values.checklist = values.checklist
        .split("\n")
        .map((value) => value.trim())
        .filter(Boolean);
    if (endpoint === "jobs") values.minutes = Number(values.minutes);
    try {
      const result = await api(endpoint, {
        method: "POST",
        body: JSON.stringify(values),
      });
      form.reset();
      if (endpoint === "jobs") {
        setDate(values.localStart.slice(0, 10));
        setMonth(values.localStart.slice(0, 7));
        setView("schedule");
      }
      await refresh(endpoint === "jobs" ? result.id : null);
      setMessage(
        endpoint === "jobs" ? "Cleaning scheduled." : "Property added.",
      );
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }
  async function newInvite() {
    setBusy(true);
    try {
      const result = await api("invites", { method: "POST", body: "{}" });
      setInviteLink(`${window.location.origin}/?invite=${result.token}`);
      setMessage("Invitation created. It works once and expires in 24 hours.");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  if (!session)
    return (
      <div className="loading">
        <span className="brand">cleandesk ✳</span>
        <p role="status">{message || "Opening your workspace…"}</p>
        <button
          onClick={() => refresh().catch((error) => setMessage(error.message))}
        >
          Retry
        </button>
      </div>
    );
  if (!session.user)
    return (
      <Auth
        setup={session.setupRequired}
        invite={invite}
        onSuccess={() => {
          setInvite("");
          window.history.replaceState(null, "", "/");
          refresh().catch((error) => setMessage(error.message));
        }}
      />
    );
  if (!data) return <p className="loading">Loading your schedule…</p>;
  const manager = data.user.role === "manager";
  const homes = new Map(data.homes.map((home) => [home.id, home]));
  const workers = new Map(data.workers.map((worker) => [worker.id, worker]));
  const jobs = data.jobs.filter(
    (job) => dayInZone(job.starts, data.workspace.timezone) === date,
  );
  const active = data.jobs.find((job) => job.id === selected);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/">
          clean<span>desk</span>
          <i>✳</i>
        </a>
        <div className="workspace-chip">
          {data.workspace.name}
          <span>{manager ? "MANAGER WORKSPACE" : "CLEANER WORKSPACE"}</span>
        </div>
        <nav aria-label="Workspace">
          <button
            aria-pressed={view === "schedule"}
            onClick={() => setView("schedule")}
          >
            ▦ Schedule
          </button>
          {manager ? (
            <>
              <button
                aria-pressed={view === "properties"}
                onClick={() => setView("properties")}
              >
                ⌂ Properties <span>{data.homes.length}</span>
              </button>
              <button
                aria-pressed={view === "team"}
                onClick={() => setView("team")}
              >
                ◎ Team <span>{data.workers.length}</span>
              </button>
              <button
                aria-pressed={view === "review"}
                onClick={() => setView("review")}
              >
                ✓ Review reports{" "}
                <span>
                  {data.jobs.filter((job) => job.status === "submitted").length}
                </span>
              </button>
            </>
          ) : null}
        </nav>
        <div className="sidebar-bottom">
          <p>
            Every property.
            <br />
            Every detail.
            <br />
            <em>Accounted for.</em>
          </p>
          <span>
            {data.user.name}
            <small>{data.user.email}</small>
          </span>
          <button
            onClick={async () => {
              try {
                await api("logout", { method: "POST", body: "{}" });
                setData(null);
                await refresh();
              } catch (error) {
                setMessage(error.message);
              }
            }}
          >
            Sign out ↗
          </button>
        </div>
      </aside>
      <main>
        <header className="workspace-header">
          <span>
            {manager ? "OPERATIONS" : "MY WORK"} / {view.toUpperCase()}
          </span>
          <span>{data.workspace.timezone}</span>
        </header>
        <section className="page-heading">
          <div>
            <p className="eyebrow">
              {manager
                ? "A LITTLE LESS BACK-AND-FORTH"
                : "YOUR NEXT JOB, ALL IN ONE PLACE"}
            </p>
            <h1>
              {
                {
                  schedule: "A clear day ahead.",
                  "new-job": "Plan the next clean.",
                  properties: "Places you look after.",
                  team: "Good people. Good work.",
                  review: "The finishing touches.",
                }[view]
              }
            </h1>
          </div>
          {manager && view === "schedule" ? (
            <button
              className="primary"
              onClick={() => {
                setView("new-job");
                setSelected(null);
              }}
            >
              Schedule cleaning +
            </button>
          ) : null}
        </section>
        <p
          className="global-message"
          role="status"
          aria-label="Workspace notifications"
        >
          {message}
        </p>
        {view === "schedule" || view === "review" ? (
          <div className="schedule-layout">
            <div className="schedule-sidebar">
              {view === "schedule" ? (
                <Calendar
                  month={month}
                  onMonth={setMonth}
                  selected={date}
                  onSelect={(value) => {
                    setDate(value);
                    setSelected(null);
                  }}
                  jobs={data.jobs}
                  timezone={data.workspace.timezone}
                />
              ) : (
                <div className="review-intro">
                  <h2>Ready for a second look.</h2>
                  <p>
                    Check the checklist, read the notes, and inspect completion
                    photos before approving.
                  </p>
                </div>
              )}
              <div className="summary-card">
                <span>
                  {data.jobs.filter((job) => job.status === "scheduled").length}
                </span>
                <p>scheduled</p>
                <span>
                  {data.jobs.filter((job) => job.status === "submitted").length}
                </span>
                <p>awaiting review</p>
              </div>
            </div>
            <section className="day-jobs">
              <div className="section-heading">
                <h2>
                  {view === "review"
                    ? "Reports to review"
                    : new Date(`${date}T12:00:00Z`).toLocaleDateString(
                        "en-GB",
                        {
                          timeZone: "UTC",
                          weekday: "long",
                          day: "numeric",
                          month: "long",
                        },
                      )}
                </h2>
                <span>
                  {
                    (view === "review"
                      ? data.jobs.filter((job) => job.status === "submitted")
                      : jobs
                    ).length
                  }{" "}
                  jobs
                </span>
              </div>
              <div className="job-list">
                {(view === "review"
                  ? data.jobs.filter((job) => job.status === "submitted")
                  : jobs
                ).map((job) => (
                  <button
                    key={job.id}
                    className={`job-card ${selected === job.id ? "active" : ""}`}
                    onClick={() => setSelected(job.id)}
                  >
                    <time>
                      {new Date(job.starts).toLocaleTimeString("en-GB", {
                        timeZone: data.workspace.timezone,
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      <small>{(job.ends - job.starts) / 60000} min</small>
                    </time>
                    <span className="job-main">
                      <strong>{homes.get(job.home_id)?.name}</strong>
                      <small>{homes.get(job.home_id)?.address}</small>
                      <span>{workers.get(job.cleaner_id)?.name}</span>
                    </span>
                    <span className={`status ${job.status}`}>
                      {statusNames[job.status]}
                    </span>
                    <span>↗</span>
                  </button>
                ))}
              </div>
              {!(
                view === "review"
                  ? data.jobs.filter((job) => job.status === "submitted")
                  : jobs
              ).length ? (
                <div className="empty-state">
                  <span>✳</span>
                  <h3>
                    {view === "review"
                      ? "Nothing waiting for review."
                      : "No cleaning booked for this day."}
                  </h3>
                  <p>
                    {manager
                      ? "Add a property and a team member, then schedule your first clean."
                      : "Your manager will assign upcoming work here."}
                  </p>
                </div>
              ) : null}
              {active ? (
                <Report
                  key={active.id}
                  job={active}
                  home={homes.get(active.home_id)}
                  cleaner={workers.get(active.cleaner_id)}
                  user={data.user}
                  timezone={data.workspace.timezone}
                  onRefresh={refresh}
                />
              ) : null}
            </section>
          </div>
        ) : null}
        {manager && view === "new-job" ? (
          <section className="form-page">
            <h2>Schedule a clean</h2>
            {!data.homes.length ? (
              <p>Add a property first from the Properties section.</p>
            ) : (
              <form onSubmit={(event) => create(event, "jobs")}>
                <div className="form-grid">
                  <label>
                    Property
                    <select aria-label="Property" name="homeId" required>
                      {data.homes.map((home) => (
                        <option key={home.id} value={home.id}>
                          {home.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Assigned to
                    <select aria-label="Assigned to" name="cleanerId" required>
                      {data.workers.map((worker) => (
                        <option key={worker.id} value={worker.id}>
                          {worker.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Local start time
                    <input
                      name="localStart"
                      type="datetime-local"
                      defaultValue={`${date}T09:00`}
                      required
                    />
                  </label>
                  <label>
                    Duration (minutes)
                    <input
                      name="minutes"
                      type="number"
                      min="15"
                      max="720"
                      step="15"
                      defaultValue="120"
                      required
                    />
                  </label>
                </div>
                <label>
                  Job instructions
                  <textarea
                    name="instruction"
                    maxLength={2000}
                    placeholder="Specific requests for this visit"
                  />
                </label>
                <p className="muted">
                  Times use {data.workspace.timezone}. Overlapping property or
                  staff bookings are rejected.
                </p>
                <button className="primary" disabled={busy}>
                  Schedule cleaning ↗
                </button>
              </form>
            )}
          </section>
        ) : null}
        {manager && view === "properties" ? (
          <div className="management-grid">
            <section className="records">
              <h2>Your properties</h2>
              {data.homes.map((home) => (
                <article key={home.id}>
                  <h3>{home.name}</h3>
                  <p>{home.address}</p>
                  <small>{home.checklist.length} checklist items</small>
                </article>
              ))}
              {!data.homes.length ? (
                <p className="muted">
                  No properties yet. Add your first apartment here.
                </p>
              ) : null}
            </section>
            <section className="form-page">
              <h2>Add a property</h2>
              <form onSubmit={(event) => create(event, "homes")}>
                <label>
                  Property name
                  <input
                    name="name"
                    minLength={2}
                    maxLength={100}
                    required
                    placeholder="Apartment name or reference"
                  />
                </label>
                <label>
                  Address
                  <input
                    name="address"
                    minLength={5}
                    maxLength={250}
                    required
                  />
                </label>
                <label>
                  Access notes
                  <textarea
                    name="notes"
                    maxLength={1000}
                    placeholder="Entry instructions, keys, parking…"
                  />
                </label>
                <label>
                  Cleaning checklist — one item per line
                  <textarea
                    name="checklist"
                    required
                    placeholder="Add the tasks for this property"
                  />
                </label>
                <button className="primary" disabled={busy}>
                  Add property +
                </button>
              </form>
            </section>
          </div>
        ) : null}
        {manager && view === "team" ? (
          <div className="management-grid">
            <section className="records">
              <h2>Your team</h2>
              {data.workers.map((worker) => (
                <article key={worker.id}>
                  <h3>
                    {worker.name} <span className="status">{worker.role}</span>
                  </h3>
                  <p>{worker.email}</p>
                </article>
              ))}
            </section>
            <section className="form-page">
              <h2>Invite a cleaner</h2>
              <p>
                Create a one-time link and share it with your colleague. They
                choose their own password.
              </p>
              <button className="primary" disabled={busy} onClick={newInvite}>
                Create invitation ↗
              </button>
              {inviteLink ? (
                <label className="invite-link">
                  One-time invitation
                  <input
                    aria-label="One-time invitation"
                    value={inviteLink}
                    readOnly
                    onFocus={(event) => event.target.select()}
                  />
                  <small>Valid for 24 hours. Share this link privately.</small>
                </label>
              ) : null}
            </section>
          </div>
        ) : null}
        <footer>
          <span>CleanDesk · {data.workspace.name}</span>
          <a href="https://github.com/goshkaaaa/cleandesk">
            Source & hosting instructions ↗
          </a>
        </footer>
      </main>
    </div>
  );
}
