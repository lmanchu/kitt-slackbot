/**
 * Tachikoma Heartbeat System
 *
 * 讓 Agent 從「被動響應」變成「主動助理」
 * 定期讀取 HEARTBEAT.md，AI 智能判斷是否需要執行任務
 *
 * 靈感來源：Clawdbot Heartbeat 架構
 */

const fs = require('fs');
const path = require('path');

const HEARTBEAT_DIR = path.join(process.env.HOME, '.ai-butler-system/tachikoma/heartbeat');
const STATE_FILE = path.join(process.env.HOME, '.ai-butler-system/tachikoma/heartbeat-state.json');
const HEARTBEAT_TOKEN = 'HEARTBEAT_OK';

const DEFAULT_CONFIG = {
  interval: 30 * 60 * 1000,  // 30 分鐘
  activeHours: { start: 8, end: 22 },  // 08:00-22:00
  timezone: 'Asia/Taipei',
  maxAckChars: 50,  // HEARTBEAT_OK 回覆長度上限
};

class Heartbeat {
  /**
   * @param {Object} options
   * @param {string} options.agentId - Agent ID (e.g., 'kitt', 'wells')
   * @param {string} options.workspaceId - Slack workspace ID (e.g., 'lmanagents', 'irixion')
   * @param {string} options.channel - Slack channel to post heartbeat reports
   * @param {Object} options.slackClient - Slack WebClient instance
   * @param {string} options.persona - Agent persona description for AI
   * @param {number} [options.interval] - Check interval in ms (default: 30 min)
   * @param {Object} [options.activeHours] - Active hours { start, end }
   */
  constructor(options) {
    this.agentId = options.agentId;
    this.workspaceId = options.workspaceId || 'default';
    this.channel = options.channel;
    this.slackClient = options.slackClient;
    this.persona = options.persona || '';
    this.interval = options.interval || DEFAULT_CONFIG.interval;
    this.activeHours = options.activeHours || DEFAULT_CONFIG.activeHours;

    this.timer = null;
    this.isRunning = false;
    this.lastRun = null;
    this.lastResult = null;

    // CLIProxyAPI settings (using fetch)
    this.apiUrl = process.env.CLIPROXY_URL || 'http://127.0.0.1:8317/v1';
    this.apiKey = process.env.CLIPROXY_API_KEY || 'magi-proxy-key-2026';
    this.model = process.env.CLIPROXY_MODEL || 'gemini-2.5-flash';

    // 確保目錄存在
    this._ensureDir();
  }

  _ensureDir() {
    if (!fs.existsSync(HEARTBEAT_DIR)) {
      fs.mkdirSync(HEARTBEAT_DIR, { recursive: true });
    }
  }

  /**
   * 取得 HEARTBEAT.md 檔案路徑
   */
  getHeartbeatFile() {
    return path.join(HEARTBEAT_DIR, `${this.agentId}.md`);
  }

  /**
   * 檢查是否在活躍時段
   */
  isWithinActiveHours() {
    const now = new Date();
    const hour = parseInt(now.toLocaleString('en-US', {
      timeZone: DEFAULT_CONFIG.timezone,
      hour: '2-digit',
      hour12: false
    }));
    return hour >= this.activeHours.start && hour < this.activeHours.end;
  }

  /**
   * 檢查內容是否為空（只有標題、空列表等）
   */
  isContentEmpty(content) {
    if (!content) return true;
    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      // 跳過 markdown 標題
      if (/^#+(\s|$)/.test(trimmed)) continue;
      // 跳過空的列表項目
      if (/^[-*+]\s*(\[[\sXx]?\]\s*)?$/.test(trimmed)) continue;
      // 跳過註解
      if (trimmed.startsWith('<!--') && trimmed.endsWith('-->')) continue;
      // 找到實際內容
      return false;
    }
    return true;
  }

  /**
   * 讀取 HEARTBEAT.md 內容
   */
  async readHeartbeatContent() {
    try {
      const filePath = this.getHeartbeatFile();
      if (!fs.existsSync(filePath)) {
        return null;
      }
      return fs.readFileSync(filePath, 'utf-8');
    } catch (error) {
      console.error(`[HEARTBEAT] ${this.agentId}: Failed to read file -`, error.message);
      return null;
    }
  }

