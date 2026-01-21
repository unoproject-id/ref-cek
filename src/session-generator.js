// IMPORTANT: Use 'puppeteer' NOT 'puppeteer-core'
// If you have puppeteer-core installed, run:
// npm uninstall puppeteer-core
// npm install puppeteer puppeteer-extra puppeteer-extra-plugin-stealth

let puppeteer;
try {
  puppeteer = require('puppeteer-extra');
  const StealthPlugin = require('puppeteer-extra-plugin-stealth');
  puppeteer.use(StealthPlugin());
  console.log('[SESSION] Using puppeteer-extra with Stealth plugin');
} catch (e) {
  console.warn('[SESSION] puppeteer-extra not available, falling back to puppeteer');
  puppeteer = require('puppeteer');
}

const config = require('./config');
const fs = require('fs');

// Find Chrome/Chromium executable
function findChromePath() {
  // Check if running on Replit
  const isReplit = process.env.REPLIT_OWNER !== undefined;

  if (isReplit) {
    console.log('[SESSION] Detected Replit environment');
    // In Replit, chromium is usually here after puppeteer installs it
    const replitPaths = [
      '/home/runner/.cache/puppeteer/chrome/linux-1327075/chrome-linux/chrome',
      '/root/.cache/puppeteer/chrome/linux-1327075/chrome-linux/chrome',
      '/home/runner/.cache/puppeteer/chromium/linux-1327075/chrome-linux/chrome'
    ];

    for (const path of replitPaths) {
      try {
        if (fs.existsSync(path)) {
          console.log(`[SESSION] Found Chromium on Replit at: ${path}`);
          return path;
        }
      } catch (e) {
        // Continue
      }
    }
  }

  const possiblePaths = [
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', // macOS
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',    // Windows
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
  ];

  for (const path of possiblePaths) {
    try {
      if (fs.existsSync(path)) {
        console.log(`[SESSION] Found Chrome at: ${path}`);
        return path;
      }
    } catch (e) {
      // Continue to next path
    }
  }

  console.log('[SESSION] Chrome not found in common paths, will use default');
  return null;
}

async function generateSession(accountName) {
  const account = config.accounts[accountName];
  if (!account || !account.params) {
    throw new Error(`No params found for account: ${accountName}`);
  }

  console.log(`[SESSION] Generating fresh PHPSESSID for ${accountName}...`);

  let browser;
  try {
    // Option 1: Auto-detect Chrome path
    const chromePath = findChromePath();

    const launchConfig = {
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage', // Prevent memory issues
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check'
      ]
    };

    // Tambah executablePath jika Chrome ditemukan
    if (chromePath) {
      launchConfig.executablePath = chromePath;
    }

    console.log('[SESSION] Launching browser...');
    console.log('[SESSION] Launch config:', JSON.stringify({
      headless: launchConfig.headless,
      hasExecutablePath: !!launchConfig.executablePath,
      executablePath: launchConfig.executablePath
    }));

    browser = await puppeteer.launch(launchConfig);

    const page = await browser.newPage();

    // Set viewport dan user agent
    await page.setViewport({ width: 1280, height: 720 });
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    // Construct URL with params
    const baseUrl = config.website.baseUrl + config.website.referralPath;
    const url = `${baseUrl.split('?')[0]}?act=referral&${account.params}`;

    console.log(`[SESSION] Navigating to: ${url}`);

    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    } catch (navError) {
      console.warn(`[SESSION] Navigation warning (continuing): ${navError.message}`);
      // Continue jika timeout atau error, karena session mungkin sudah dibuat
    }

    // Wait for Cloudflare dan redirect
    await new Promise(r => setTimeout(r, 5000));

    // Check current URL (bisa redirect)
    const currentUrl = page.url();
    console.log(`[SESSION] Final URL: ${currentUrl}`);

    // Get all cookies
    const cookies = await page.cookies();
    console.log(`[SESSION] Cookies found: ${cookies.map(c => c.name).join(', ')}`);

    // Find PHPSESSID
    const phpSession = cookies.find(c => c.name === 'PHPSESSID');

    if (phpSession && phpSession.value) {
      console.log(`[SESSION] ✅ Successfully generated PHPSESSID for ${accountName}`);
      console.log(`[SESSION] Session value: ${phpSession.value.substring(0, 20)}...`);

      return {
        success: true,
        cookie: `PHPSESSID=${phpSession.value}`,
        timestamp: new Date().toISOString(),
        account: accountName
      };
    } else {
      // Debug: log HTML untuk lihat apa yang di-return
      const pageContent = await page.content();
      console.log(`[SESSION] Page content (first 500 chars): ${pageContent.substring(0, 500)}`);

      throw new Error('PHPSESSID not found after session request');
    }

  } catch (error) {
    console.error(`[SESSION] ❌ Failed to generate session: ${error.message}`);

    // Provide helpful error messages
    const isReplit = process.env.REPLIT_OWNER !== undefined;

    if (error.message.includes('puppeteer-core')) {
      if (isReplit) {
        console.error(`
[SESSION] ERROR: Puppeteer-core detected on Replit!

FIX FOR REPLIT:

1. Open Replit Shell
2. Run these commands:
   npm uninstall puppeteer-core
   npm install puppeteer puppeteer-extra puppeteer-extra-plugin-stealth

3. Then restart your bot

This will download Chromium compatible with Replit environment.
      `);
      } else {
        console.error(`
[SESSION] ERROR: You're using puppeteer-core without Chrome installed!

Fix this by running ONE of these commands:

1. RECOMMENDED - Install puppeteer (includes Chromium):
   npm uninstall puppeteer-core
   npm install puppeteer puppeteer-extra puppeteer-extra-plugin-stealth

2. OR - Install Chrome/Chromium on your system:
   # Ubuntu/Debian:
   apt-get update && apt-get install -y chromium-browser

   # CentOS/RHEL:
   yum install -y chromium

   # macOS:
   brew install chromium
      `);
      }
    }

    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

async function generateMultipleSessions(accountNames) {
  const results = {};

  for (const accountName of accountNames) {
    try {
      const result = await generateSession(accountName);
      results[accountName] = result;

      // Delay antara akun
      await new Promise(r => setTimeout(r, 2000));
    } catch (error) {
      results[accountName] = {
        success: false,
        error: error.message
      };
    }
  }

  return results;
}

module.exports = { generateSession, generateMultipleSessions };