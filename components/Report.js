"use client";
import { useState } from "react";
import { api, statusNames } from "../lib/client";
export default function Report({
  job,
  home,
  cleaner,
  user,
  timezone,
  onRefresh,
}) {
  const [checklist, setChecklist] = useState(
    job.checklist.map((item) => item.done),
  );
  const [report, setReport] = useState(job.report);
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const editable = job.status === "in_progress";
  async function action(name) {
    setBusy(true);
    setMessage("");
    try {
      await api(`jobs/${job.id}`, {
        method: "PATCH",
        body: JSON.stringify({ action: name, checklist, report, feedback }),
      });
      await onRefresh(job.id);
      setMessage(name === "save" ? "Report saved." : "Job updated.");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }
  async function upload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      if (file.size > 5 * 1024 * 1024)
        throw new Error("Choose an image smaller than 5 MB.");
      const form = new FormData();
      form.set("photo", file);
      await api(`jobs/${job.id}/photos`, { method: "POST", body: form });
      await onRefresh(job.id);
      setMessage("Photo uploaded. Save your notes before leaving this report.");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
      event.target.value = "";
    }
  }
  async function removePhoto(id) {
    setBusy(true);
    try {
      await api(`photos/${id}`, { method: "DELETE", body: "{}" });
      await onRefresh(job.id);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="report-panel">
      <div className="panel-heading">
        <span className={`status ${job.status}`}>
          {statusNames[job.status]}
        </span>
        <button onClick={() => window.print()}>Print report ↗</button>
      </div>
      <h2>{home?.name}</h2>
      <p className="address">{home?.address}</p>
      <div className="job-facts">
        <span>
          {new Date(job.starts).toLocaleString("en-GB", {
            timeZone: timezone,
            day: "numeric",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
        <span>{(job.ends - job.starts) / 60000} min</span>
        <span>{cleaner?.name}</span>
      </div>
      {home?.notes ? (
        <div className="access-note">
          <strong>Access notes</strong>
          <p>{home.notes}</p>
        </div>
      ) : null}
      {job.instruction ? (
        <p className="instruction">{job.instruction}</p>
      ) : null}
      {job.feedback ? (
        <div className="feedback">
          <strong>Manager feedback</strong>
          <p>{job.feedback}</p>
        </div>
      ) : null}
      <h3>Room-by-room checklist</h3>
      <div className="checklist">
        {job.checklist.map((item, index) => (
          <label key={index}>
            <input
              type="checkbox"
              checked={checklist[index]}
              disabled={!editable || busy}
              onChange={(event) =>
                setChecklist((current) =>
                  current.map((done, position) =>
                    position === index ? event.target.checked : done,
                  ),
                )
              }
            />
            <span>{item.label}</span>
          </label>
        ))}
      </div>
      <label className="report-label">
        Cleaning report
        <textarea
          aria-label="Cleaning report"
          value={report}
          maxLength={5000}
          disabled={!editable || busy}
          placeholder="What was cleaned? Note any damage, missing items, or supplies needed."
          onChange={(event) => setReport(event.target.value)}
        />
      </label>
      <div className="photo-heading">
        <h3>
          Completion photos <small>{job.photos.length}/12</small>
        </h3>
        {editable ? (
          <label className="upload-button">
            + Add photo
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={upload}
              disabled={busy || job.photos.length >= 12}
            />
          </label>
        ) : null}
      </div>
      <div className="photo-grid">
        {job.photos.map((photo) => (
          <figure key={photo.id}>
            <a
              href={`/api/photos/${photo.id}`}
              target="_blank"
              rel="noreferrer"
            >
              <img
                src={`/api/photos/${photo.id}`}
                alt={`Completion photo for ${home?.name}`}
              />
            </a>
            {editable ? (
              <button
                disabled={busy}
                aria-label="Remove completion photo"
                onClick={() => removePhoto(photo.id)}
              >
                ×
              </button>
            ) : null}
          </figure>
        ))}
      </div>
      {!job.photos.length ? (
        <p className="empty-small">
          No photos yet. One photo is required to submit the report.
        </p>
      ) : null}
      <p role="status" className="form-error">
        {message}
      </p>
      <div className="report-actions">
        {job.status === "scheduled" ? (
          <button
            className="primary"
            disabled={busy}
            onClick={() => action("start")}
          >
            Start cleaning ↗
          </button>
        ) : null}
        {editable ? (
          <>
            <button
              className="outline"
              disabled={busy}
              onClick={() => action("save")}
            >
              Save report
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={() => action("submit")}
            >
              Submit for review ↗
            </button>
          </>
        ) : null}
        {user.role === "manager" && job.status === "submitted" ? (
          <>
            <button
              className="primary"
              disabled={busy}
              onClick={() => action("approve")}
            >
              Approve cleaning ✓
            </button>
            <label>
              Feedback for rework
              <input
                value={feedback}
                maxLength={1000}
                onChange={(event) => setFeedback(event.target.value)}
              />
            </label>
            <button
              className="outline"
              disabled={busy || feedback.trim().length < 2}
              onClick={() => action("reopen")}
            >
              Request rework
            </button>
          </>
        ) : null}
        {user.role === "manager" &&
        ["scheduled", "in_progress"].includes(job.status) ? (
          <button
            className="text-button"
            disabled={busy}
            onClick={() => action("cancel")}
          >
            Cancel job
          </button>
        ) : null}
      </div>
      <details className="audit">
        <summary>Job history</summary>
        {job.history.map((event) => (
          <p key={event.id}>
            {event.actor_name} · {event.action} ·{" "}
            {new Date(event.at).toLocaleString("en-GB", { timeZone: timezone })}
          </p>
        ))}
      </details>
    </section>
  );
}
