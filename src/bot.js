const { Telegraf, Markup } = require('telegraf');
const ReferralScraper = require('./scraper');
const LinkChecker = require('./link-checker');
const config = require('./config');

// ✅ REMOVED: No need for Puppeteer on Replit
// Session generation will be skipped, we'll use cookies from .env

class ReferralBot {
  constructor() {
    if (!config.telegram.token) {
      throw new Error('TELEGRAM_BOT_TOKEN is required in .env file');
    }

    this.bot = new Telegraf(config.telegram.token);
    this.userScrapers = new Map();
    this.userLocks = new Map();
    this.linkChecker = new LinkChecker();
    this.userStates = new Map();

    this.setupCommands();
    this.setupHandlers();
  }

  getScraper(userId) {
    if (!this.userScrapers.has(userId)) {
      this.userScrapers.set(userId, new ReferralScraper());
    }
    return this.userScrapers.get(userId);
  }

  // Create a FRESH scraper instance (force new to clear cache)
  getFreshScraper() {
    return new ReferralScraper();
  }

  setupCommands() {
    this.bot.command(config.commands.start, (ctx) => {
      const welcomeMessage = `
🤖 *Referral Link Bot*

*Available Features:*
✅ Get referral link
✅ View statistics & downline summary
✅ Check link accessibility (single/bulk)
✅ Check custom links with DNS validation
✅ ISP blocking detection

Developed with ❤️ for referral management.
      `;

      ctx.replyWithMarkdown(welcomeMessage, Markup.keyboard([
        ['📋 Get Referral Link', '📊 Statistics'],
        ['🔍 Check Link', '🔗 Check All Links'],
        ['🔎 Check Custom Link', 'ℹ️ Help']
      ]).resize());
    });

    this.bot.command(config.commands.getlink, async (ctx) => {
      await this.showAccountSelection(ctx, 'getlink');
    });

    this.bot.command(config.commands.stats, async (ctx) => {
      await this.showAccountSelection(ctx, 'stats');
    });

    this.bot.command('checklink', async (ctx) => {
      await this.showAccountSelection(ctx, 'checklink');
    });

    this.bot.command('checkalllinks', async (ctx) => {
      await this.showAccountSelection(ctx, 'checkalllinks');
    });

    this.bot.command(config.commands.help, (ctx) => {
      ctx.replyWithMarkdown(`
*Available Commands:*

📋 */getlink* - Fetch the latest referral link
📊 */stats* - Get referral statistics
🔍 */checklink* - Check single link
🔗 */checkalllinks* - Check all downline links (bulk report)
ℹ️ */help* - Show this message

*Quick Buttons:*
Use the keyboard below for quick access.
      `);
    });
  }

  setupHandlers() {
    this.bot.hears('📋 Get Referral Link', async (ctx) => {
      await this.showAccountSelection(ctx, 'getlink');
    });

    this.bot.hears('📊 Statistics', async (ctx) => {
      await this.showAccountSelection(ctx, 'stats');
    });

    this.bot.hears('🔍 Check Link', async (ctx) => {
      await this.showAccountSelection(ctx, 'checklink');
    });

    this.bot.hears('🔗 Check All Links', async (ctx) => {
      await this.showAccountSelection(ctx, 'checkalllinks');
    });

    this.bot.hears('🔎 Check Custom Link', async (ctx) => {
      await this.handleCustomLinkPrompt(ctx);
    });

    this.bot.hears('ℹ️ Help', (ctx) => {
      ctx.replyWithMarkdown(`
*Available Features:*

📋 *Get Referral Link* - Fetch your referral link
📊 *Statistics* - View stats & downline summary
🔍 *Check Link* - Check main referral link status
🔗 *Check All Links* - Bulk report of all links
🔎 *Check Custom Link* - Check any URL you want

*How to use:*
Just click the buttons below or use /start to see the menu.
      `);
    });

    this.bot.hears('❌ Cancel', (ctx) => {
      const userId = ctx.from.id;
      this.userStates.delete(userId);

      ctx.replyWithMarkdown('Cancelled. Choose an action:', Markup.keyboard([
        ['📋 Get Referral Link', '📊 Statistics'],
        ['🔍 Check Link', '🔗 Check All Links'],
        ['🔎 Check Custom Link', 'ℹ️ Help']
      ]).resize());
    });

    this.bot.on('text', async (ctx) => {
      const userId = ctx.from.id;
      const userState = this.userStates.get(userId);

      if (userState && userState.waitingForLink === true) {
        const inputText = ctx.message.text.trim();

        if (this.isValidUrl(inputText)) {
          await this.handleCustomLinkCheck(ctx, inputText);
        } else {
          ctx.replyWithMarkdown(`❌ *Invalid URL*\n\nPlease enter a valid URL starting with \`http://\` or \`https://\``);
        }
      }
    });

    this.bot.catch((err, ctx) => {
      console.error(`Error for ${ctx.updateType}:`, err);
      ctx.reply('❌ An error occurred. Please try again later.');

      if (config.telegram.adminId) {
        this.bot.telegram.sendMessage(
          config.telegram.adminId,
          `⚠️ Bot Error:\n${err.message}\nUpdate: ${JSON.stringify(ctx.update)}`
        );
      }
    });
  }

