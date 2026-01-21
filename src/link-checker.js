const dns = require('dns').promises;
const axios = require('axios');
const url = require('url');

class LinkChecker {
  constructor() {
    this.dnsServers = {
      telkom: { name: 'Telkom Indonesia', ips: ['202.134.0.155', '202.134.67.66'] },
    };
  }

  async checkDNS(hostname, dnsServerIp) {
    try {
      const resolver = new dns.Resolver();
      resolver.setServers([dnsServerIp]);
      const addresses = await resolver.resolve4(hostname);
      return {
        success: true,
        ips: addresses,
        error: null
      };
    } catch (error) {
      return {
        success: false,
        ips: [],
        error: error.message
      };
    }
  }

  async checkHTTPAccess(targetUrl, timeout = 10000) {
    try {
      const response = await axios.get(targetUrl, {
        timeout: timeout,
        maxRedirects: 3,
        validateStatus: function (status) {
          return status >= 200 && status < 500;
        }
      });
      
      if (response.status < 400) {
        return {
          success: true,
          statusCode: response.status,
          accessible: true,
          error: null
        };
      } else {
        return {
          success: false,
          statusCode: response.status,
          accessible: false,
          error: `HTTP ${response.status}`
        };
      }
    } catch (error) {
      return {
        success: false,
        statusCode: null,
        accessible: false,
        error: error.message
      };
    }
  }

