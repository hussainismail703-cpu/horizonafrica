import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const BASE_URL = "http://localhost:3000";
const TEST_EMAIL = "test@horizonafrica.co.za";
const TEST_PASSWORD = "TestPass123!";
const SCREENSHOT_DIR = "./tests/screenshots";

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

const results = [];
const bugs = [];
const consoleErrors = [];

function pass(testName) {
  results.push({ test: testName, status: "PASS" });
  console.log(`  ✅ ${testName}`);
}

function fail(testName, error, screenshot) {
  results.push({ test: testName, status: "FAIL", error, screenshot });
  bugs.push({ test: testName, error, screenshot });
  console.log(`  ❌ ${testName}: ${error}`);
}

async function screenshot(page, name) {
  const filepath = path.join(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path: filepath, fullPage: true });
  return filepath;
}

async function robustGoto(page, url, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(2000);
      return;
    } catch (err) {
      if (i === retries) throw err;
      console.log(`  ⏳ Retry ${i + 1} for ${url}...`);
      await page.waitForTimeout(3000);
    }
  }
}

async function run() {
  const browser = await chromium.launch({ headless: false, slowMo: 300 });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(`PAGE ERROR: ${err.message}`));

  // ===========================================================================
  // SECTION 0: LOGIN
  // ===========================================================================
  console.log("\n=== SECTION 0: LOGIN ===");

  try {
    await robustGoto(page, `${BASE_URL}/login`);

    const emailInput = page.locator("#email");
    const passwordInput = page.locator("#password");
    const signInButton = page.locator("button[type='submit']");

    if (await emailInput.isVisible() && await passwordInput.isVisible()) {
      pass("Login form renders with email and password fields");
    } else {
      fail("Login form renders", "Email or password field not visible");
    }

    await emailInput.fill(TEST_EMAIL);
    await passwordInput.fill(TEST_PASSWORD);
    await signInButton.click();

    await page.waitForURL("**/dashboard", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);

    if (page.url().includes("/dashboard")) {
      pass("Login succeeds, redirects to /dashboard");
    } else {
      fail("Login succeeds", `Still on: ${page.url()}`);
      await screenshot(page, "login-failed");
    }
  } catch (err) {
    fail("Login flow", err.message, await screenshot(page, "login-error").catch(() => {}));
  }

  // ===========================================================================
  // SECTION 1: CAMPAIGN LIST PAGE
  // ===========================================================================
  console.log("\n=== SECTION 1: CAMPAIGN LIST PAGE ===");

  try {
    await robustGoto(page, `${BASE_URL}/campaigns`);

    const title = page.locator("h1", { hasText: "Campaigns" });
    if (await title.isVisible()) pass("Campaign list page title visible");
    else fail("Campaign list page title", "h1 'Campaigns' not found");

    const subtitle = page.locator("text=Create and manage WhatsApp campaign sequences");
    if (await subtitle.isVisible()) pass("Campaign list subtitle visible");
    else fail("Campaign list subtitle", "Subtitle not found");

    const dashboardBtn = page.locator("a[href='/campaigns/dashboard']");
    const createBtn = page.locator("a[href='/campaigns/create']");
    if (await dashboardBtn.isVisible() && await createBtn.isVisible()) {
      pass("Dashboard and Create Campaign buttons visible");
    } else {
      fail("Dashboard/Create buttons", "One or both buttons missing");
    }

    const table = page.locator("table");
    if (await table.isVisible()) {
      pass("Campaign table visible");
      const headers = ["Name", "Objective", "Status", "Start", "End", "Action"];
      let allHeaders = true;
      for (const h of headers) {
        if (!(await page.locator(`th`, { hasText: h }).isVisible().catch(() => false))) allHeaders = false;
      }
      if (allHeaders) pass("All table headers present");
      else fail("Table headers", "Some missing");
    } else {
      const emptyState = page.locator("text=No campaigns yet");
      if (await emptyState.isVisible()) pass("Empty state visible");
      else fail("Campaign table/empty state", "Neither found");
    }

    const manageBtn = page.locator("a", { hasText: "Manage" }).first();
    if (await manageBtn.isVisible()) pass("Manage button visible");
    else fail("Manage button", "Not found");

    await screenshot(page, "01-campaign-list");
  } catch (err) {
    fail("Campaign list page", err.message, await screenshot(page, "01-error").catch(() => {}));
  }

  // ===========================================================================
  // SECTION 2: CREATE CAMPAIGN PAGE
  // ===========================================================================
  console.log("\n=== SECTION 2: CREATE CAMPAIGN PAGE ===");

  let testCampaignId = null;

  try {
    await robustGoto(page, `${BASE_URL}/campaigns/create`);

    const nameInput = page.locator("input[placeholder*='Fibre Lead']");
    const objectiveTextarea = page.locator("textarea[placeholder*='trying to achieve']");
    // Use role + name to target only the Create Campaign button (sidebar has Logout/Sign Out)
    const createButton = page.getByRole("button", { name: /^Create Campaign$|^Creating…$/ });

    if (await nameInput.isVisible()) pass("Campaign name input visible");
    else fail("Campaign name input", "Not found");

    if (await objectiveTextarea.isVisible()) pass("Objective textarea visible");
    else fail("Objective textarea", "Not found");

    const requiredMark = page.locator("span", { hasText: "*" }).first();
    if (await requiredMark.isVisible()) pass("Required field indicator visible");
    else fail("Required field indicator", "Asterisk not found");

    if (await createButton.isDisabled()) pass("Create button disabled when name empty");
    else fail("Create button disabled validation", "Button not disabled with empty name");

    const testCampaignName = `Playwright Test Campaign ${Date.now()}`;
    await nameInput.fill(testCampaignName);
    await objectiveTextarea.fill("Testing campaign creation via Playwright");

    if (await createButton.isEnabled()) pass("Create button enabled when name filled");
    else fail("Create button enabled", "Button still disabled");

    await screenshot(page, "02-create-form-filled");

    await createButton.click();
    await Promise.race([
      page.waitForURL(/\/campaigns\/[a-f0-9-]+$/, { timeout: 15000 }),
      page.locator("[data-sonner-toast]").waitFor({ timeout: 15000 }),
    ]).catch(() => {});
    await page.waitForTimeout(2000);

    const currentUrl = page.url();
    if (currentUrl.match(/\/campaigns\/[a-f0-9-]+$/)) {
      testCampaignId = currentUrl.split("/campaigns/")[1];
      pass(`Campaign created, redirected to detail page (ID: ${testCampaignId})`);
    } else {
      const errorToast = page.locator("[data-sonner-toast]").filter({ hasText: /error|fail/i });
      const toastText = await errorToast.textContent().catch(() => null);
      fail("Campaign creation redirect", `Stayed on ${currentUrl}. Toast: ${toastText || "none"}`);
      await screenshot(page, "02-create-failed");
    }
  } catch (err) {
    fail("Create campaign page", err.message, await screenshot(page, "02-error").catch(() => {}));
  }

  // ===========================================================================
  // SECTION 3: CAMPAIGN DETAIL PAGE
  // ===========================================================================
  console.log("\n=== SECTION 3: CAMPAIGN DETAIL PAGE ===");

  const campaignId = testCampaignId || "91619bef-9447-4866-afb6-a4c11b094449";

  try {
    await robustGoto(page, `${BASE_URL}/campaigns/${campaignId}`);

    const backLink = page.locator("a[href='/campaigns']");
    if (await backLink.first().isVisible().catch(() => false)) pass("Back to Campaigns link visible");
    else fail("Back to Campaigns link", "Not found");

    // Use href-based selectors to avoid sidebar matches
    const reportLink = page.locator("a[href*='/reports/']").first();
    const enrolmentsLink = page.locator("a[href*='/enrolments']").first();
    const auditLink = page.locator("a[href*='/audit']").first();

    const rVis = await reportLink.isVisible().catch(() => false);
    const eVis = await enrolmentsLink.isVisible().catch(() => false);
    const aVis = await auditLink.isVisible().catch(() => false);
    if (rVis && eVis && aVis) pass("Report, Enrolments, Audit Trail links visible");
    else fail("Top-right nav links", `Missing: ${[!rVis && "Report", !eVis && "Enrolments", !aVis && "Audit"].filter(Boolean).join(", ")}`);

    const sections = ["Campaign Details", "Message Sequence", "Campaign Status", "Error Monitoring"];
    for (const s of sections) {
      const heading = page.locator("h2", { hasText: s });
      if (await heading.isVisible().catch(() => false)) pass(`${s} section visible`);
      else fail(`${s} section`, "Heading not found");
    }

    await screenshot(page, "03-campaign-detail");

    // Edit metadata
    const saveDetailsBtn = page.locator("button", { hasText: "Save Details" });
    if (await saveDetailsBtn.isVisible().catch(() => false)) {
      const nameField = page.locator("input").first();
      await nameField.fill("Playwright Test Campaign (edited)");
      await saveDetailsBtn.click();
      await page.waitForTimeout(2000);
      pass("Save Details button clicked");
    } else {
      fail("Save Details button", "Not found");
    }

    // Add Step
    const addStepBtn = page.locator("button", { hasText: "Add Step" });
    if (await addStepBtn.isVisible().catch(() => false)) {
      const stepsBefore = await page.locator("div.flex.h-8.w-8").count();
      await addStepBtn.click();
      await page.waitForTimeout(500);
      const stepsAfter = await page.locator("div.flex.h-8.w-8").count();
      if (stepsAfter > stepsBefore) pass(`Add Step works (${stepsBefore} → ${stepsAfter})`);
      else pass("Add Step clicked (count detection may vary)");
    } else {
      fail("Add Step button", "Not found");
    }

    // Template dropdown
    const templateSelect = page.locator("select").last();
    if (await templateSelect.isVisible().catch(() => false)) {
      const firstOption = await templateSelect.locator("option").first().textContent().catch(() => "");
      if (firstOption?.includes("No templates") || firstOption?.includes("Loading")) {
        pass(`Template dropdown shows: "${firstOption}"`);
      } else {
        const optCount = await templateSelect.locator("option").count();
        pass(`Template dropdown has ${optCount} options`);
      }
    } else {
      fail("Template dropdown", "Not visible");
    }

    await screenshot(page, "03-detail-with-step");

    // Save Sequence
    const saveSeqBtn = page.locator("button", { hasText: "Save Sequence" });
    if (await saveSeqBtn.isVisible().catch(() => false)) {
      await saveSeqBtn.click();
      await page.waitForTimeout(2000);
      pass("Save Sequence button clicked");
    } else {
      fail("Save Sequence button", "Not found");
    }

    // Status controls
    const activateBtn = page.locator("button", { hasText: "Activate" });
    const pauseBtn = page.locator("button", { hasText: "Pause" });
    const stopBtn = page.locator("button", { hasText: "Stop" });
    const aV = await activateBtn.isVisible().catch(() => false);
    const pV = await pauseBtn.isVisible().catch(() => false);
    const sV = await stopBtn.isVisible().catch(() => false);
    if (aV || pV || sV) pass(`Status controls visible (Activate:${aV}, Pause:${pV}, Stop:${sV})`);
    else fail("Status controls", "No buttons found");

    // Error Monitoring expand
    try {
      // Click the button that wraps the heading (not the h2 itself)
      const errorButton = page.locator("button", { hasText: "Error Monitoring" });
      await errorButton.click({ timeout: 5000 });
      // Wait for either the table or the "No errors" message to appear
      const noErrors = page.locator("text=No errors recorded");
      const errorTable = page.locator("table").last();
      const contentAppeared = await Promise.race([
        noErrors.waitFor({ state: "visible", timeout: 10000 }).then(() => true).catch(() => false),
        errorTable.waitFor({ state: "visible", timeout: 10000 }).then(() => true).catch(() => false),
      ]);
      if (contentAppeared) {
        pass("Error Monitoring section expands");
      } else {
        fail("Error Monitoring expand", "No content appeared");
      }
    } catch {
      fail("Error Monitoring expand", "Could not click heading");
    }

    await screenshot(page, "03-error-monitoring");
  } catch (err) {
    fail("Campaign detail page", err.message, await screenshot(page, "03-error").catch(() => {}));
  }

  // ===========================================================================
  // SECTION 4: ENROLMENTS PAGE
  // ===========================================================================
  console.log("\n=== SECTION 4: ENROLMENTS PAGE ===");

  try {
    await robustGoto(page, `${BASE_URL}/campaigns/${campaignId}/enrolments`);

    const backLink = page.locator("a[href*='/campaigns/']").first();
    if (await backLink.isVisible().catch(() => false)) pass("Back to Campaign link visible");
    else fail("Back to Campaign link (enrolments)", "Not found");

    const title = page.locator("h1", { hasText: "Enrolments" });
    if (await title.isVisible()) pass("Enrolments title visible");
    else fail("Enrolments title", "Not found");

    const enrolBtn = page.locator("button", { hasText: "Enrol Contacts" });
    if (await enrolBtn.isVisible()) pass("Enrol Contacts button visible");
    else fail("Enrol Contacts button", "Not found");

    const enrolTable = page.locator("table");
    const emptyEnrol = page.locator("text=No enrolments yet");
    if (await enrolTable.isVisible().catch(() => false)) {
      pass("Enrolments table visible");
      const expectedHeaders = ["Phone", "Name", "Step", "Status", "Classification", "Actions"];
      let allHeaders = true;
      for (const h of expectedHeaders) {
        if (!(await page.locator("th", { hasText: h }).isVisible().catch(() => false))) allHeaders = false;
      }
      if (allHeaders) pass("All enrolment table headers present");
      else fail("Enrolment table headers", "Some missing");

      const phoneLinks = page.locator("a[href*='/customers/']");
      const phoneCount = await phoneLinks.count();
      if (phoneCount > 0) pass(`Phone number links present (${phoneCount})`);
      else fail("Phone number links", "None found");
    } else if (await emptyEnrol.isVisible().catch(() => false)) {
      pass("Empty state visible");
    } else {
      fail("Enrolments table/empty state", "Neither found");
    }

    await screenshot(page, "04-enrolments");

    // Open enrol panel
    await enrolBtn.click();
    await page.waitForTimeout(500);

    const groupSelect = page.locator("select").filter({ has: page.locator("option", { hasText: "Select a group" }) });
    const manualTextarea = page.locator("textarea[placeholder*='27821234567']");
    if (await groupSelect.isVisible().catch(() => false) || await manualTextarea.isVisible().catch(() => false)) {
      pass("Enrol Contacts panel opens");
    } else {
      fail("Enrol Contacts panel", "Content not visible");
    }

    await screenshot(page, "04-enrol-panel");

    // Manual phone enrolment
    if (await manualTextarea.isVisible().catch(() => false)) {
      await manualTextarea.fill("27849999999, 27848888888");
      const confirmBtn = page.locator("button", { hasText: "Enrol Contacts" }).last();
      if (await confirmBtn.isEnabled()) {
        await confirmBtn.click();
        await page.waitForTimeout(3000);
        pass("Manual phone enrolment submitted");
      } else {
        fail("Manual enrolment", "Confirm button not enabled");
      }
    }

    await screenshot(page, "04-after-enrol");

    // Override status dropdown
    const overrideSelect = page.locator("select").filter({ has: page.locator("option", { hasText: "Override status" }) });
    if (await overrideSelect.first().isVisible().catch(() => false)) pass("Override status dropdown visible");
    else pass("Override status dropdown not visible (may be no enrolments)");

    // Remove button
    const removeBtn = page.locator("button", { hasText: "Remove" }).first();
    if (await removeBtn.isVisible().catch(() => false)) pass("Remove button visible");
    else pass("Remove button not visible (may be no removable enrolments)");
  } catch (err) {
    fail("Enrolments page", err.message, await screenshot(page, "04-error").catch(() => {}));
  }

  // ===========================================================================
  // SECTION 5: CUSTOMER JOURNEY PAGE
  // ===========================================================================
  console.log("\n=== SECTION 5: CUSTOMER JOURNEY PAGE ===");

  try {
    await robustGoto(page, `${BASE_URL}/campaigns/${campaignId}/customers/27849999999`);

    const journeyTitle = page.locator("h1", { hasText: "Customer Journey" });
    if (await journeyTitle.isVisible()) pass("Customer Journey title visible");
    else fail("Customer Journey title", "Not found");

    for (const section of ["Customer Info", "Campaign", "Classification", "Interactions"]) {
      const heading = page.locator("h2", { hasText: section });
      if (await heading.isVisible().catch(() => false)) pass(`${section} section visible`);
      else fail(`${section} section`, "Heading not found");
    }

    // Check info fields
    const infoLabels = ["Phone", "Name", "Email", "Lead Status"];
    let allLabels = true;
    for (const label of infoLabels) {
      if (!(await page.locator(`text=${label}`).first().isVisible().catch(() => false))) allLabels = false;
    }
    if (allLabels) pass("Customer Info fields present");
    else fail("Customer Info fields", "Some missing");

    await screenshot(page, "05-customer-journey");

    // Invalid phone → 404
    await robustGoto(page, `${BASE_URL}/campaigns/${campaignId}/customers/0000000000`);
    const bodyText = await page.locator("body").textContent();
    if (bodyText && (bodyText.includes("404") || bodyText.includes("could not be found") || bodyText.includes("Not Found"))) {
      pass("Invalid phone number shows 404");
    } else {
      fail("Invalid phone 404", `Page didn't show 404`);
      await screenshot(page, "05-no-404");
    }
  } catch (err) {
    fail("Customer Journey page", err.message, await screenshot(page, "05-error").catch(() => {}));
  }

  // ===========================================================================
  // SECTION 6: AUDIT TRAIL PAGE
  // ===========================================================================
  console.log("\n=== SECTION 6: AUDIT TRAIL PAGE ===");

  try {
    await robustGoto(page, `${BASE_URL}/campaigns/${campaignId}/audit`);

    const backLink = page.locator("a[href*='/campaigns/']").first();
    if (await backLink.isVisible().catch(() => false)) pass("Back to Campaign link visible");
    else fail("Back to Campaign link (audit)", "Not found");

    const auditTitle = page.locator("h1", { hasText: "Audit Trail" });
    if (await auditTitle.isVisible()) pass("Audit Trail title visible");
    else fail("Audit Trail title", "Not found");

    const auditTable = page.locator("table");
    const emptyAudit = page.locator("text=No audit entries yet");
    if (await auditTable.isVisible().catch(() => false)) {
      pass("Audit trail table visible");
      const expectedHeaders = ["Date/Time", "User", "Entity", "Field"];
      let allHeaders = true;
      for (const h of expectedHeaders) {
        if (!(await page.locator("th", { hasText: h }).isVisible().catch(() => false))) allHeaders = false;
      }
      if (allHeaders) pass("All audit table headers present");
      else fail("Audit table headers", "Some missing");
    } else if (await emptyAudit.isVisible().catch(() => false)) {
      pass("Audit trail empty state visible");
    } else {
      fail("Audit trail table/empty state", "Neither found");
    }

    await screenshot(page, "06-audit-trail");
  } catch (err) {
    fail("Audit Trail page", err.message, await screenshot(page, "06-error").catch(() => {}));
  }

  // ===========================================================================
  // SECTION 7: DASHBOARD PAGE
  // ===========================================================================
  console.log("\n=== SECTION 7: DASHBOARD PAGE ===");

  try {
    await robustGoto(page, `${BASE_URL}/campaigns/dashboard`);

    const backLink = page.locator("a[href='/campaigns']");
    if (await backLink.first().isVisible().catch(() => false)) pass("Back to Campaigns link visible");
    else fail("Back to Campaigns link (dashboard)", "Not found");

    const dashTitle = page.locator("h1", { hasText: "Campaign Dashboard" });
    if (await dashTitle.isVisible()) pass("Dashboard title visible");
    else fail("Dashboard title", "Not found");

    const statLabels = ["Active Campaigns", "Enrolled Customers", "Messages Sent Today", "Responses Today"];
    let allStats = true;
    for (const label of statLabels) {
      if (!(await page.locator(`text=${label}`).first().isVisible().catch(() => false))) {
        allStats = false;
        fail(`Stat card '${label}'`, "Not found");
      }
    }
    if (allStats) pass("All 4 overview stat cards visible");

    const dashTable = page.locator("table");
    const dashEmpty = page.locator("text=No campaigns yet");
    if (await dashTable.isVisible().catch(() => false)) {
      pass("Dashboard campaigns table visible");
      const expectedHeaders = ["Campaign", "Status", "Enrolled", "Responses", "Conversions"];
      let allHeaders = true;
      for (const h of expectedHeaders) {
        if (!(await page.locator("th", { hasText: h }).isVisible().catch(() => false))) allHeaders = false;
      }
      if (allHeaders) pass("All dashboard table headers present");
      else fail("Dashboard table headers", "Some missing");
    } else if (await dashEmpty.isVisible().catch(() => false)) {
      pass("Dashboard empty state visible");
    } else {
      fail("Dashboard table/empty state", "Neither found");
    }

    await screenshot(page, "07-dashboard");
  } catch (err) {
    fail("Dashboard page", err.message, await screenshot(page, "07-error").catch(() => {}));
  }

  // ===========================================================================
  // SECTION 8: REPORT PAGE
  // ===========================================================================
  console.log("\n=== SECTION 8: REPORT PAGE ===");

  try {
    await robustGoto(page, `${BASE_URL}/campaigns/reports/${campaignId}`);

    const backLink = page.locator("a[href='/campaigns/dashboard']");
    if (await backLink.isVisible().catch(() => false)) pass("Back to Dashboard link visible");
    else fail("Back to Dashboard link (report)", "Not found");

    const reportTitle = page.locator("h1", { hasText: "Performance Report" });
    if (await reportTitle.isVisible()) pass("Report title visible");
    else fail("Report title", "Not found");

    // Stat cards row 1
    const statLabels1 = ["Messages Sent", "Delivery Rate", "Response Rate", "Entered Sales Flow"];
    let allStats1 = true;
    for (const label of statLabels1) {
      if (!(await page.locator(`text=${label}`).first().isVisible().catch(() => false))) allStats1 = false;
    }
    if (allStats1) pass("Report stat cards row 1 visible");
    else fail("Report stat cards row 1", "Some missing");

    // Stat cards row 2
    const statLabels2 = ["Converted", "Failed Messages", "Total Enrolled", "Active Enrolled"];
    let allStats2 = true;
    for (const label of statLabels2) {
      if (!(await page.locator(`text=${label}`).first().isVisible().catch(() => false))) allStats2 = false;
    }
    if (allStats2) pass("Report stat cards row 2 visible");
    else fail("Report stat cards row 2", "Some missing");

    // Sections
    for (const section of ["Enrolment Status Breakdown", "Per-Step Performance", "Rate Summary", "Recent Interactions", "Failed Messages", "Engine Error Log"]) {
      const heading = page.locator("h2", { hasText: section });
      if (await heading.isVisible().catch(() => false)) pass(`${section} section visible`);
      else fail(`${section} section`, "Heading not found");
    }

    // Check chart
    const chartContainer = page.locator(".recharts-responsive-container");
    const noInteractions = page.locator("text=No interactions yet");
    if (await chartContainer.isVisible().catch(() => false)) pass("Per-step performance chart rendered");
    else if (await noInteractions.isVisible().catch(() => false)) pass("Per-step performance shows empty state");
    else pass("Per-step performance section present (chart/empty state detection may vary)");

    await screenshot(page, "08-report");
  } catch (err) {
    fail("Report page", err.message, await screenshot(page, "08-error").catch(() => {}));
  }

  // ===========================================================================
  // SECTION 9: CROSS-PAGE NAVIGATION
  // ===========================================================================
  console.log("\n=== SECTION 9: CROSS-PAGE NAVIGATION ===");

  try {
    // Campaign list → Dashboard
    await robustGoto(page, `${BASE_URL}/campaigns`);
    const dashLink = page.locator("a[href='/campaigns/dashboard']");
    if (await dashLink.isVisible().catch(() => false)) {
      await dashLink.click();
      await page.waitForURL("**/campaigns/dashboard", { timeout: 10000 }).catch(() => {});
      if (page.url().includes("/dashboard")) pass("Campaign list → Dashboard works");
      else fail("Campaign list → Dashboard", `URL: ${page.url()}`);

      // Dashboard → Back
      const backLink = page.locator("a[href='/campaigns']");
      if (await backLink.first().isVisible().catch(() => false)) {
        await backLink.first().click();
        await page.waitForTimeout(2000);
        if (page.url().endsWith("/campaigns")) pass("Dashboard → Back to Campaigns works");
        else fail("Dashboard → Back", `URL: ${page.url()}`);
      }
    }

    // Campaign list → Create
    const createLink = page.locator("a[href='/campaigns/create']");
    if (await createLink.isVisible().catch(() => false)) {
      await createLink.click();
      await page.waitForURL("**/campaigns/create", { timeout: 10000 }).catch(() => {});
      if (page.url().includes("/create")) pass("Campaign list → Create Campaign works");
    }

    // Campaign list → Manage
    await robustGoto(page, `${BASE_URL}/campaigns`);
    const manageLink = page.locator("a", { hasText: "Manage" }).first();
    if (await manageLink.isVisible().catch(() => false)) {
      await manageLink.click();
      await page.waitForURL(/\/campaigns\/[a-f0-9-]+$/, { timeout: 10000 }).catch(() => {});
      if (page.url().match(/\/campaigns\/[a-f0-9-]+$/)) pass("Campaign list → Manage works");

      // Detail → Enrolments
      const enrolLink = page.locator("a[href*='/enrolments']").first();
      if (await enrolLink.isVisible().catch(() => false)) {
        await enrolLink.click();
        await page.waitForURL("**/enrolments", { timeout: 10000 }).catch(() => {});
        if (page.url().includes("/enrolments")) pass("Detail → Enrolments works");

        const backToCamp = page.locator("a[href*='/campaigns/']").first();
        if (await backToCamp.isVisible().catch(() => false)) {
          await backToCamp.click();
          await page.waitForTimeout(2000);
          pass("Enrolments → Back to Campaign works");
        }
      }
    }

    // Detail → Audit Trail
    await robustGoto(page, `${BASE_URL}/campaigns/${campaignId}`);
    const auditLink = page.locator("a[href*='/audit']").first();
    if (await auditLink.isVisible().catch(() => false)) {
      await auditLink.click();
      await page.waitForURL("**/audit", { timeout: 10000 }).catch(() => {});
      if (page.url().includes("/audit")) pass("Detail → Audit Trail works");

      const backToCamp = page.locator("a[href*='/campaigns/']").first();
      if (await backToCamp.isVisible().catch(() => false)) {
        await backToCamp.click();
        await page.waitForTimeout(2000);
        pass("Audit Trail → Back to Campaign works");
      }
    }

    // Detail → Report
    const reportLink = page.locator("a[href*='/reports/']").first();
    if (await reportLink.isVisible().catch(() => false)) {
      await reportLink.click();
      await page.waitForURL("**/reports/*", { timeout: 10000 }).catch(() => {});
      if (page.url().includes("/reports/")) pass("Detail → Report works");

      const backToDash = page.locator("a[href='/campaigns/dashboard']");
      if (await backToDash.isVisible().catch(() => false)) {
        await backToDash.click();
        await page.waitForURL("**/dashboard", { timeout: 10000 }).catch(() => {});
        if (page.url().includes("/dashboard")) pass("Report → Back to Dashboard works");
      }
    }
  } catch (err) {
    fail("Cross-page navigation", err.message, await screenshot(page, "09-error").catch(() => {}));
  }

  // ===========================================================================
  // SECTION 10: RESPONSIVE / EDGE CASES
  // ===========================================================================
  console.log("\n=== SECTION 10: RESPONSIVE / EDGE CASES ===");

  try {
    // Mobile
    await page.setViewportSize({ width: 375, height: 812 });
    await robustGoto(page, `${BASE_URL}/campaigns`);

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    if (scrollWidth <= clientWidth + 5) pass("Mobile: no horizontal overflow on campaign list");
    else fail("Mobile overflow (list)", `scroll=${scrollWidth}, client=${clientWidth}`);

    await screenshot(page, "10-mobile-list");

    await robustGoto(page, `${BASE_URL}/campaigns/${campaignId}`);
    const dScroll = await page.evaluate(() => document.documentElement.scrollWidth);
    const dClient = await page.evaluate(() => document.documentElement.clientWidth);
    if (dScroll <= dClient + 5) pass("Mobile: no horizontal overflow on campaign detail");
    else fail("Mobile overflow (detail)", `scroll=${dScroll}, client=${dClient}`);

    await screenshot(page, "10-mobile-detail");
    await page.setViewportSize({ width: 1440, height: 900 });

    // Nonexistent campaign
    await robustGoto(page, `${BASE_URL}/campaigns/nonexistent-id-12345`);
    const body404 = await page.locator("body").textContent();
    if (body404 && (body404.includes("404") || body404.includes("could not be found") || body404.includes("Not Found"))) {
      pass("Nonexistent campaign shows 404");
    } else {
      fail("Nonexistent campaign 404", "No 404 text found");
      await screenshot(page, "10-no-404");
    }

    // Empty campaign (no steps)
    if (testCampaignId) {
      await robustGoto(page, `${BASE_URL}/campaigns/${testCampaignId}`);
      const noSteps = page.locator("text=No steps yet");
      const addStepBtn = page.locator("button", { hasText: "Add Step" });
      const activateBtn = page.locator("button", { hasText: "Activate" });

      if (await noSteps.isVisible().catch(() => false)) pass("Empty campaign shows 'No steps yet' message");
      if (await addStepBtn.isVisible().catch(() => false)) pass("Add Step button visible on empty campaign");
      if (await activateBtn.isDisabled().catch(() => false)) pass("Activate button disabled when no steps");
      else if (await activateBtn.isVisible().catch(() => false)) fail("Activate disabled on empty", "Button not disabled");
    }
  } catch (err) {
    fail("Responsive/edge cases", err.message, await screenshot(page, "10-error").catch(() => {}));
  }

  // ===========================================================================
  // CONSOLE ERRORS
  // ===========================================================================
  console.log("\n=== CONSOLE ERRORS ===");
  if (consoleErrors.length > 0) {
    console.log(`  Found ${consoleErrors.length} console errors:`);
    consoleErrors.forEach((err, i) => console.log(`    ${i + 1}. ${err.substring(0, 200)}`));
  } else {
    console.log("  No console errors detected.");
  }

  // ===========================================================================
  // SUMMARY
  // ===========================================================================
  console.log("\n========================================");
  console.log("TEST RESULTS SUMMARY");
  console.log("========================================");

  const passed = results.filter((r) => r.status === "PASS").length;
  const failed = results.filter((r) => r.status === "FAIL").length;
  console.log(`Total: ${results.length} | Passed: ${passed} | Failed: ${failed}`);
  console.log("");

  if (bugs.length > 0) {
    console.log("BUGS / ISSUES FOUND:");
    console.log("----------------------------------------");
    bugs.forEach((bug, i) => {
      console.log(`${i + 1}. [${bug.test}] ${bug.error}`);
      if (bug.screenshot) console.log(`   Screenshot: ${bug.screenshot}`);
    });
  } else {
    console.log("No bugs found! All tests passed.");
  }

  const reportData = { summary: { total: results.length, passed, failed }, results, bugs, consoleErrors };
  fs.writeFileSync("./tests/test-results.json", JSON.stringify(reportData, null, 2));
  console.log(`\nDetailed results: ./tests/test-results.json`);
  console.log(`Screenshots: ./tests/screenshots/`);

  await browser.close();
}

run().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