  /**
   * 判斷 AI 回覆是否為「無事可做」
   */
  isHeartbeatOk(reply) {
    if (!reply) return true;
    const trimmed = reply.trim();
    // 移除 markdown 格式
    const normalized = trimmed
      .replace(/<[^>]*>/g, ' ')
      .replace(/\*\*/g, '')
      .replace(/`/g, '')
      .trim();

    if (normalized.includes(HEARTBEAT_TOKEN)) {
      // 如果只有 HEARTBEAT_OK 和少量文字，視為無事
      const withoutToken = normalized.replace(HEARTBEAT_TOKEN, '').trim();
      return withoutToken.length <= DEFAULT_CONFIG.maxAckChars;
    }
    return false;
  }

  /**
   * 執行一次 Heartbeat 檢查
   */
  async runOnce() {
    const startTime = Date.now();
    const instanceId = `${this.agentId}@${this.workspaceId}`;

    // 1. 檢查是否在活躍時段
    if (!this.isWithinActiveHours()) {
      console.log(`[HEARTBEAT] ${instanceId}: Skipped (quiet hours)`);
      return { status: 'skipped', reason: 'quiet-hours' };
    }

    // 2. 讀取 HEARTBEAT.md
    const content = await this.readHeartbeatContent();

    // 3. 檢查是否有任務
    if (content === null) {
      console.log(`[HEARTBEAT] ${instanceId}: Skipped (file not found)`);
      return { status: 'skipped', reason: 'file-not-found' };
    }

    if (this.isContentEmpty(content)) {
      console.log(`[HEARTBEAT] ${instanceId}: Skipped (empty content)`);
      return { status: 'skipped', reason: 'empty-content' };
    }

    // 4. 呼叫 AI 處理
    const currentTime = new Date().toLocaleString('zh-TW', {
      timeZone: DEFAULT_CONFIG.timezone,
      dateStyle: 'full',
      timeStyle: 'short'
    });

    const prompt = `你是 ${this.agentId.toUpperCase()}。這是定期 Heartbeat 檢查。

${this.persona}

---
## HEARTBEAT.md 任務清單

${content}

---
**當前時間**: ${currentTime}
**Workspace**: ${this.workspaceId}

## 指示
1. 閱讀上面的任務清單
2. 判斷現在是否有任務需要執行或報告
3. 如果**沒有**需要處理的任務，只回覆: HEARTBEAT_OK
4. 如果**有**任務需要執行或報告，直接執行並簡短報告結果
5. 不要重複或推測之前對話的任務，只根據 HEARTBEAT.md 的內容判斷`;

    try {
      const response = await fetch(`${this.apiUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 1024,
          temperature: 0.3,
        }),
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const reply = data.choices?.[0]?.message?.content || '';
      const durationMs = Date.now() - startTime;

      // 5. 判斷是否需要通知
      if (this.isHeartbeatOk(reply)) {
        console.log(`[HEARTBEAT] ${instanceId}: OK (${durationMs}ms)`);
        this.lastRun = Date.now();
        this.lastResult = { status: 'ok', durationMs };
        this._saveState();
        return { status: 'ok', durationMs };
      }

      // 6. 有任務結果，發送到 Slack
      if (this.channel && this.slackClient) {
        await this.slackClient.chat.postMessage({
          channel: this.channel,
          text: `🫀 *Heartbeat Report*\n\n${reply}`,
          unfurl_links: false,
        });
        console.log(`[HEARTBEAT] ${instanceId}: Sent report to ${this.channel} (${durationMs}ms)`);
      } else {
        console.log(`[HEARTBEAT] ${instanceId}: Report generated but no channel configured`);
        console.log(reply);
      }

      this.lastRun = Date.now();
      this.lastResult = { status: 'sent', durationMs, preview: reply.slice(0, 100) };
      this._saveState();

      return { status: 'sent', durationMs, message: reply };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      console.error(`[HEARTBEAT] ${instanceId}: Failed (${durationMs}ms) -`, error.message);
      this.lastResult = { status: 'failed', durationMs, error: error.message };
      return { status: 'failed', durationMs, error: error.message };
    }
  }

  /**
   * 啟動定期 Heartbeat
   */
  start() {
    if (this.isRunning) {
      console.log(`[HEARTBEAT] ${this.agentId}@${this.workspaceId}: Already running`);
      return;
    }

    const intervalMin = Math.round(this.interval / 60000);
    console.log(`[HEARTBEAT] ${this.agentId}@${this.workspaceId}: Started (every ${intervalMin} min)`);

    this.isRunning = true;

    // 延遲 1 分鐘後執行第一次（避免啟動時立即執行）
    setTimeout(() => {
      if (this.isRunning) {
        this.runOnce();
      }
    }, 60 * 1000);

    // 設定定期執行
    this.timer = setInterval(() => {
      if (this.isRunning) {
        this.runOnce();
      }
    }, this.interval);

    // 允許 Node.js 在沒有其他任務時退出
    if (this.timer.unref) {
      this.timer.unref();
    }
  }

  /**
   * 停止 Heartbeat
   */
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
    console.log(`[HEARTBEAT] ${this.agentId}@${this.workspaceId}: Stopped`);
  }

  /**
   * 手動觸發一次 Heartbeat
   */
  async trigger() {
    console.log(`[HEARTBEAT] ${this.agentId}@${this.workspaceId}: Manual trigger`);
    return this.runOnce();
  }

  /**
   * 取得狀態
   */
  getStatus() {
    return {
      agentId: this.agentId,
      workspaceId: this.workspaceId,
      isRunning: this.isRunning,
      interval: this.interval,
      lastRun: this.lastRun,
      lastResult: this.lastResult,
      heartbeatFile: this.getHeartbeatFile(),
      channel: this.channel,
    };
  }

  /**
   * 保存狀態到檔案
   */
  _saveState() {
    try {
      let state = {};
      if (fs.existsSync(STATE_FILE)) {
        state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
      }
      const key = `${this.agentId}@${this.workspaceId}`;
      state[key] = {
        lastRun: this.lastRun,
        lastResult: this.lastResult,
        updatedAt: Date.now(),
      };
      fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    } catch (error) {
      console.error('[HEARTBEAT] Failed to save state:', error.message);
    }
  }
}

/**
 * 讀取所有 Heartbeat 狀態
 */
function getAllHeartbeatStatus() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
    }
  } catch (error) {
    console.error('[HEARTBEAT] Failed to read state:', error.message);
  }
  return {};
}

module.exports = { Heartbeat, getAllHeartbeatStatus, HEARTBEAT_DIR, HEARTBEAT_TOKEN };