  async checkLinkStatus(targetUrl, timeout = 30000) {
    try {
      const parsedUrl = new url.URL(targetUrl);
      const hostname = parsedUrl.hostname;

      console.log(`Checking link status for: ${targetUrl}`);

      // Create timeout promise
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Check timeout')), timeout)
      );

      // Check DNS resolution in parallel for all servers
      const dnsPromises = {};
      for (const [key, dnsConfig] of Object.entries(this.dnsServers)) {
        dnsPromises[key] = Promise.all(
          dnsConfig.ips.map(ip => this.checkDNS(hostname, ip))
        ).then(results => {
          const resultObj = {};
          dnsConfig.ips.forEach((ip, idx) => {
            resultObj[ip] = results[idx];
          });
          return resultObj;
        }).catch(err => {
          const resultObj = {};
          dnsConfig.ips.forEach(ip => {
            resultObj[ip] = { success: false, ips: [], error: err.message };
          });
          return resultObj;
        });
      }

      // Wait for DNS checks with timeout
      const dnsResults = {};
      for (const [key, promise] of Object.entries(dnsPromises)) {
        dnsResults[key] = await Promise.race([
          promise,
          timeoutPromise
        ]).catch(err => {
          const resultObj = {};
          const ips = this.dnsServers[key].ips;
          ips.forEach(ip => {
            resultObj[ip] = { success: false, ips: [], error: 'timeout' };
          });
          return resultObj;
        });
      }

      // Check HTTP accessibility with shorter timeout
      const httpResult = await Promise.race([
        this.checkHTTPAccess(targetUrl, 10000),
        timeoutPromise
      ]).catch(err => ({
        success: false,
        statusCode: null,
        accessible: false,
        error: 'timeout'
      }));

      // Analyze results
      const analysis = this.analyzeResults(hostname, dnsResults, httpResult);

      return {
        success: true,
        hostname: hostname,
        url: targetUrl,
        dnsResults: dnsResults,
        httpResult: httpResult,
        analysis: analysis,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      return {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  analyzeResults(hostname, dnsResults, httpResult) {
    const analysis = {
      dnsResolvable: {},
      httpAccessible: httpResult.accessible,
      blockedByISP: false,
      blockedByFilter: false,
      status: 'UNKNOWN'
    };

    // Check DNS resolution for each provider
    for (const [provider, servers] of Object.entries(dnsResults)) {
      const resolved = Object.values(servers).some(result => result.success);
      analysis.dnsResolvable[provider] = resolved;
    }

    // Detect ISP blocking
    const telkomResolved = analysis.dnsResolvable.telkom;
    const otherResolved = analysis.dnsResolvable.google || analysis.dnsResolvable.cloudflare;

    if (otherResolved && !telkomResolved) {
      analysis.blockedByISP = true;
      analysis.status = '🚫 BLOCKED_BY_TELKOM';
    } else if (telkomResolved && !httpResult.accessible) {
      analysis.blockedByFilter = true;
      analysis.status = '⚠️ FILTERED_CONTENT';
    } else if (telkomResolved && httpResult.accessible) {
      analysis.status = '✅ ACCESSIBLE';
    } else if (!telkomResolved && !otherResolved) {
      analysis.status = '❌ NOT_RESOLVABLE';
    }

    return analysis;
  }

  formatStatusMessage(checkResult) {
    if (!checkResult.success) {
      return `❌ Error checking link: ${checkResult.error}`;
    }

    const analysis = checkResult.analysis;
    let message = `🔍 *Link Status Check*\n\n`;
    message += `🔗 *URL:* \`${checkResult.url}\`\n`;
    message += `📍 *Hostname:* \`${checkResult.hostname}\`\n\n`;

    message += `*DNS Resolution Status:*\n`;
    message += `• Telkom: ${analysis.dnsResolvable.telkom ? '✅ Resolved' : '❌ Blocked'}\n`;
    message += `• Google: ${analysis.dnsResolvable.google ? '✅ Resolved' : '❌ Failed'}\n`;
    message += `• Cloudflare: ${analysis.dnsResolvable.cloudflare ? '✅ Resolved' : '❌ Failed'}\n\n`;

    message += `*HTTP Access:*\n`;
    if (checkResult.httpResult.accessible) {
      message += `✅ Accessible (HTTP ${checkResult.httpResult.statusCode})\n\n`;
    } else {
      message += `❌ Not Accessible (${checkResult.httpResult.error})\n\n`;
    }

    message += `*Overall Status:*\n`;
    if (analysis.status === '✅ ACCESSIBLE') {
      message += `✅ Link is *fully accessible* - no blocking detected\n`;
    } else if (analysis.status === '🚫 BLOCKED_BY_TELKOM') {
      message += `🚫 Link appears to be *blocked by Telkom ISP*\n`;
      message += `(Resolves via Google/Cloudflare but not Telkom DNS)\n`;
    } else if (analysis.status === '⚠️ FILTERED_CONTENT') {
      message += `⚠️ Link is *filtered as blocked content*\n`;
      message += `(Resolves DNS but HTTP access is denied)\n`;
    } else if (analysis.status === '❌ NOT_RESOLVABLE') {
      message += `❌ Link is *not resolvable* - domain may be down\n`;
    }

    message += `\n⏰ *Checked at:* ${new Date(checkResult.timestamp).toLocaleString()}`;

    return message;
  }

  async checkMultipleLinks(urls, onProgress = null) {
    const results = {
      accessible: [],
      blockedByISP: [],
      filtered: [],
      notResolvable: [],
      errors: [],
      timestamp: new Date().toISOString()
    };

    for (let i = 0; i < urls.length; i++) {
      try {
        const result = await this.checkLinkStatus(urls[i], 25000);
        
        if (result.success) {
          const analysis = result.analysis;
          const summary = {
            url: urls[i],
            hostname: result.hostname,
            status: analysis.status
          };

          if (analysis.status === '✅ ACCESSIBLE') {
            results.accessible.push(summary);
          } else if (analysis.status === '🚫 BLOCKED_BY_TELKOM') {
            results.blockedByISP.push(summary);
          } else if (analysis.status === '⚠️ FILTERED_CONTENT') {
            results.filtered.push(summary);
          } else if (analysis.status === '❌ NOT_RESOLVABLE') {
            results.notResolvable.push(summary);
          }
        } else {
          results.errors.push({
            url: urls[i],
            error: result.error
          });
        }

        if (onProgress) {
          onProgress(i + 1, urls.length);
        }
      } catch (error) {
        results.errors.push({
          url: urls[i],
          error: error.message
        });
      }
    }

    return results;
  }

  formatBulkReport(results) {
    let message = `🔍 *Link Status Report*\n`;
    message += `📊 Total Checked: ${results.accessible.length + results.blockedByISP.length + results.filtered.length + results.notResolvable.length + results.errors.length}\n\n`;

    if (results.accessible.length > 0) {
      message += `✅ *ACCESSIBLE (${results.accessible.length}):*\n`;
      results.accessible.forEach(item => {
        message += `  • ${item.hostname}\n`;
      });
      message += '\n';
    }

    if (results.blockedByISP.length > 0) {
      message += `🚫 *BLOCKED BY TELKOM ISP (${results.blockedByISP.length}):*\n`;
      results.blockedByISP.forEach(item => {
        message += `  • ${item.hostname}\n`;
      });
      message += '\n';
    }

    if (results.filtered.length > 0) {
      message += `⚠️ *FILTERED CONTENT (${results.filtered.length}):*\n`;
      results.filtered.forEach(item => {
        message += `  • ${item.hostname}\n`;
      });
      message += '\n';
    }

    if (results.notResolvable.length > 0) {
      message += `❌ *NOT RESOLVABLE (${results.notResolvable.length}):*\n`;
      results.notResolvable.forEach(item => {
        message += `  • ${item.hostname}\n`;
      });
      message += '\n';
    }

    if (results.errors.length > 0) {
      message += `⚠️ *ERRORS (${results.errors.length}):*\n`;
      results.errors.forEach(item => {
        message += `  • ${item.url}: ${item.error}\n`;
      });
      message += '\n';
    }

    message += `\n⏰ *Checked at:* ${new Date(results.timestamp).toLocaleString()}`;

    return message;
  }
}

module.exports = LinkChecker;
