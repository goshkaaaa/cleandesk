"use client";
import { useState } from "react";
import { api } from "../lib/client";
export default function Auth({ setup, invite, onSuccess }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try {
      await api(invite ? "accept-invite" : setup ? "setup" : "login", {
        method: "POST",
        body: JSON.stringify({ ...values, token: invite }),
      });
      onSuccess();
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-screen">
      <section className="auth-story">
        <a className="brand" href="/">
          clean<span>desk</span>
          <i>✳</i>
        </a>
        <div>
          <p className="eyebrow">LESS COORDINATING. MORE DONE.</p>
          <h1>
            A clean place.
            <br />A clear plan.
          </h1>
          <p>
            Properties, people, and proof of a job well done.
            <br />
            One desk for the whole cleaning team.
          </p>
        </div>
        <span>PLAN → CLEAN → REPORT → REVIEW</span>
      </section>
      <section className="auth-card">
        <p className="eyebrow">YOUR TEAM&apos;S WORKSPACE</p>
        <h2>
          {invite
            ? "Join your team."
            : setup
              ? "Start with a clean slate."
              : "Welcome back."}
        </h2>
        <p>
          {invite
            ? "Create your cleaner account with this invitation."
            : setup
              ? "Create the first manager account. Your workspace starts empty."
              : "Sign in to your schedule and reports."}
        </p>
        <form onSubmit={submit}>
          {(setup || invite) && (
            <label>
              Your name
              <input
                name="name"
                minLength={2}
                maxLength={80}
                required
                autoComplete="name"
              />
            </label>
          )}
          {setup && (
            <>
              <label>
                Server setup key
                <input
                  name="setupToken"
                  type="password"
                  autoComplete="off"
                  placeholder="Required only when configured on the server"
                />
              </label>
              <label>
                Company / team
                <input name="company" minLength={2} maxLength={100} required />
              </label>
              <label>
                Workspace time zone
                <select name="timezone" defaultValue="Europe/Berlin">
                  {[
                    "Europe/Berlin",
                    "Europe/Paris",
                    "Europe/Amsterdam",
                    "Europe/Brussels",
                    "Europe/Vienna",
                    "Europe/Zurich",
                    "Europe/London",
                    "Europe/Warsaw",
                    "Europe/Prague",
                    "Europe/Madrid",
                    "Europe/Rome",
                    "Europe/Helsinki",
                    "Europe/Lisbon",
                  ].map((zone) => (
                    <option key={zone}>{zone}</option>
                  ))}
                </select>
              </label>
            </>
          )}
          <label>
            Email
            <input
              name="email"
              type="email"
              autoComplete="email"
              maxLength={180}
              required
            />
          </label>
          <label>
            Password
            <input
              name="password"
              type="password"
              minLength={setup || invite ? 12 : 1}
              maxLength={200}
              autoComplete={
                setup || invite ? "new-password" : "current-password"
              }
              required
            />
          </label>
          <p role="alert" className="form-error">
            {error}
          </p>
          <button className="primary" disabled={busy}>
            {busy
              ? "Please wait…"
              : invite
                ? "Join workspace ↗"
                : setup
                  ? "Create workspace ↗"
                  : "Sign in ↗"}
          </button>
        </form>
        {invite ? (
          <a className="subtle-link" href="/">
            Already have an account? Sign in
          </a>
        ) : (
          <p className="auth-note">
            Cleaner accounts are created through a manager&apos;s invitation.
          </p>
        )}
      </section>
    </div>
  );
}
