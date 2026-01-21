require('dotenv').config();
const dns = require('dns');

// Force IPv4 connections
dns.setDefaultResultOrder('ipv4first');

const config = {
  // Telegram
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN,
    adminId: parseInt(process.env.ADMIN_CHAT_ID) || null,
  },

  // Dynamic Account Detection from Environment Variables
  get accounts() {
    const accountList = {};
    Object.keys(process.env).forEach(key => {
      if (key.startsWith('COOKIE_')) {
        const accountName = key.replace('COOKIE_', '');
        const refererKey = `REFERER_${accountName}`;
        const paramsKey = `PARAMS_${accountName}`;
        
        let cookieValue = process.env[key];
        // If extra params are provided, append them to cookie string if they aren't already there
        // or just store them separately. Scraper will handle merging.
        accountList[accountName] = {
          cookie: cookieValue,
          referer: process.env[refererKey] || `https://${accountName.toLowerCase()}.com/fortune`,
          params: process.env[paramsKey] || ''
        };
      }
    });
    // Fallback if no COOKIE_ keys found
    if (Object.keys(accountList).length === 0 && process.env.SESSION_COOKIE) {
      accountList['DEFAULT'] = {
        cookie: process.env.SESSION_COOKIE,
        referer: process.env.BASE_URL + '/auth/select_game_v2.php',
        params: ''
      };
    }
    return accountList;
  },

  // Website
  website: {
    baseUrl: process.env.BASE_URL,
    referralPath: process.env.REFERRAL_PATH,
    fullUrl: process.env.BASE_URL + process.env.REFERRAL_PATH,
    headers: {
      'Accept': 'text/html, */*; q=0.01',
      'Accept-Encoding': 'identity',
      'Accept-Language': 'id,en-US;q=0.9,en;q=0.8',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
      'X-Requested-With': 'XMLHttpRequest',
      'Referer': process.env.BASE_URL + '/auth/select_game_v2.php',
      'Cookie': process.env.SESSION_COOKIE,
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin',
      'Priority': 'u=1,i',
    },
  },

  // HTTP Agent (Keep-Alive)
  httpsAgent: {
    keepAlive: true,
    maxSockets: 50,
    timeout: 30000, // 30 seconds
  },

  // Retry Configuration
  retry: {
    maxRetries: parseInt(process.env.MAX_RETRIES) || 3,
    initialDelay: parseInt(process.env.INITIAL_RETRY_DELAY) || 2000,
    maxDelay: 30000, // 30 seconds max
  },

  // Bot Commands
  commands: {
    start: 'start',
    getlink: 'getlink',
    stats: 'stats',
    help: 'help',
  },
};

module.exports = config;