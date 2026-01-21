const cloudscraper = require('cloudscraper');
const cheerio = require('cheerio');
const config = require('./config');

class ReferralScraper {
  constructor() {
    this.currentCookie = config.website.headers['Cookie'];
    this.instanceId = Math.random().toString(36).substring(7);
    this.requestTimestamp = Date.now(); // Force unique requests

    this.userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1'
    ];
    this.currentUserAgent = this.userAgents[0];
    this.updateOptions();
  }

  setAccountData(accountData, accountName) {
    // ✅ Force fresh instance by updating ALL critical properties
    this.currentCookie = accountData.cookie;
    this.currentAccountName = accountName;
    this.currentReferer = accountData.referer;
    this.currentParams = accountData.params;

    // ✅ Generate new IDs to bypass cache
    this.instanceId = Math.random().toString(36).substring(7);
    this.requestTimestamp = Date.now();

    console.log(`[SCRAPER] Setting account data for: ${accountName} (ID: ${this.instanceId})`);

    // Create fresh options
    this.updateOptions();
  }

  updateOptions() {
    const baseUrl = config.website.baseUrl + config.website.referralPath;

    const queryParams = new URLSearchParams();
    queryParams.append('act', 'referral');
    queryParams.append('_v', this.instanceId); // Cache buster
    queryParams.append('_t', this.requestTimestamp); // ✅ Add timestamp to guarantee unique URL

    if (this.currentParams) {
      const extra = new URLSearchParams(this.currentParams);
      for (const [key, value] of extra) {
        queryParams.set(key, value);
      }
    }

    const url = `${baseUrl.split('?')[0]}?${queryParams.toString()}`;

    let hash = 0;
    if (this.currentAccountName) {
      for (let i = 0; i < this.currentAccountName.length; i++) {
        hash = ((hash << 5) - hash) + this.currentAccountName.charCodeAt(i);
        hash |= 0;
      }
    }
    const index = Math.abs(hash) % this.userAgents.length;
    const userAgent = this.userAgents[index];

    this.cloudscraperOptions = {
      method: 'GET',
      url: url,
      headers: {
        ...config.website.headers,
        'Cookie': this.currentCookie || '',
        'User-Agent': userAgent,
        'Referer': this.currentReferer || config.website.headers['Referer'],
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      },
      jar: false,
      challengesToSolve: 3,
      decodeEmails: false,
      followAllRedirects: true,
      cloudflareTimeout: 30000,
      cloudflareMaxTimeout: 60000, // ✅ Reduce timeout
      agentOptions: {
        keepAlive: false,
      },
    };

    console.log(`[SCRAPER] Updated options for ${this.currentAccountName}, URL: ${url.substring(0, 80)}...`);
  }

  async fetchWithRetry(retryCount = 0) {
    try {
      console.log(`[SCRAPER] Attempt ${retryCount + 1} to fetch for ${this.currentAccountName}...`);

      const response = await cloudscraper(this.cloudscraperOptions);

      if (!response) {
        throw new Error('Empty response from server');
      }

      console.log(`[SCRAPER] ✅ Got response for ${this.currentAccountName} (${response.length} bytes)`);
      return this.parseHTML(response);

    } catch (error) {
      console.error(`[SCRAPER] ❌ Attempt ${retryCount + 1} failed for ${this.currentAccountName}:`, error.message);

      if (retryCount < config.retry.maxRetries - 1) {
        const delay = Math.min(
          config.retry.initialDelay * Math.pow(2, retryCount),
          config.retry.maxDelay
        );

        console.log(`[SCRAPER] Retrying in ${delay / 1000} seconds...`);
        await this.sleep(delay);

        return this.fetchWithRetry(retryCount + 1);
      } else {
        throw new Error(`Failed after ${config.retry.maxRetries} attempts: ${error.message}`);
      }
    }
  }

  parseHTML(html) {
    const $ = cheerio.load(html);

    let referralLink = $('.refxxcode i').text().trim();

    if (!referralLink) {
      referralLink = $('span.refxxcode i').text().trim();
    }

    if (!referralLink) {
      const refSpan = $('span.refxxcode').text().trim();
      referralLink = refSpan.split('\n')[0] || '';
    }

    if (!referralLink) {
      const match = html.match(/https:\/\/[^\s<>"]+\?ref=[^\s<>"]+/);
      referralLink = match ? match[0] : '';
    }

    if (!referralLink && this.currentAccountName && this.currentParams) {
      const refMatch = this.currentParams.match(/userid=([^&]+)/);
      if (refMatch && refMatch[1]) {
        referralLink = `${config.website.baseUrl}/register?ref=${refMatch[1]}`;
        console.log(`[SCRAPER] Auto-generated referral link for ${this.currentAccountName}: ${referralLink}`);
      }
    }

    if (!referralLink) {
      console.log(`[SCRAPER] DEBUG: HTML content (first 1000 chars):`);
      console.log(html.substring(0, 1000));
      throw new Error('Referral link not found in HTML');
    }

    let totalPlayers = 0;
    let activePlayers = 0;

    $('.rchist-panel div').each((index, element) => {
      const text = $(element).text().trim();
      const valueSpan = $(element).find('span').last().text().trim();

      if (text.includes('Total Players Register')) {
        totalPlayers = parseInt(valueSpan.replace(/\./g, '')) || totalPlayers;
      } else if (text.includes('Total Active Minggu Ini')) {
        activePlayers = parseInt(valueSpan.replace(/\./g, '')) || activePlayers;
      }
    });

    if (totalPlayers === 0) {
      $('span').each((index, element) => {
        const $element = $(element);
        const text = $element.text().trim();

        if (text.includes('Total Players') || text.includes('Total Registered')) {
          const $parent = $element.parent();
          const nextSpan = $parent.find('span').last().text().trim();
          totalPlayers = parseInt(nextSpan.replace(/\./g, '')) || parseInt(text.match(/\d+/) ? text.match(/\d+/)[0] : 0);
        } else if (text.includes('Total Active') || text.includes('Minggu Ini')) {
          const $parent = $element.parent();
          const nextSpan = $parent.find('span').last().text().trim();
          activePlayers = parseInt(nextSpan.replace(/\./g, '')) || parseInt(text.match(/\d+/) ? text.match(/\d+/)[0] : 0);
        }
      });
    }

    const commissions = [];
    $('#refCommBnsPanel, .table-responsive').find('div[style*="border"]').each((index, element) => {
      const $element = $(element);
      const allText = $element.text();
      const spans = $element.find('span');

      if (spans.length >= 2) {
        const gameType = spans.eq(0).text().trim();
        const rate = spans.eq(1).text().trim();
        if (gameType && rate && gameType.length > 0 && rate.length > 0 && !gameType.includes('border')) {
          commissions.push(`${gameType}: ${rate}`);
        }
      }
    });

    // ✅ Log which account this data belongs to
    console.log(`[SCRAPER] ✅ Parsed data for ${this.currentAccountName}: link=${referralLink.substring(0, 50)}... total=${totalPlayers}`);

    return {
      referralLink,
      statistics: {
        totalPlayers: totalPlayers,
        activePlayers: activePlayers,
      },
      commissions,
      timestamp: new Date().toISOString(),
      account: this.currentAccountName, // ✅ Include account name in result
      rawHtml: html.substring(0, 500) + '...',
    };
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async getReferralData() {
    try {
      console.log(`[SCRAPER] Fetching referral data for: ${this.currentAccountName}`);
      const data = await this.fetchWithRetry();
      console.log(`[SCRAPER] ✅ Successfully fetched for: ${this.currentAccountName}`);
      return {
        success: true,
        data: data,
        account: this.currentAccountName
      };
    } catch (error) {
      console.error(`[SCRAPER] ❌ Failed for ${this.currentAccountName}: ${error.message}`);
      return {
        success: false,
        error: error.message,
        account: this.currentAccountName,
        timestamp: new Date().toISOString(),
      };
    }
  }

  async fetchDownlineData(retryCount = 0) {
    try {
      console.log(`[SCRAPER] Fetching downline for: ${this.currentAccountName} (ID: ${this.instanceId})`);

      const downlineUrl = config.website.baseUrl + '/auth/x_ajaxer-v2.php';

      const queryParams = new URLSearchParams();
      queryParams.append('act', 'refDownlinePanel');
      queryParams.append('_v', this.instanceId);
      queryParams.append('_t', this.requestTimestamp); // ✅ Add timestamp

      if (this.currentParams) {
        const extraParams = new URLSearchParams(this.currentParams);
        for (const [key, value] of extraParams) {
          queryParams.append(key, value);
        }
      }

      const finalUrl = `${downlineUrl}?${queryParams.toString()}`;

      const options = {
        ...this.cloudscraperOptions,
        url: finalUrl,
        headers: {
          ...this.cloudscraperOptions.headers,
          'Cookie': this.currentCookie || ''
        },
        jar: false,
        agentOptions: { keepAlive: false }
      };

      const response = await cloudscraper(options);

      if (!response) {
        throw new Error('Empty response from server');
      }

      return this.parseDownlineHTML(response);

    } catch (error) {
      console.error(`[SCRAPER] ❌ Downline attempt ${retryCount + 1} failed for ${this.currentAccountName}:`, error.message);

      if (retryCount < config.retry.maxRetries - 1) {
        const delay = Math.min(
          config.retry.initialDelay * Math.pow(2, retryCount),
          config.retry.maxDelay
        );

        console.log(`[SCRAPER] Retrying downline in ${delay / 1000} seconds...`);
        await this.sleep(delay);

        return this.fetchDownlineData(retryCount + 1);
      } else {
        throw new Error(`Failed after ${config.retry.maxRetries} attempts: ${error.message}`);
      }
    }
  }

  parseDownlineHTML(html) {
    const $ = cheerio.load(html);

    const downlines = [];
    let totalTurnover = 0;
    let totalKomisi = 0;

    $('tr[data-ref]').each((index, element) => {
      const $row = $(element);
      const tds = $row.find('td');

      if (tds.length >= 4) {
        const no = $(tds[0]).text().trim();
        const userId = $(tds[1]).text().trim();
        const turnoverText = $(tds[2]).text().trim();
        const komisiText = $(tds[3]).text().trim();

        const turnover = parseInt(turnoverText.replace(/\./g, '')) || 0;
        const komisi = parseInt(komisiText.replace(/\./g, '')) || 0;

        downlines.push({
          no: parseInt(no),
          userId,
          turnover,
          komisi
        });

        totalTurnover += turnover;
        totalKomisi += komisi;
      }
    });

    console.log(`[SCRAPER] ✅ Parsed downline for ${this.currentAccountName}: ${downlines.length} records`);

    return {
      totalDownlines: downlines.length,
      totalTurnover,
      totalKomisi,
      downlines,
      timestamp: new Date().toISOString(),
    };
  }

  async getDownlineData() {
    try {
      const data = await this.fetchDownlineData();
      console.log(`[SCRAPER] ✅ Successfully fetched downline for: ${this.currentAccountName}`);
      return {
        success: true,
        data: data,
      };
    } catch (error) {
      console.error(`[SCRAPER] ❌ Failed to get downline for ${this.currentAccountName}:`, error);
      return {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }
}

module.exports = ReferralScraper;