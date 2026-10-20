import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import sharp from "sharp";

test.describe.configure({ mode: "serial" });
const origin = "http://127.0.0.1:3501";
const credentials = {
  email: "qa-manager@example.test",
  password: "Only_for_testing_2040!",
};
test.beforeAll(async ({ request }) => {
  const state = await request
    .get("/api/session")
    .then((response) => response.json());
  if (state.setupRequired) {
    const response = await request.post("/api/setup", {
      headers: { Origin: origin },
      data: {
        ...credentials,
        name: "QA Manager",
        company: "QA Cleaning Team",
        timezone: "Europe/Berlin",
      },
    });
    expect(response.ok(), await response.text()).toBe(true);
  }
});
async function login(page) {
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill(credentials.email);
  await page.getByLabel("Password", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "Sign in ↗", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "A clear day ahead." }),
  ).toBeVisible();
}

test("manager and cleaner complete an assigned job with a real photo and review", async ({
  page,
  browser,
}) => {
  test.setTimeout(90000);
  await login(page);
  const suffix = crypto.randomUUID().slice(0, 8);
  const property = `Flat ${suffix}`;
  await page.getByRole("button", { name: /Properties/ }).click();
  await page.getByLabel("Property name", { exact: true }).fill(property);
  await page
    .getByLabel("Address", { exact: true })
    .fill("Example Street 12, Berlin");
  await page
    .getByLabel("Access notes", { exact: true })
    .fill("Collect the keys from reception.");
  await page
    .getByLabel("Cleaning checklist — one item per line")
    .fill("Clean kitchen\nClean bathroom");
  await page
    .getByRole("button", { name: "Add property +", exact: true })
    .click();
  await expect(
    page.getByRole("status", { name: "Workspace notifications" }),
  ).toContainText("Property added.");
  await page.getByRole("button", { name: /Team/ }).click();
  await page.getByRole("button", { name: "Create invitation ↗" }).click();
  const link = await page
    .getByLabel("One-time invitation", { exact: true })
    .inputValue();
  const workerContext = await browser.newContext();
  const worker = await workerContext.newPage();
  await worker.goto(link);
  await worker
    .getByLabel("Your name", { exact: true })
    .fill(`Cleaner ${suffix}`);
  await worker
    .getByLabel("Email", { exact: true })
    .fill(`qa-${suffix}@example.test`);
  await worker
    .getByLabel("Password", { exact: true })
    .fill("Only_for_testing_2040!");
  await worker.getByRole("button", { name: "Join workspace ↗" }).click();
  await expect(
    worker.getByRole("heading", { name: "A clear day ahead." }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole("button", { name: "Schedule cleaning +", exact: true })
    .click();
  await page
    .getByLabel("Property", { exact: true })
    .selectOption({ label: property });
  await page
    .getByLabel("Assigned to", { exact: true })
    .selectOption({ label: `Cleaner ${suffix}` });
  await page
    .getByRole("button", { name: "Schedule cleaning ↗", exact: true })
    .click();
  await expect(
    page.getByRole("status", { name: "Workspace notifications" }),
  ).toContainText("Cleaning scheduled.");
  const job = await page.evaluate(async () => {
    const response = await fetch("/api/dashboard");
    return (await response.json()).jobs.at(-1);
  });
  await worker.reload();
  await worker.getByRole("button", { name: new RegExp(property) }).click();
  await worker.getByRole("button", { name: "Start cleaning ↗" }).click();
  await worker.getByLabel("Clean kitchen", { exact: true }).check();
  await worker.getByLabel("Clean bathroom", { exact: true }).check();
  await worker
    .getByLabel("Cleaning report", { exact: true })
    .fill("All rooms cleaned. No damage found.");
  const photo = await sharp({
    create: { width: 10, height: 10, channels: 3, background: "#9bb58a" },
  })
    .png()
    .toBuffer();
  await worker.locator("input[type=file]").setInputFiles({
    name: "finished.png",
    mimeType: "image/png",
    buffer: photo,
  });
  await expect(worker.locator(".photo-grid img")).toHaveCount(1);
  await worker.getByRole("button", { name: "Submit for review ↗" }).click();
  await expect(worker.locator(".report-panel .status")).toHaveText(
    "Awaiting review",
  );
  await page.reload();
  await page.getByRole("button", { name: /Review reports/ }).click();
  await page.getByRole("button", { name: new RegExp(property) }).click();
  await expect(page.getByLabel("Cleaning report", { exact: true })).toHaveValue(
    "All rooms cleaned. No damage found.",
  );
  await page.getByRole("button", { name: "Approve cleaning ✓" }).click();
  await expect(page.locator(".report-panel .status")).toHaveText("Approved");
  const anonymous = await browser.newContext();
  const response = await anonymous.request.get(
    `${origin}/api/photos/${job.id}`,
  );
  expect(response.status()).toBe(401);
  await anonymous.close();
  await workerContext.close();
});
test("mutations reject other origins and unauthenticated callers", async ({
  request,
}) => {
  const bad = await request.post("/api/homes", {
    headers: { Origin: "https://other.example" },
    data: {},
  });
  expect(bad.status()).toBe(403);
  const anonymous = await request.get("/api/dashboard");
  expect(anonymous.status()).toBe(401);
});
test("workspace fits mobile screens and passes initial accessibility checks", async ({
  page,
}) => {
  await login(page);
  await page.evaluate(() => document.fonts.ready);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    result.violations.map((item) => ({
      id: item.id,
      targets: item.nodes.map((node) => node.target),
    })),
  ).toEqual([]);
});
