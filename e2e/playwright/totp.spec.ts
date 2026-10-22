import { createHmac } from 'node:crypto';
import { type Browser, type BrowserContext, expect, type Page, test } from '@playwright/test';
import { registerServerAvailabilityCheck } from './helpers/test-helpers';

// Two-factor (TOTP) end to end against the QA stack. qa-compose.yml configures a
// throwaway key ring and a dedicated `totp-e2e` Basic account for this spec.
// Enrolling ends every session of the account, so it must never be `admin`,
// whose storageState every other spec shares. The whole flow is one serial run
// because each step depends on the factor state the one before it left behind,
// and it ends with the factor removed so a re-run against the same stack starts
// from a clean account.

registerServerAvailabilityCheck(test);

test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ mode: 'serial' });
test.setTimeout(240_000);

const USERNAME = 'totp-e2e';
const PASSWORD = 'totp-e2e-password';
const STEP_SECONDS = 30;
const SKEW_STEPS = 1;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(encoded: string): Buffer {
  const clean = encoded.replaceAll(/[\s=]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) {
      throw new Error('Setup key is not base32');
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** RFC 4226 HOTP over HMAC-SHA1, six digits. */
function hotp(secret: Buffer, counter: number): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', secret).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const truncated =
    ((digest[offset] & 0x7f) << 24) |
    (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) |
    digest[offset + 3];
  return String(truncated % 1_000_000).padStart(6, '0');
}

function currentCounter(): number {
  return Math.floor(Date.now() / 1000 / STEP_SECONDS);
}

/**
 * Drydock accepts a counter only if it is newer than the last one it accepted,
 * within one step of the clock. So each call hands out the oldest still-valid
 * counter that hasn't been spent, and waits for the next step when all three
 * are used.
 */
class Authenticator {
  private lastCounter = -1;

  constructor(private readonly secret: Buffer) {}

  async nextCode(): Promise<string> {
    for (;;) {
      const now = currentCounter();
      const counter = Math.max(this.lastCounter + 1, now - SKEW_STEPS);
      if (counter <= now + SKEW_STEPS) {
        this.lastCounter = counter;
        return hotp(this.secret, counter);
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }

  /** Six digits that match no counter inside the accepted window. */
  wrongCode(): string {
    const now = currentCounter();
    const valid = new Set<string>();
    for (let offset = -SKEW_STEPS; offset <= SKEW_STEPS; offset += 1) {
      valid.add(hotp(this.secret, now + offset));
    }
    for (let counter = now + 1000; ; counter += 1) {
      const candidate = hotp(this.secret, counter);
      if (!valid.has(candidate)) {
        return candidate;
      }
    }
  }
}

async function submitPassword(page: Page): Promise<void> {
  await page.goto('/login');
  await expect(page.getByPlaceholder('Enter your username')).toBeVisible({ timeout: 15_000 });
  await page.getByPlaceholder('Enter your username').fill(USERNAME);
  await page.getByPlaceholder('Enter your password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

async function expectSignedIn(page: Page): Promise<void> {
  await expect(page).toHaveURL('/', { timeout: 20_000 });
  await expect(page.locator('main')).toContainText('Updates Available');
}

async function loginWithPasswordOnly(page: Page): Promise<void> {
  await submitPassword(page);
  await expectSignedIn(page);
}

async function reachChallenge(page: Page): Promise<void> {
  await submitPassword(page);
  await expect(page.getByRole('heading', { name: 'Two-step verification' })).toBeVisible({
    timeout: 20_000,
  });
}

async function submitChallengeCode(page: Page, code: string): Promise<void> {
  await page.locator('#totp-code').fill(code);
  await page.getByRole('button', { name: 'Verify', exact: true }).click();
}

async function submitRecoveryCode(page: Page, recoveryCode: string): Promise<void> {
  await page.getByTestId('login-challenge-recovery').click();
  await page.locator('#recovery-code').fill(recoveryCode);
  await page.getByRole('button', { name: 'Verify', exact: true }).click();
}

async function signOut(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'User menu' }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });
}

async function openProfile(page: Page): Promise<void> {
  await page.goto('/config?tab=profile');
  await expect(page.getByTestId('totp-status')).toBeVisible({ timeout: 20_000 });
}

/** Status of the event stream for the page's session, without holding it open. */
async function eventStreamStatus(page: Page): Promise<number> {
  return await page.evaluate(async () => {
    const controller = new AbortController();
    try {
      const response = await fetch('/api/v1/events/ui', {
        credentials: 'include',
        signal: controller.signal,
      });
      return response.status;
    } finally {
      controller.abort();
    }
  });
}

async function sessionStatus(page: Page): Promise<number> {
  return (await page.request.get('/auth/user')).status();
}

async function newSignedInPage(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await loginWithPasswordOnly(page);
  return { context, page };
}

test.describe('Two-factor authentication', () => {
  let authenticator: Authenticator;
  let recoveryCodes: string[] = [];
  let usedRecoveryCode = '';
  let otherContext: BrowserContext | undefined;
  let otherPage: Page;

  test.afterAll(async () => {
    await otherContext?.close();
  });

  test('a session opened before enrollment works, including the event stream', async ({
    browser,
  }) => {
    ({ context: otherContext, page: otherPage } = await newSignedInPage(browser));
    expect(await sessionStatus(otherPage)).toBe(200);
    expect(await eventStreamStatus(otherPage)).toBe(200);
  });

  test('enrolls from the profile tab and shows the recovery codes once', async ({ page }) => {
    await loginWithPasswordOnly(page);
    await openProfile(page);
    await expect(page.getByTestId('totp-status')).toContainText('Off');

    await page.getByTestId('totp-enable').click();
    await page.getByTestId('totp-password').fill(PASSWORD);
    await page.getByTestId('totp-reauth-submit').click();

    const secretText = (await page.getByTestId('totp-secret').innerText()).trim();
    authenticator = new Authenticator(base32Decode(secretText));

    await page.getByTestId('totp-confirm-code').fill(await authenticator.nextCode());
    await page.getByTestId('totp-confirm-submit').click();

    await expect(page.getByTestId('totp-codes-panel')).toBeVisible({ timeout: 20_000 });
    recoveryCodes = (await page.getByTestId('totp-codes').locator('li').allInnerTexts()).map(
      (code) => code.trim(),
    );
    expect(recoveryCodes).toHaveLength(10);
    expect(new Set(recoveryCodes).size).toBe(10);

    await page.getByTestId('totp-saved').check();
    await page.getByTestId('totp-done').click();
    await expect(page.getByTestId('totp-notice')).toContainText('Two-factor authentication is on.');
    await expect(page.getByTestId('totp-status')).toContainText('10 recovery codes left');
  });

  test('ends the session that existed before activation, and the stream refuses it', async () => {
    expect(await sessionStatus(otherPage)).toBe(401);
    expect(await eventStreamStatus(otherPage)).toBe(401);
    await otherPage.reload();
    await expect(otherPage).toHaveURL(/\/login/, { timeout: 20_000 });
  });

  test('a password alone no longer signs in, and a wrong code is refused', async ({ page }) => {
    await reachChallenge(page);
    expect(await sessionStatus(page)).toBe(401);

    await submitChallengeCode(page, authenticator.wrongCode());
    await expect(page.getByText("That code didn't work. Check it and try again.")).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Two-step verification' })).toBeVisible();
    expect(await sessionStatus(page)).toBe(401);
  });

  test('signs in with a code, and refuses the same code on the next sign-in', async ({ page }) => {
    const code = await authenticator.nextCode();

    await reachChallenge(page);
    await submitChallengeCode(page, code);
    await expectSignedIn(page);
    expect(await sessionStatus(page)).toBe(200);
    expect(await eventStreamStatus(page)).toBe(200);
    await signOut(page);

    await reachChallenge(page);
    await submitChallengeCode(page, code);
    await expect(page.getByText("That code didn't work. Check it and try again.")).toBeVisible();
    expect(await sessionStatus(page)).toBe(401);
  });

  test('signs in with a recovery code and the code is consumed', async ({ page }) => {
    usedRecoveryCode = recoveryCodes[0];

    await reachChallenge(page);
    await submitRecoveryCode(page, usedRecoveryCode);
    await expectSignedIn(page);
    expect(await sessionStatus(page)).toBe(200);
    await signOut(page);

    await reachChallenge(page);
    await submitRecoveryCode(page, usedRecoveryCode);
    await expect(page.getByText("That code didn't work. Check it and try again.")).toBeVisible();
    expect(await sessionStatus(page)).toBe(401);
  });

  test('disables TOTP, and the account signs in with its password alone again', async ({
    page,
  }) => {
    await reachChallenge(page);
    await submitChallengeCode(page, await authenticator.nextCode());
    await expectSignedIn(page);

    await openProfile(page);
    await expect(page.getByTestId('totp-status')).toContainText('9 recovery codes left');

    await page.getByTestId('totp-remove').click();
    await page.getByTestId('totp-password').fill(PASSWORD);
    await page.getByTestId('totp-proof').fill(await authenticator.nextCode());
    await page.getByTestId('totp-reauth-submit').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Turn off', exact: true }).click();

    await expect(page.getByTestId('totp-notice')).toContainText(
      'Two-factor authentication is off.',
    );
    await expect(page.getByTestId('totp-status')).toContainText('Off');

    // Removing the factor ends the account's sessions, this one included.
    await page.context().clearCookies();
    await loginWithPasswordOnly(page);
  });
});
