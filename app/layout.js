import "./globals.css";
export const metadata = {
  title: "CleanDesk — A clear plan for every clean",
  description:
    "A cleaning team workspace with properties, schedules, assigned jobs, photo reports, and manager review.",
};
export default function Layout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
