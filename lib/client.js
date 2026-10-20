export async function api(path, options = {}) {
  const response = await fetch(`/api/${path}`, {
    ...options,
    headers:
      options.body instanceof FormData
        ? options.headers
        : { "Content-Type": "application/json", ...options.headers },
    cache: "no-store",
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || "Request failed.");
  return value;
}
export function dayInZone(timestamp, timeZone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestamp));
}
export function monthCells(month) {
  const [year, value] = month.split("-").map(Number);
  const first = new Date(Date.UTC(year, value - 1, 1));
  const offset = (first.getUTCDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(Date.UTC(year, value - 1, 1 - offset + index));
    return {
      date: date.toISOString().slice(0, 10),
      number: date.getUTCDate(),
      current: date.getUTCMonth() === value - 1,
    };
  });
}
export const statusNames = {
  scheduled: "Scheduled",
  in_progress: "In progress",
  submitted: "Awaiting review",
  completed: "Approved",
  cancelled: "Cancelled",
};
