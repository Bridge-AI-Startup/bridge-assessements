import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { behavioralInfo } from "./log.js";

/**
 * Shared Playwright session across behavioral checks (C).
 * Each check gets a fresh browser context for cookie/storage isolation (G).
 */
export class BehavioralBrowserSession {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  readonly launchError: string | null;

  constructor() {
    if (
      process.env.BEHAVIORAL_SKIP_BROWSER === "1" ||
      process.env.BEHAVIORAL_SKIP_BROWSER === "true"
    ) {
      this.launchError =
        "[browser disabled] BEHAVIORAL_SKIP_BROWSER is set; use read_file, run_command, and curl instead of browser_* tools.";
    } else {
      this.launchError = null;
    }
  }

  async getPage(baseUrl: string): Promise<Page> {
    if (this.launchError) {
      throw new Error(this.launchError);
    }
    if (!baseUrl?.trim()) {
      throw new Error("No baseUrl");
    }
    if (!this.browser) {
      try {
        this.browser = await chromium.launch({ headless: true });
        behavioralInfo("browser_session_launch", {});
      } catch (e) {
        const raw = e instanceof Error ? e.message : String(e);
        throw new Error(
          `[browser unavailable] ${raw}\nOn this host install Chromium for Playwright: cd server && npx playwright install chromium`
        );
      }
    }
    if (!this.page) {
      await this.resetIsolation();
    }
    return this.page!;
  }

  /** New context + page — clears cookies, localStorage, and in-memory UI state. */
  async resetIsolation(): Promise<void> {
    if (this.page) {
      try {
        await this.page.close();
      } catch {
        /* ignore */
      }
      this.page = null;
    }
    if (this.context) {
      try {
        await this.context.close();
      } catch {
        /* ignore */
      }
      this.context = null;
    }
    if (!this.browser) return;
    this.context = await this.browser.newContext({
      viewport: { width: 1280, height: 720 },
    });
    this.page = await this.context.newPage();
    behavioralInfo("browser_context_reset", {});
  }

  async close(): Promise<void> {
    try {
      await this.page?.close();
    } catch {
      /* ignore */
    }
    this.page = null;
    try {
      await this.context?.close();
    } catch {
      /* ignore */
    }
    this.context = null;
    try {
      await this.browser?.close();
    } catch {
      /* ignore */
    }
    this.browser = null;
  }
}