  async handleGetLink(ctx, scraper) {
    try {
      await ctx.replyWithChatAction('typing');
      const message = await ctx.reply('🔄 Fetching referral link...');

      const result = await scraper.getReferralData();

      if (result.success) {
        const { referralLink, statistics } = result.data;

        const responseMessage = `
✅ *Referral Link Successfully Fetched*

🔗 *Link:* \`${referralLink}\`

📊 *Statistics:*
• Total Players: ${statistics.totalPlayers.toLocaleString()}
• Active This Week: ${statistics.activePlayers.toLocaleString()}

⏰ *Last Updated:* ${new Date().toLocaleString()}

*Click the button below to copy:*
        `;

        await ctx.telegram.editMessageText(
          ctx.chat.id,
          message.message_id,
          null,
          responseMessage,
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              Markup.button.url('🌐 Open Link', referralLink),
              Markup.button.callback('📋 Copy Link', 'copy_link'),
            ])
          }
        );

        const currentState = this.userStates.get(ctx.from.id) || {};
        this.userStates.set(ctx.from.id, { ...currentState, referralLink });

      } else {
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          message.message_id,
          null,
          `❌ *Failed to fetch referral link*\n\nError: ${result.error}\n\nPlease try again later.`,
          { parse_mode: 'Markdown' }
        );
      }

    } catch (error) {
      console.error('Error in handleGetLink:', error);
      ctx.reply('❌ An unexpected error occurred. Please try again.');
    }
  }

  async handleStats(ctx, scraper) {
    try {
      await ctx.replyWithChatAction('typing');

      const [refResult, downlineResult] = await Promise.all([
        scraper.getReferralData(),
        scraper.getDownlineData()
      ]);

      if (refResult.success && downlineResult.success) {
        const { statistics, commissions } = refResult.data;
        const { totalDownlines, totalTurnover, totalKomisi } = downlineResult.data;

        let commissionsText = '';
        if (commissions && commissions.length > 0) {
          commissionsText = commissions.map(c => `• ${c}`).join('\n');
        }

        const statsMessage = `
📊 *Referral Statistics*

👥 *Player Stats:*
• Total Registered: ${statistics.totalPlayers.toLocaleString()}
• Active This Week: ${statistics.activePlayers.toLocaleString()}

💰 *Commission Rates:*
${commissionsText || 'No commission data available'}

📈 *Downline Summary:*
• Total Downlines: ${totalDownlines}
• Total Turnover Sementara: ${totalTurnover.toLocaleString()}
• Total Komisi: ${totalKomisi.toLocaleString()}

🔄 *Last Updated:* ${new Date().toLocaleString()}

Use /getlink to get your referral link.
        `;

        ctx.replyWithMarkdown(statsMessage);

      } else {
        const errors = [];
        if (!refResult.success) errors.push(`Referral: ${refResult.error}`);
        if (!downlineResult.success) errors.push(`Downline: ${downlineResult.error}`);

        ctx.replyWithMarkdown(`❌ *Failed to fetch statistics*\n\n${errors.join('\n')}`);
      }

    } catch (error) {
      console.error('Error in handleStats:', error);
      ctx.reply('❌ Failed to fetch statistics.');
    }
  }

  async handleCheckLink(ctx, scraper) {
    try {
      await ctx.replyWithChatAction('typing');

      const result = await scraper.getReferralData();

      if (result.success) {
        const { referralLink } = result.data;

        const checkingMessage = await ctx.reply('🔍 Checking link accessibility with multiple DNS servers...\n\n(This may take a moment)');

        const statusResult = await this.linkChecker.checkLinkStatus(referralLink);
        const statusMessage = this.linkChecker.formatStatusMessage(statusResult);

        await ctx.telegram.editMessageText(
          ctx.chat.id,
          checkingMessage.message_id,
          null,
          statusMessage,
          { parse_mode: 'Markdown' }
        );

      } else {
        ctx.replyWithMarkdown(`❌ *Failed to fetch referral link*\n\nError: ${result.error}`);
      }

    } catch (error) {
      console.error('Error in handleCheckLink:', error);
      ctx.reply('❌ Failed to check link status.');
    }
  }

  async handleCheckAllLinks(ctx, scraper) {
    try {
      const userId = ctx.from.id;
      let userState = this.userStates.get(userId) || {};

      if (!userState.sessionLinks) {
        userState.sessionLinks = new Set();
      }

      if (userState.isChecking) {
        userState.isChecking = false;
        this.userStates.set(userId, userState);
        return ctx.reply('🛑 Menghentikan proses pemindaian...');
      }

      userState.isChecking = true;
      this.userStates.set(userId, userState);

      await ctx.replyWithChatAction('typing');
      const statusMsg = await ctx.reply('🔄 Tahap 1: Memancing link baru (Fishing)...');

      const MAX_REFRESHES = 10;
      let foundNew = 0;

      for (let i = 0; i < MAX_REFRESHES; i++) {
        if (!this.userStates.get(userId)?.isChecking) break;

        await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, null, `🔄 Tahap 1: Memancing link (${i + 1}/${MAX_REFRESHES})...\nLink unik saat ini: ${userState.sessionLinks.size}`);

        const result = await scraper.getReferralData();
        if (result.success && result.data.referralLink) {
          if (!userState.sessionLinks.has(result.data.referralLink)) {
            userState.sessionLinks.add(result.data.referralLink);
            foundNew++;
          }
        }
        await new Promise(r => setTimeout(r, 800));
      }

      const allLinksArray = Array.from(userState.sessionLinks);

      if (allLinksArray.length === 0) {
        userState.isChecking = false;
        this.userStates.set(userId, userState);
        await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, null, '❌ Tidak ada link ditemukan.');
        return;
      }

      await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, null, `🔍 Tahap 2: Mengecek status ${allLinksArray.length} link unik...`);

      const bulkResult = await this.linkChecker.checkMultipleLinks(allLinksArray);
      const report = this.linkChecker.formatBulkReport(bulkResult);

      const footer = `✨ Baru: ${foundNew} | Total Unik: ${allLinksArray.length}`;

      await ctx.telegram.editMessageText(
        ctx.chat.id,
        statusMsg.message_id,
        null,
        `${report}\n\n${footer}\n\n✅ Selesai. Klik lagi untuk memancing lebih banyak!`,
        { parse_mode: 'Markdown' }
      );

      userState.isChecking = false;
      this.userStates.set(userId, userState);

    } catch (error) {
      console.error('Error in handleCheckAllLinks:', error);
      const userId = ctx.from.id;
      const state = this.userStates.get(userId);
      if (state) {
        state.isChecking = false;
        this.userStates.set(userId, state);
      }
      ctx.reply('❌ Terjadi kesalahan pada sistem pengecekan.');
    }
  }

  async handleCustomLinkPrompt(ctx) {
    try {
      const userId = ctx.from.id;

      const currentState = this.userStates.get(userId) || {};
      this.userStates.set(userId, { ...currentState, waitingForLink: true });

      ctx.replyWithMarkdown(`
🔎 *Check Custom Link*

Please send me the URL you want to check.

*Example:*
\`https://example.com\`
\`http://mysite.com/path\`

I will check if it's accessible and detect any ISP blocking.
      `, Markup.keyboard([['❌ Cancel']]).resize());

    } catch (error) {
      console.error('Error in handleCustomLinkPrompt:', error);
      ctx.reply('❌ Failed to process request.');
    }
  }

  async handleCustomLinkCheck(ctx, url) {
    try {
      const userId = ctx.from.id;

      this.userStates.delete(userId);

      await ctx.replyWithChatAction('typing');

      const checkingMessage = await ctx.reply(`🔍 Checking your link...\n\n\`${url}\`\n\n(This may take a moment)`);

      const statusResult = await this.linkChecker.checkLinkStatus(url);
      const statusMessage = this.linkChecker.formatStatusMessage(statusResult);

      await ctx.telegram.editMessageText(
        ctx.chat.id,
        checkingMessage.message_id,
        null,
        statusMessage,
        { parse_mode: 'Markdown' }
      );

      ctx.replyWithMarkdown('Choose an action:', Markup.keyboard([
        ['📋 Get Referral Link', '📊 Statistics'],
        ['🔍 Check Link', '🔗 Check All Links'],
        ['🔎 Check Custom Link', 'ℹ️ Help']
      ]).resize());

    } catch (error) {
      console.error('Error in handleCustomLinkCheck:', error);
      ctx.reply('❌ Failed to check link.');
    }
  }

  isValidUrl(input) {
    try {
      const urlObj = new URL(input);
      return urlObj.protocol === 'http:' || urlObj.protocol === 'https:';
    } catch {
      return false;
    }
  }

  async showAccountSelection(ctx, action) {
    const buttons = Object.keys(config.accounts).map(accountName => 
      Markup.button.callback(accountName, `select_account:${action}:${accountName}`)
    );

    const rows = [];
    for (let i = 0; i < buttons.length; i += 2) {
      rows.push(buttons.slice(i, i + 2));
    }

    await ctx.reply('👤 *Pilih Akun:*', {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(rows)
    });
  }

  setupCallbacks() {
    // Account selection handler
    this.bot.action(/select_account:(.+):(.+)/, async (ctx) => {
      try {
        const userId = ctx.from.id;
        const action = ctx.match[1];
        const accountName = ctx.match[2];

        const accounts = config.accounts;
        const accountData = accounts[accountName];

        if (!accountData || !accountData.cookie) {
          return ctx.answerCbQuery('❌ Cookie untuk akun ini belum diatur di .env', { show_alert: true });
        }

        if (!this.userLocks.has(userId)) {
          this.userLocks.set(userId, false);
        }

        while (this.userLocks.get(userId)) {
          await new Promise(r => setTimeout(r, 100));
        }

        this.userLocks.set(userId, true);

        console.log(`[BOT] User ${userId} switching to account: ${accountName}`);

        // ✅ Create FRESH scraper instance to avoid cache issues
        const scraper = this.getFreshScraper();
        scraper.setAccountData(accountData, accountName);

        await ctx.answerCbQuery(`Menggunakan akun: ${accountName}`);

        // Execute original action
        try {
          switch (action) {
            case 'getlink':
              await this.handleGetLink(ctx, scraper);
              break;
            case 'stats':
              await this.handleStats(ctx, scraper);
              break;
            case 'checklink':
              await this.handleCheckLink(ctx, scraper);
              break;
            case 'checkalllinks':
              await this.handleCheckAllLinks(ctx, scraper);
              break;
          }
        } finally {
          this.userLocks.set(userId, false);
        }

      } catch (err) {
        const userId = ctx.from.id;
        this.userLocks.set(userId, false);
        console.error('Error in select_account callback:', err);
        ctx.answerCbQuery('❌ Gagal berpindah akun. Silakan coba lagi.');
      }
    });

    this.bot.action('copy_link', (ctx) => {
      const userId = ctx.from.id;
      const userState = this.userStates.get(userId);

      if (userState && userState.referralLink) {
        ctx.answerCbQuery();
        ctx.reply(`Link copied to clipboard:\n\`${userState.referralLink}\``, {
          parse_mode: 'Markdown'
        });
      } else {
        ctx.answerCbQuery('Link not found. Please fetch again.', { show_alert: true });
      }
    });
  }

  start() {
    this.setupCallbacks();

    this.bot.launch().then(() => {
      console.log('🤖 Bot is running...');
      console.log(`📊 Admin ID: ${config.telegram.adminId || 'Not set'}`);
      console.log(`🌐 Target URL: ${config.website.baseUrl}`);
      console.log(`📝 Session Generation: DISABLED (Using .env cookies)`);

      process.once('SIGINT', () => this.bot.stop('SIGINT'));
      process.once('SIGTERM', () => this.bot.stop('SIGTERM'));
    }).catch(err => {
      console.error('Failed to start bot:', err);
      process.exit(1);
    });
  }
}

// Start the bot
const bot = new ReferralBot();
bot.start();