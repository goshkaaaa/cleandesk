"use client";
import { monthCells, dayInZone } from "../lib/client";
export default function Calendar({
  month,
  onMonth,
  selected,
  onSelect,
  jobs,
  timezone,
}) {
  function move(delta) {
    const [year, value] = month.split("-").map(Number);
    onMonth(
      new Date(Date.UTC(year, value - 1 + delta, 1)).toISOString().slice(0, 7),
    );
  }
  const counts = jobs
    .filter((job) => job.status !== "cancelled")
    .reduce((map, job) => {
      const day = dayInZone(job.starts, timezone);
      map[day] = (map[day] || 0) + 1;
      return map;
    }, {});
  return (
    <section className="calendar">
      <div className="calendar-header">
        <h2>
          {new Date(`${month}-01T12:00:00Z`).toLocaleDateString("en-GB", {
            month: "long",
            year: "numeric",
            timeZone: "UTC",
          })}
        </h2>
        <div>
          <button aria-label="Previous month" onClick={() => move(-1)}>
            ‹
          </button>
          <button aria-label="Next month" onClick={() => move(1)}>
            ›
          </button>
        </div>
      </div>
      <div className="calendar-grid">
        {["M", "T", "W", "T", "F", "S", "S"].map((label, index) => (
          <span className="weekday" key={index}>
            {label}
          </span>
        ))}
        {monthCells(month).map((cell) => (
          <button
            key={cell.date}
            className={`${cell.current ? "" : "other-month"} ${selected === cell.date ? "selected" : ""}`}
            aria-label={`${cell.date}${counts[cell.date] ? `, ${counts[cell.date]} jobs` : ""}`}
            aria-pressed={selected === cell.date}
            onClick={() => {
              onSelect(cell.date);
              if (!cell.current) onMonth(cell.date.slice(0, 7));
            }}
          >
            <span>{cell.number}</span>
            {counts[cell.date] ? <small>{counts[cell.date]}</small> : <i />}
          </button>
        ))}
      </div>
      <p>Dates and times in {timezone.replace("Europe/", "")}.</p>
    </section>
  );
}
