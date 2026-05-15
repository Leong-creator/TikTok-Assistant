import fs from "node:fs/promises";
import path from "node:path";

function limitText(value, maxChars = 6000) {
  const text = String(value || "").replace(/\s+\n/g, "\n").replace(/[ \t]+/g, " ").trim();
  return text.length > maxChars ? `${text.slice(0, maxChars)}...` : text;
}

async function getLocator(page, action) {
  if (action.selector) {
    return page.locator(action.selector).first();
  }
  if (action.text) {
    return page.getByText(action.text, { exact: Boolean(action.exact) }).first();
  }
  throw new Error(`Action "${action.type}" requires selector or text.`);
}

export async function snapshotPage(page, { maxTextChars = 6000, selector } = {}) {
  const text = selector
    ? await page.locator(selector).first().innerText({ timeout: 5000 })
    : await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  return {
    title: await page.title().catch(() => ""),
    url: page.url(),
    text: limitText(text, maxTextChars)
  };
}

export async function runActions(page, actions = [], { screenshotsDir } = {}) {
  const results = [];

  for (const action of actions) {
    const type = String(action.type || "").toLowerCase();
    const timeout = Number(action.timeoutMs || 10000);

    if (type === "goto") {
      await page.goto(action.url, {
        waitUntil: action.waitUntil || "domcontentloaded",
        timeout
      });
      results.push({ type, url: page.url(), title: await page.title().catch(() => "") });
      continue;
    }

    if (type === "wait") {
      await page.waitForTimeout(Number(action.ms || 1000));
      results.push({ type, ms: Number(action.ms || 1000) });
      continue;
    }

    if (type === "waitfor") {
      if (action.selector) {
        await page.locator(action.selector).first().waitFor({ timeout });
      } else if (action.text) {
        await page.getByText(action.text, { exact: Boolean(action.exact) }).first().waitFor({ timeout });
      } else {
        await page.waitForLoadState(action.state || "domcontentloaded", { timeout });
      }
      results.push({ type, ok: true });
      continue;
    }

    if (type === "click") {
      const locator = await getLocator(page, action);
      await locator.click({ timeout });
      results.push({ type, ok: true });
      continue;
    }

    if (type === "fill" || type === "type") {
      const locator = await getLocator(page, action);
      await locator.fill(String(action.value ?? ""), { timeout });
      results.push({ type, ok: true });
      continue;
    }

    if (type === "press") {
      const locator = await getLocator(page, action);
      await locator.press(String(action.key || "Enter"), { timeout });
      results.push({ type, key: String(action.key || "Enter") });
      continue;
    }

    if (type === "scroll") {
      await page.mouse.wheel(Number(action.x || 0), Number(action.y || 900));
      results.push({ type, x: Number(action.x || 0), y: Number(action.y || 900) });
      continue;
    }

    if (type === "text") {
      const locator = await getLocator(page, action);
      const text = await locator.innerText({ timeout });
      results.push({ type, text: limitText(text, Number(action.maxTextChars || 4000)) });
      continue;
    }

    if (type === "snapshot") {
      results.push({ type, ...(await snapshotPage(page, action)) });
      continue;
    }

    if (type === "screenshot") {
      const filename = action.path
        ? path.resolve(action.path)
        : path.join(screenshotsDir || process.cwd(), `cobrowser-${Date.now()}.png`);
      await fs.mkdir(path.dirname(filename), { recursive: true });
      await page.screenshot({ path: filename, fullPage: action.fullPage !== false });
      results.push({ type, path: filename });
      continue;
    }

    throw new Error(`Unsupported CoBrowser action type: ${action.type}`);
  }

  return results;
}
