#!/usr/bin/env node
/**
 * KITT - Knight Industries Team Tool
 * Multilingual AI collaboration assistant for Slack
 *
 * "A shadowy flight into the dangerous world of team collaboration..."
 */

require('dotenv').config();
const { App } = require('@slack/bolt');
const fs = require('fs');
const path = require('path');

// SQLite Storage Modules
const { initDB, getStats: getDBStats } = require('./storage/database');
const { addMessage, getHistory, clearHistory, formatForPrompt, cleanupExpired } = require('./storage/conversations');
const { createUpdate, getUpdate, getPendingUpdates, getAllUpdates, updateStatus, editUpdate } = require('./storage/updates');

// Long-term Memory System (shared via Dropbox)
const {
  createCandidate,
  getCandidate,
  getPendingCandidates,
  approveCandidate,
  rejectCandidate,
  editCandidateMemories,
  searchMemories,
  getStats: getMemoryStats
} = require('./storage/memory');

// Thread Analyzer
const { analyzeThread, hasMemoryTrigger } = require('./lib/thread-analyzer');

// Message Relay System
const {
  createMessage,
  getMessage,
  markAsRead,
  markAsReplied,
  getPendingMessages
} = require('./storage/messages');

// Initialize Slack App
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
  port: process.env.PORT || 3000
});

// AI Provider Configuration (fallback hierarchy: Gemini → OpenAI → Ollama)
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OLLAMA_API = 'http://localhost:11434/api/generate';
const OLLAMA_MODEL = 'qwen2.5:3b';

// ============ KNOWLEDGE BASE SYSTEM ============

// Knowledge base paths
const KB_BASE_PATH = path.join(process.env.HOME, 'Dropbox/PKM-Vault/1-Projects/IrisGo/Product');
const KB_FILES = {
  product: 'knowledge-base.md',
  customers: 'customers.md',
  roadmap: 'roadmap.md',
  priorities: 'priorities.md',
  resources: 'resources.md',
  pmMemory: 'pm-memory.md'
};

// In-memory knowledge base
let knowledgeBase = {
  product: '',
  customers: '',
  roadmap: '',
  priorities: '',
  resources: '',
  pmMemory: '',
  lastUpdated: null
};

// ============ CONVERSATION MEMORY (SQLite) ============
// Now handled by ./storage/conversations.js
// Functions: addMessage, getHistory, clearHistory, formatForPrompt

/**
 * Load all knowledge base files into memory
 */
function loadKnowledgeBase() {
  try {
    console.log('📚 Loading IrisGo knowledge base...');

    for (const [key, filename] of Object.entries(KB_FILES)) {
      const filePath = path.join(KB_BASE_PATH, filename);

      if (fs.existsSync(filePath)) {
        knowledgeBase[key] = fs.readFileSync(filePath, 'utf8');
        console.log(`  ✓ Loaded ${filename} (${knowledgeBase[key].length} chars)`);
      } else {
        console.warn(`  ⚠️  ${filename} not found, skipping`);
        knowledgeBase[key] = '';
      }
    }

    knowledgeBase.lastUpdated = new Date().toISOString();
    console.log(`✓ Knowledge base loaded at ${knowledgeBase.lastUpdated}`);

  } catch (error) {
    console.error('❌ Failed to load knowledge base:', error.message);
  }
}

/**
 * Watch knowledge base directory for changes
 */
function watchKnowledgeBase() {
  try {
    fs.watch(KB_BASE_PATH, (eventType, filename) => {
      if (filename && filename.endsWith('.md')) {
        console.log(`🔄 Detected change in ${filename}, reloading knowledge base...`);
        loadKnowledgeBase();
      }
    });
    console.log(`👁️  Watching ${KB_BASE_PATH} for changes`);
  } catch (error) {
    console.error('❌ Failed to setup file watcher:', error.message);
  }
}

// Load knowledge base on startup
loadKnowledgeBase();
watchKnowledgeBase();

// ============ PENDING UPDATES SYSTEM (SQLite) ============
// Now handled by ./storage/updates.js
// Functions: createUpdate, getUpdate, getPendingUpdates, updateStatus, editUpdate

const ADMIN_USER_ID = process.env.ADMIN_USER_ID || 'U08MZ609BGX';

/**
 * Rule-based quick check for potential knowledge updates
 * Used as first-pass filter before LLM confirmation
 */
function detectKnowledgeUpdateIntent_RuleBased(text) {
  // 🚫 Query patterns - 如果匹配這些，直接返回 false（不是 knowledge update）
  const queryPatterns = [
    /跟我說|告訴我|說一下|講一下|報告一下/,     // tell me (查詢)
    /目前.*狀態|現在.*狀態|最新.*狀態/,         // current status (查詢)
    /目前.*進度|現在.*進度|最新.*進度/,         // current progress (查詢)
    /準備.*進度|進度.*如何|進度.*怎/,           // preparation progress (查詢)
    /什麼|怎麼|如何|哪裡|哪個|幾時/,            // question words
    /\?|？/,                                   // question mark
  ];

  // 如果是查詢，直接返回 false
  if (queryPatterns.some(pattern => pattern.test(text))) {
    console.log(`[DEBUG] Rule-based: Query pattern detected, NOT a knowledge update`);
    return false;
  }

  // ✅ Update patterns - 必須匹配這些才可能是 knowledge update
  const updatePatterns = [
    /記得|記住|記錄|记得|记住|记录/,           // remember (繁體+簡體)
    /更新.*進度|進度.*更新|update.*progress/i, // progress update (需要動詞)
    /新增|加入|添加|add/i,                     // add
    /邀請了|邀请了|contacted|聯繫了|联系了/i,   // contacted someone (繁體+簡體)
    /已經.*完成|已完成|已经.*完成/,             // completed something
    /狀態.*變成|改為|changed|状态.*变成|改为/i, // status change (繁體+簡體)
    /幫我.*通知|帮我.*通知/,                    // notify request (繁體+簡體)
    /待[辦办]|todo/i,                          // todo item (繁體+簡體)
  ];

  return updatePatterns.some(pattern => pattern.test(text));
}

/**
 * LLM-based confirmation for knowledge update intent
 * Called when rule-based check passes to reduce false positives
 */
async function detectKnowledgeUpdateIntent_LLM(text) {
  try {
    const prompt = `Classify this message intent.

Message: "${text}"

Is this message asking to RECORD/UPDATE new information? Or just ASKING/QUERYING for existing information?

Examples:
- "跟我說一下 CES 進度" → QUERY (asking for info)
- "CES 進度更新：已完成場地確認" → UPDATE (recording new info)
- "告訴我目前狀態" → QUERY
- "狀態變成已完成" → UPDATE

Reply with ONLY one word:
- YES (if recording/updating NEW information)
- NO (if asking/querying for existing info, or general chat)

Answer:`;

    const result = await callAI(prompt, 10);
    const answer = result.trim().toUpperCase();
    console.log(`[DEBUG] LLM intent detection result: "${answer}" for text: "${text.substring(0, 50)}..."`);
    return answer.includes('YES');
  } catch (error) {
    console.error('[ERROR] LLM intent detection failed:', error.message);
    // Fallback to rule-based result (assume true since rule-based already passed)
    return true;
  }
}

/**
 * Hybrid knowledge update detection
 * Step 1: Rule-based quick filter (instant)
 * Step 2: LLM confirmation (if rule-based passes)
 */
async function detectKnowledgeUpdateIntent(text) {
  // Step 1: Quick rule-based check
  const ruleBasedResult = detectKnowledgeUpdateIntent_RuleBased(text);

  if (!ruleBasedResult) {
    // Definitely not a knowledge update
    console.log(`[DEBUG] Rule-based: NOT a knowledge update`);
    return false;
  }

  // Step 2: LLM confirmation for edge cases
  console.log(`[DEBUG] Rule-based: POSSIBLE knowledge update, confirming with LLM...`);
  const llmResult = await detectKnowledgeUpdateIntent_LLM(text);

  return llmResult;
}

/**
 * Detect if admin is making a correction/update to knowledge
 */
function detectAdminCorrectionIntent(text) {
  const correctionPatterns = [
    /修正|糾正|correct/i,       // correction
    /目標是|目標為/,            // target is
    /應該是|應為/,              // should be
    /改[成為]/,                 // change to
    /不是.*而是/,               // not X but Y
    /更正/,                     // amend
  ];

  return correctionPatterns.some(pattern => pattern.test(text));
}

/**
 * Apply admin correction directly to PKM
 * Writes to pm-memory.md 決策脈絡 section
 */
function applyAdminCorrection(text) {
  try {
    let pmContent = knowledgeBase.pmMemory;
    const today = new Date().toISOString().split('T')[0];

    // Find the 決策脈絡 section end (before next ## section)
    const decisionSectionStart = pmContent.indexOf('## 🧠 決策脈絡');
    const nextSectionStart = pmContent.indexOf('\n---\n\n## ', decisionSectionStart + 1);

    if (decisionSectionStart > 0 && nextSectionStart > 0) {
      // Extract key info from correction text
      let title = 'Admin 更新';
      let content = text;

      // Try to extract specific targets
      if (/series\s*a/i.test(text)) {
        title = 'Series A 目標更新';
      } else if (/seed/i.test(text)) {
        title = 'Seed Round 更新';
      } else if (/目標/i.test(text)) {
        title = '目標更新';
      }

      // Create new entry
      const newEntry = `\n### ${title} (${today})\n- **來源**：Admin DM 糾正\n- **內容**：${content}\n`;

      // Insert before the --- separator
      pmContent = pmContent.slice(0, nextSectionStart) + newEntry + pmContent.slice(nextSectionStart);
      fs.writeFileSync(path.join(KB_BASE_PATH, 'pm-memory.md'), pmContent);

      // Update in-memory cache
      knowledgeBase.pmMemory = pmContent;

      console.log(`✓ Admin correction applied: ${title}`);
      return { success: true, title };
    }

    return { success: false, error: 'Could not find 決策脈絡 section' };
  } catch (error) {
    console.error('Error applying admin correction:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Extract knowledge type and target from message
 */
function extractKnowledgeInfo(text) {
  let type = 'general';
  let target = 'Knowledge Update';

  // Detect OEM-related updates
  const oemPatterns = /ASUS|Acer|HP|Dell|Lenovo|Gigabyte|Mouse Computer|OEM/i;
  if (oemPatterns.test(text)) {
    type = 'oem';
    const match = text.match(oemPatterns);
    target = match ? match[0] : 'OEM Update';
  }

  // Detect CES-related updates
  if (/CES|展位|展會|trade\s*show/i.test(text)) {
    type = 'ces';
    target = 'CES Update';
  }

  // Detect contact/invitation updates
  if (/邀請|contacted|聯繫|meeting|會議/i.test(text)) {
    type = 'contact';
    // Try to extract names
    const nameMatch = text.match(/(?:邀請了?|contacted)\s*([^,，。\n]+)/i);
    if (nameMatch) {
      target = nameMatch[1].trim().substring(0, 50);
    }
  }

  return { type, target };
}

/**
 * Notify admin of new pending update via DM
 */
async function notifyAdminOfUpdate(client, update) {
  try {
    // Open DM with admin
    const dmResult = await client.conversations.open({ users: ADMIN_USER_ID });
    const dmChannelId = dmResult.channel.id;

    await client.chat.postMessage({
      channel: dmChannelId,
      text: `New update pending approval`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*📝 New Update Request*\n\n*ID:* \`${update.id}\`\n*Type:* ${update.type}\n*Target:* ${update.target}\n*Value:* ${update.value}\n*From:* <@${update.submittedBy}>\n*Time:* ${update.submittedAt}`
          }
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `_Edit: \`/kitt edit ${update.id} [new target] [new value]\`_`
            }
          ]
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: '✅ Approve' },
              style: 'primary',
              action_id: `approve_update_${update.id}`
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: '✏️ Edit' },
              action_id: `edit_update_${update.id}`
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: '❌ Reject' },
              style: 'danger',
              action_id: `reject_update_${update.id}`
            }
          ]
        }
      ]
    });
    console.log(`📬 Notified admin of update ${update.id}`);
  } catch (error) {
    console.error('Error notifying admin:', error.message);
  }
}

/**
 * Notify user of approval/rejection
 */
async function notifyUserOfResult(client, userId, update, approved) {
  try {
    const dmResult = await client.conversations.open({ users: userId });
    const dmChannelId = dmResult.channel.id;

    const statusEmoji = approved ? '✅' : '❌';
    const statusText = approved ? 'approved and applied' : 'rejected';

    await client.chat.postMessage({
      channel: dmChannelId,
      text: `Your update request has been ${statusText}`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*${statusEmoji} Update ${approved ? 'Approved' : 'Rejected'}*\n\n*ID:* \`${update.id}\`\n*Type:* ${update.type}\n*Target:* ${update.target}\n*Value:* ${update.value}`
          }
        }
      ]
    });
  } catch (error) {
    console.error('Error notifying user:', error.message);
  }
}

// ============ MEMORY SYSTEM FUNCTIONS ============

/**
 * Notify admin of new memory candidate via DM
 */
async function notifyAdminOfMemoryCandidate(client, candidate) {
  try {
    const dmResult = await client.conversations.open({ users: ADMIN_USER_ID });
    const dmChannelId = dmResult.channel.id;

    // Format extracted memories for display
    const memoriesList = candidate.extractedMemories.map((mem, i) => {
      const typeEmoji = {
        decision: '🎯',
        action: '📋',
        preference: '💡',
        fact: '📌',
        context: '📝'
      }[mem.type] || '•';
      return `${typeEmoji} *${mem.type}*: ${mem.content}${mem.context ? ` _(${mem.context})_` : ''}`;
    }).join('\n');

    const threadLink = candidate.threadUrl
      ? `<${candidate.threadUrl}|View Thread>`
      : `Thread: ${candidate.thread_ts}`;

    await client.chat.postMessage({
      channel: dmChannelId,
      text: `New memory candidate pending approval`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*🧠 New Memory Candidate*\n\n*ID:* \`${candidate.id}\`\n*Channel:* #${candidate.channel_name || candidate.channel}\n*Thread:* ${threadLink}\n*From:* <@${candidate.submitted_by}>`
          }
        },
        {
          type: 'divider'
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Extracted Memories (${candidate.extractedMemories.length}):*\n\n${memoriesList}`
          }
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `_These memories will be saved to the shared database if approved._`
            }
          ]
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: '✅ Approve All' },
              style: 'primary',
              action_id: `approve_memory_${candidate.id}`
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: '✏️ Edit' },
              action_id: `edit_memory_${candidate.id}`
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: '❌ Reject' },
              style: 'danger',
              action_id: `reject_memory_${candidate.id}`
            }
          ]
        }
      ]
    });
    console.log(`📬 Notified admin of memory candidate ${candidate.id}`);
  } catch (error) {
    console.error('Error notifying admin of memory:', error.message);
  }
}

/**
 * Process memory trigger from thread
 * Called when user says "@KITT 記住" in a thread
 */
async function processMemoryTrigger(client, channel, threadTs, userId, say) {
  console.log(`[Memory] Processing memory trigger in channel ${channel}, thread ${threadTs}`);

  // Acknowledge the request
  await say({
    text: '🧠 正在分析這個 thread...',
    thread_ts: threadTs
  });

  // Analyze the thread
  const result = await analyzeThread(client, callAI, channel, threadTs, userId);

  if (!result.success) {
    await say({
      text: `❌ 無法分析 thread: ${result.error}`,
      thread_ts: threadTs
    });
    return;
  }

  if (result.data.extractedMemories.length === 0) {
    await say({
      text: '📭 這個 thread 沒有發現需要記住的重點資訊。',
      thread_ts: threadTs
    });
    return;
  }

  // Create memory candidate
  const candidate = createCandidate(result.data);

  // Notify admin
  await notifyAdminOfMemoryCandidate(client, candidate);

  // Confirm to user
  const memCount = result.data.extractedMemories.length;
  await say({
    text: `✅ 已提取 ${memCount} 條記憶，已通知管理員審核。\n\nID: \`${candidate.id}\``,
    thread_ts: threadTs
  });
}

// ============ MESSAGE RELAY SYSTEM ============

/**
 * Check if message contains relay trigger
 * e.g., "幫我轉達給 Lman", "跟老闆說", "Tell Lman"
 */
function hasRelayTrigger(text) {
  const triggers = [
    /幫我(轉達|傳達|告訴|跟).*(Lman|老闆|boss)/i,
    /跟(Lman|老闆|boss)說/i,
    /(轉達|傳達|告訴|通知).*(Lman|老闆|boss)/i,
    /tell\s+(Lman|the\s+boss)/i,
    /message\s+for\s+(Lman|the\s+boss)/i,
    /let\s+(Lman|the\s+boss)\s+know/i,
    /(Lman|老闆).*幫我(轉達|說)/i
  ];

  return triggers.some(pattern => pattern.test(text));
}

/**
 * Extract the actual message to relay (remove trigger words)
 */
function extractRelayMessage(text) {
  // Remove common trigger patterns to get the actual message
  let message = text
    .replace(/<@[A-Z0-9]+>/g, '') // Remove @mentions
    .replace(/幫我(轉達|傳達|告訴|跟).*(Lman|老闆|boss)[，,：:]*\s*/gi, '')
    .replace(/跟(Lman|老闆|boss)說[，,：:]*\s*/gi, '')
    .replace(/(轉達|傳達|告訴|通知).*(Lman|老闆|boss)[，,：:]*\s*/gi, '')
    .replace(/tell\s+(Lman|the\s+boss)[,:\s]*/gi, '')
    .replace(/message\s+for\s+(Lman|the\s+boss)[,:\s]*/gi, '')
    .replace(/let\s+(Lman|the\s+boss)\s+know[,:\s]*/gi, '')
    .trim();

  return message || text.replace(/<@[A-Z0-9]+>/g, '').trim();
}

/**
 * Notify Lman of a new relay message
 */
async function notifyLmanOfMessage(client, msg) {
  const adminUserId = process.env.ADMIN_USER_ID;
  if (!adminUserId) {
    console.error('[Relay] ADMIN_USER_ID not configured');
    return;
  }

  try {
    await client.chat.postMessage({
      channel: adminUserId,
      text: `📨 來自 ${msg.fromUserName} 的訊息`,
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: '📨 新訊息轉達',
            emoji: true
          }
        },
        {
          type: 'section',
          fields: [
            {
              type: 'mrkdwn',
              text: `*來自:*\n<@${msg.fromUser}> (${msg.fromUserName})`
            },
            {
              type: 'mrkdwn',
              text: `*頻道:*\n${msg.channelName ? `#${msg.channelName}` : 'DM'}`
            }
          ]
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*訊息內容:*\n> ${msg.message}`
          }
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `ID: \`${msg.id}\` | ${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}`
            }
          ]
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: {
                type: 'plain_text',
                text: '✓ 已讀',
                emoji: true
              },
              style: 'primary',
              action_id: `relay_read_${msg.id}`
            },
            {
              type: 'button',
              text: {
                type: 'plain_text',
                text: '💬 回覆',
                emoji: true
              },
              action_id: `relay_reply_${msg.id}`
            }
          ]
        }
      ]
    });

    console.log(`[Relay] Notified Lman of message ${msg.id}`);
  } catch (error) {
    console.error('[Relay] Error notifying Lman:', error.message);
  }
}

/**
 * Process relay trigger
 */
async function processRelayTrigger(client, text, userId, channel, channelName, say) {
  console.log(`[Relay] Processing relay from ${userId} in ${channelName || channel}`);

  // Get user info
  let userName = userId;
  try {
    const userInfo = await client.users.info({ user: userId });
    userName = userInfo.user?.real_name || userInfo.user?.name || userId;
  } catch (e) {
    console.warn('[Relay] Could not get user name:', e.message);
  }

  // Extract the actual message
  const relayMessage = extractRelayMessage(text);

  if (!relayMessage || relayMessage.length < 2) {
    await say('請告訴我要轉達的內容是什麼？');
    return;
  }

  // Create message record
  const msg = createMessage({
    fromUser: userId,
    fromUserName: userName,
    message: relayMessage,
    channel: channel,
    channelName: channelName
  });

  // Notify Lman
  await notifyLmanOfMessage(client, msg);

  // Confirm to sender
  await say(`📨 好的，我會轉達給 Lman：\n> ${relayMessage}\n\n_訊息編號: ${msg.id}_`);
}

/**
 * Apply approved update to PKM files
 */
function applyUpdate(update) {
  try {
    if (update.type === 'oem') {
      // Update customers.md
      let customersContent = knowledgeBase.customers;
      const oemRegex = new RegExp(`(### .*${update.target}.*\\n\\*\\*狀態\\*\\*: )([^\\n]+)`, 'i');

      if (oemRegex.test(customersContent)) {
        customersContent = customersContent.replace(oemRegex, `$1${update.value}`);
        fs.writeFileSync(path.join(KB_BASE_PATH, 'customers.md'), customersContent);
        console.log(`✓ Updated OEM status for ${update.target}`);
        return true;
      }
    } else if (update.type === 'pending') {
      // Add to pm-memory.md pending table
      let pmContent = knowledgeBase.pmMemory;
      const pendingTableEnd = pmContent.indexOf('\n\n### 需要 Follow-up');

      if (pendingTableEnd > 0) {
        const newRow = `| ${update.target} | ${update.value} | ${new Date().toISOString().split('T')[0]} | - | KITT 提交 |\n`;
        pmContent = pmContent.slice(0, pendingTableEnd) + newRow + pmContent.slice(pendingTableEnd);
        fs.writeFileSync(path.join(KB_BASE_PATH, 'pm-memory.md'), pmContent);
        console.log(`✓ Added pending item: ${update.target}`);
        return true;
      }
    } else if (update.type === 'contact') {
      // Add contact invitation to pm-memory.md 等待回覆 table
      let pmContent = knowledgeBase.pmMemory;
      const pendingTableEnd = pmContent.indexOf('\n\n### 需要 Follow-up');

      if (pendingTableEnd > 0) {
        // Extract submitter name for the row
        const today = new Date().toISOString().split('T')[0];
        // Format: | 項目 | 對象 | 發送日期 | 預計回覆 | 備註 |
        const newRow = `| 邀請 ${update.target} | KITT 提交 | ${today} | 待確認 | ${update.value.substring(0, 50)}${update.value.length > 50 ? '...' : ''} |\n`;
        pmContent = pmContent.slice(0, pendingTableEnd) + newRow + pmContent.slice(pendingTableEnd);
        fs.writeFileSync(path.join(KB_BASE_PATH, 'pm-memory.md'), pmContent);
        console.log(`✓ Added contact invitation: ${update.target}`);
        return true;
      }
    } else if (update.type === 'admin_correction') {
      // Apply admin correction to pm-memory.md 決策脈絡 section
      const result = applyAdminCorrection(update.value);
      return result.success;
    }
    return false;
  } catch (error) {
    console.error('Error applying update:', error.message);
    return false;
  }
}

// ============ AI HELPERS ============

/**
 * Call Gemini API (free tier)
 */
async function callGemini(prompt, maxTokens = 300) {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not configured');

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: maxTokens,
        }
      })
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Gemini API error: ${response.status} - ${error}`);
  }

  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
}

/**
 * Call OpenAI API
 */
async function callOpenAI(prompt, maxTokens = 300) {
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not configured');

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens,
      temperature: 0.3
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error: ${response.status} - ${error}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || '';
}

/**
 * Call local Ollama API
 */
async function callOllama(prompt, maxTokens = 300) {
  const response = await fetch(OLLAMA_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      prompt: prompt,
      stream: false,
      options: { temperature: 0.3, num_predict: maxTokens, top_p: 0.9 }
    })
  });

  if (!response.ok) {
    throw new Error(`Ollama API error: ${response.status}`);
  }

  const data = await response.json();
  return (data.response || '').trim();
}

/**
 * Unified AI call with fallback hierarchy: Gemini → OpenAI → Ollama
 * @param {string} prompt - Prompt for the model
 * @param {number} maxTokens - Maximum tokens to generate
 * @returns {Promise<string>} - Generated text
 */
async function callAI(prompt, maxTokens = 300) {
  // 優先使用 OpenAI (gpt-4o-mini) - 中文處理更好，回覆更完整
  const providers = [
    { name: 'OpenAI', fn: callOpenAI, enabled: !!OPENAI_API_KEY },
    { name: 'Gemini', fn: callGemini, enabled: !!GEMINI_API_KEY },
    { name: 'Ollama', fn: callOllama, enabled: true }
  ];

  for (const provider of providers) {
    if (!provider.enabled) continue;

    try {
      console.log(`[AI] Trying ${provider.name}...`);
      const result = await provider.fn(prompt, maxTokens);
      if (result) {
        console.log(`[AI] ${provider.name} succeeded`);
        return result;
      }
    } catch (error) {
      console.warn(`[AI] ${provider.name} failed: ${error.message}`);
    }
  }

  throw new Error('All AI providers failed');
}

/**
 * Detect language of text
 * @param {string} text - Input text
 * @returns {Promise<string>} - Language code (zh-TW, en, ja, etc.)
 */
async function detectLanguage(text) {
  try {
    // FAST PATH: Use regex for reliable detection (AI model has issues)

    // Japanese: Hiragana or Katakana
    if (/[\u3040-\u309f\u30a0-\u30ff]/.test(text)) {
      return 'ja';
    }

    // Korean: Hangul
    if (/[\uac00-\ud7af\u1100-\u11ff]/.test(text)) {
      return 'ko';
    }

    // Chinese: CJK characters (check after Japanese since Japanese also uses some CJK)
    if (/[\u4e00-\u9fff]/.test(text)) {
      // Common Simplified Chinese specific characters
      const simplifiedChars = /[这个们会说对没关机开时为么什让给从远进还边]/;
      // Common Traditional Chinese specific characters
      const traditionalChars = /[這個們會說對沒關機開時為麼什讓給從遠進還邊]/;

      const hasSimplified = simplifiedChars.test(text);
      const hasTraditional = traditionalChars.test(text);

      if (hasSimplified && !hasTraditional) {
        return 'zh-CN';
      }
      return 'zh-TW';
    }

    // Default to English
    return 'en';
  } catch (error) {
    console.error('Language detection error:', error.message);
    return 'en';
  }
}

/**
 * Translate text to target language
 * @param {string} text - Text to translate
 * @param {string} targetLang - Target language code
 * @returns {Promise<string>} - Translated text
 */
async function translateText(text, targetLang) {
  try {
    const prompt = `Translate the following text to ${targetLang}. Return ONLY the translation, no explanations:

${text}`;

    const result = await callAI(prompt, 500);
    return result.trim();
  } catch (error) {
    console.error('Translation error:', error.message);
    return text; // Return original on error
  }
}

/**
 * Generate AI response with context
 * @param {string} userMessage - User's message
 * @param {string} userLang - User's language
 * @param {object} context - Additional context
 * @returns {Promise<string>} - AI response
 */
async function generateAIResponse(userMessage, userLang, context = {}) {
  try {
    // Extract relevant knowledge from knowledge base
    const productInfo = knowledgeBase.product ? `\n\nProduct Details:\n${knowledgeBase.product.substring(0, 3000)}` : '';
    const currentPriorities = knowledgeBase.priorities ? `\n\nCurrent Priorities:\n${knowledgeBase.priorities.substring(0, 2000)}` : '';

    // 🆕 動態載入相關 knowledge base（根據問題內容）
    let additionalContext = '';
    const lowerMsg = userMessage.toLowerCase();

    // CES 相關問題 → 載入 customers + pmMemory
    if (lowerMsg.includes('ces') || lowerMsg.includes('展會') || lowerMsg.includes('展位')) {
      const customersInfo = knowledgeBase.customers ? knowledgeBase.customers.substring(0, 2500) : '';
      const pmInfo = knowledgeBase.pmMemory ? knowledgeBase.pmMemory.substring(0, 2500) : '';
      additionalContext += `\n\n📅 CES 2026 相關資訊:\n展位: Venetian #60837\n日期: 2026-01-07~10\n\nCustomer Pipeline:\n${customersInfo}\n\nPM Memory:\n${pmInfo}`;
    }
    // OEM/客戶相關問題 → 載入 customers
    else if (lowerMsg.includes('oem') || lowerMsg.includes('客戶') || lowerMsg.includes('asus') || lowerMsg.includes('hp') || lowerMsg.includes('lenovo') || lowerMsg.includes('gigabyte') || lowerMsg.includes('mouse')) {
      const customersInfo = knowledgeBase.customers ? knowledgeBase.customers.substring(0, 3000) : '';
      additionalContext += `\n\nCustomer Pipeline:\n${customersInfo}`;
    }
    // 進度/狀態相關問題 → 載入 pmMemory
    else if (lowerMsg.includes('進度') || lowerMsg.includes('狀態') || lowerMsg.includes('status') || lowerMsg.includes('progress')) {
      const pmInfo = knowledgeBase.pmMemory ? knowledgeBase.pmMemory.substring(0, 3000) : '';
      additionalContext += `\n\nPM Memory & Progress:\n${pmInfo}`;
    }

    // Get conversation history if userId is provided
    const conversationContext = context.userId
      ? formatForPrompt(getHistory(context.userId))
      : '';

    const systemPrompt = `You are KITT (Knight Industries Team Tool), an advanced AI assistant in a Slack workspace for IrisGo.AI team.

Your personality:
- Professional, efficient, and helpful
- Slightly sophisticated but friendly
- Always ready to assist with team collaboration
- Multilingual capabilities (speak the user's language naturally)
- You remember recent conversations and can refer back to them

## Your Role as Lman's Personal Assistant
You also serve as Lman (老闆/founder) 's personal assistant for the team. When team members need to:
- **Book time with Lman**: Provide the booking link: https://calendar.app.google/8477UdatSLsEVDzT8
- **Ask if Lman is available**: Suggest they use the booking link to see available slots
- **Send non-urgent messages to Lman**: You can note it and relay to Lman later
- **Ask about Lman's preferences or decisions**: Share what you know from the knowledge base

When someone asks to "約 Lman"、"book Lman"、"找老闆"、"Lman 有空嗎" or similar, always provide the booking link.

About IrisGo.AI (Updated: ${knowledgeBase.lastUpdated || 'N/A'}):
${productInfo || '- IrisGo is a Personal AI Assistant product (B2C consumer product)\n- Privacy-first, on-device AI solution\n- Helps users manage knowledge, tasks, and daily workflows\n- Uses local AI models for maximum privacy\n- While the product is B2C, we explore B2B distribution channels (e.g., OEM partnerships with PC manufacturers)\n- NOT an enterprise B2B SaaS service'}
${currentPriorities}
${additionalContext}
${conversationContext}
Context:
- User's language: ${userLang}
- Current message: ${userMessage}
${context.teamMembers ? `- Team members: ${context.teamMembers.join(', ')}` : ''}
${context.channel ? `- Channel: ${context.channel}` : ''}

Instructions:
- If there's conversation history, use it to understand the context of the current message
- **CRITICAL: You MUST respond in ${userLang}** - If user writes in Chinese, respond in Chinese. If user writes in English, respond in English.
- Be concise, helpful, and professional
- If the user refers to something from earlier in the conversation, acknowledge it
- Do NOT output your reasoning process. Only output the final answer.

Your response (in ${userLang}):`;

    // 根據問題複雜度調整 token 限制
    const maxTokens = additionalContext ? 800 : 500;
    const result = await callAI(systemPrompt, maxTokens);
    return result.trim();
  } catch (error) {
    console.error('AI response error:', error.message);
    return 'Sorry, I encountered a system error. Please try again.';
  }
}

// ============ SLASH COMMANDS ============

/**
 * /kitt - Main command for KITT assistant
 * Usage: /kitt [action] [message]
 * Examples:
 *   /kitt help
 *   /kitt translate Hello team!
 *   /kitt ask What's our deadline?
 */
app.command('/kitt', async ({ command, ack, say, client }) => {
  await ack();

  const args = command.text.trim().split(' ');
  const action = args[0] || 'help';
  const message = args.slice(1).join(' ');

  console.log(`[/kitt] User: ${command.user_name}, Action: ${action}, Message: ${message}`);

  try {
    switch (action.toLowerCase()) {
      case 'help':
        await say({
          text: 'KITT Help',
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: '*🚗 KITT - Knight Industries Team Tool*\n_Your Advanced AI Team Assistant_'
              }
            },
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*Available Commands:*
• \`/kitt help\` - Show this help message
• \`/kitt translate [text]\` - Translate text to multiple languages
• \`/kitt ask [question]\` - Ask KITT anything
• \`/kitt status\` - Get system status

*📊 PM Dashboard Commands:*
• \`/kitt oem\` - Show OEM pipeline status
• \`/kitt pending\` - Show pending/waiting items
• \`/kitt ces\` - Show CES 2026 schedule

*✏️ Update Commands (with admin approval):*
• \`/kitt update oem [名稱] [狀態]\` - Submit OEM status update
• \`/kitt update pending [項目] [備註]\` - Submit new tracking item

*🔐 Admin Commands:*
• \`/kitt review\` - View pending updates
• \`/kitt approve [id]\` - Approve an update
• \`/kitt edit [id] [target] [value]\` - Edit before approving
• \`/kitt reject [id]\` - Reject an update

*Capabilities:*
✨ Automatic language detection
🌐 Multi-language translation (zh-TW, en, ja, ko, and more)
🤖 AI-powered intelligent responses
💬 Natural conversation in your language
👥 Team collaboration support
📁 Live PKM knowledge base sync
✅ Admin-approved knowledge updates

*Quick Tips:*
• Mention @KITT in any channel for help
• Send a DM for private conversations
• KITT responds in your preferred language
• PM data syncs automatically from Obsidian
• Updates require admin approval before applying`
              }
            }
          ]
        });
        break;

      case 'translate':
        if (!message) {
          await say('❌ Please provide text to translate. Usage: `/kitt translate Hello team!`');
          return;
        }

        // Detect original language
        const sourceLang = await detectLanguage(message);

        // Translate to common team languages
        const targetLanguages = ['zh-TW', 'en', 'ja', 'ko'];
        const translations = {};

        for (const lang of targetLanguages) {
          if (lang !== sourceLang) {
            translations[lang] = await translateText(message, lang);
          }
        }

        // Build response
        let translationText = `*Original (${sourceLang}):*\n${message}\n\n*Translations:*\n`;
        for (const [lang, text] of Object.entries(translations)) {
          translationText += `• *${lang}*: ${text}\n`;
        }

        await say({
          text: 'Translation Complete',
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: translationText
              }
            }
          ]
        });
        break;

      case 'ask':
        if (!message) {
          await say('❌ Please provide a question. Usage: `/kitt ask What\'s our deadline?`');
          return;
        }

        // Get user info for language detection
        const userInfo = await client.users.info({ user: command.user_id });
        const userLang = userInfo.user?.locale || 'en';

        // Get channel info for context
        const channelInfo = await client.conversations.info({ channel: command.channel_id });

        // Generate AI response
        const aiResponse = await generateAIResponse(message, userLang, {
          channel: channelInfo.channel?.name,
          teamMembers: []
        });

        await say({
          text: aiResponse,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `💬 *${command.user_name} asked:* ${message}\n\n🚗 *KITT:* ${aiResponse}`
              }
            }
          ]
        });
        break;

      case 'oem':
        // Extract OEM status from customers.md
        try {
          const customersData = knowledgeBase.customers || '';

          // Extract OEM sections
          const oems = [];
          const oemPatterns = [
            { name: 'Acer', regex: /### .*Acer.*\n\*\*狀態\*\*: ([^\n]+)/i },
            { name: 'ASUS NUC', regex: /#### ASUS NUC.*\n\*\*狀態\*\*: ([^\n]+)/i },
            { name: 'ASUS Consumer', regex: /#### ASUS Consumer.*\n\*\*狀態\*\*: ([^\n]+)/i },
            { name: 'ASUS Commercial', regex: /ASUS Commercial.*\n\*\*狀態\*\*: ([^\n]+)/i },
            { name: 'Gigabyte', regex: /### .*Gigabyte.*\n\*\*狀態\*\*: ([^\n]+)/i },
            { name: 'Mouse Computer', regex: /### .*Mouse Computer.*\n\*\*狀態\*\*: ([^\n]+)/i },
            { name: 'HP', regex: /### HP.*\n\*\*狀態\*\*: ([^\n]+)/i },
            { name: 'Lenovo', regex: /### Lenovo.*\n\*\*狀態\*\*: ([^\n]+)/i },
            { name: 'Dell', regex: /### Dell.*\n\*\*狀態\*\*: ([^\n]+)/i }
          ];

          for (const p of oemPatterns) {
            const match = customersData.match(p.regex);
            if (match) {
              oems.push({ name: p.name, status: match[1].trim() });
            }
          }

          let oemText = '*📊 OEM Pipeline Status*\n_(Updated: ' + (knowledgeBase.lastUpdated || 'N/A') + ')_\n\n';
          if (oems.length > 0) {
            for (const oem of oems) {
              const statusIcon = oem.status.includes('✅') || oem.status.includes('已簽約') ? '✅' :
                                oem.status.includes('🔥') || oem.status.includes('進行中') ? '🔥' :
                                oem.status.includes('等待') || oem.status.includes('🔄') ? '⏳' : '📋';
              oemText += `${statusIcon} *${oem.name}*: ${oem.status}\n`;
            }
          } else {
            oemText += '_No OEM data found. Please check customers.md_';
          }

          await say({
            text: 'OEM Status',
            blocks: [{ type: 'section', text: { type: 'mrkdwn', text: oemText } }]
          });
        } catch (err) {
          await say(`❌ Error reading OEM status: ${err.message}`);
        }
        break;

      case 'pending':
        // Extract pending items from pm-memory.md
        try {
          const pmData = knowledgeBase.pmMemory || '';

          // Extract "等待回覆" table
          const pendingMatch = pmData.match(/### 等待回覆\n\|[^\n]+\n\|[-|\s]+\n([\s\S]*?)(?=\n###|\n---|\n\n##|$)/);

          let pendingText = '*⏳ Pending Items*\n_(Updated: ' + (knowledgeBase.lastUpdated || 'N/A') + ')_\n\n';

          if (pendingMatch && pendingMatch[1]) {
            const rows = pendingMatch[1].trim().split('\n').filter(r => r.startsWith('|'));
            for (const row of rows) {
              const cols = row.split('|').map(c => c.trim()).filter(c => c);
              if (cols.length >= 4) {
                pendingText += `• *${cols[0]}* - ${cols[1]} (${cols[2]}) ${cols[4] || ''}\n`;
              }
            }
          } else {
            pendingText += '_No pending items found._';
          }

          await say({
            text: 'Pending Items',
            blocks: [{ type: 'section', text: { type: 'mrkdwn', text: pendingText } }]
          });
        } catch (err) {
          await say(`❌ Error reading pending items: ${err.message}`);
        }
        break;

      case 'ces':
        // Extract CES schedule from customers.md and pm-memory.md
        try {
          const customersData = knowledgeBase.customers || '';
          const pmData = knowledgeBase.pmMemory || '';

          let cesText = '*🎪 CES 2026 Schedule*\n_Booth: Venetian #60837_\n\n';

          // Mouse Computer meeting
          if (customersData.includes('Mouse Computer')) {
            cesText += '*Confirmed Meetings:*\n';
            cesText += '• 📅 *01-07 16:00* - Mouse Computer Demo (Booth)\n';
            cesText += '• 📅 *01-08 08:00* - Mouse Computer Follow-up (Online)\n\n';
          }

          // Extract CES-related info
          cesText += '*OEM CES Attendance:*\n';

          if (customersData.includes('Oscar') && customersData.includes('1/6-1/8')) {
            cesText += '• 🟢 *Gigabyte* - Oscar Wang (1/6-1/8)\n';
          }
          if (customersData.includes('HP') && customersData.includes('CES Invited')) {
            cesText += '• ⏳ *HP* - CES invitation sent\n';
          }
          if (customersData.includes('Lenovo') && customersData.includes('CES Invited')) {
            cesText += '• ⏳ *Lenovo* - CES invitation sent\n';
          }
          if (customersData.includes('ASUS Consumer') || customersData.includes('ASUS Commercial')) {
            cesText += '• ⏳ *ASUS Consumer/Commercial* - Tony inviting\n';
          }

          await say({
            text: 'CES 2026 Schedule',
            blocks: [{ type: 'section', text: { type: 'mrkdwn', text: cesText } }]
          });
        } catch (err) {
          await say(`❌ Error reading CES schedule: ${err.message}`);
        }
        break;

      case 'update':
        // Submit update request for approval
        // Usage: /kitt update oem [name] [status] OR /kitt update pending [item] [note]
        try {
          const updateArgs = message.split(' ');
          const updateType = updateArgs[0]; // 'oem' or 'pending'

          if (!updateType || !['oem', 'pending'].includes(updateType)) {
            await say('❌ Usage:\n• `/kitt update oem [OEM名稱] [新狀態]`\n• `/kitt update pending [項目] [備註]`');
            return;
          }

          const target = updateArgs[1];
          const value = updateArgs.slice(2).join(' ');

          if (!target || !value) {
            await say(`❌ Missing ${updateType === 'oem' ? 'OEM name or status' : 'item or note'}.\nExample: \`/kitt update ${updateType} ${updateType === 'oem' ? 'HP CES會議已確認' : 'Intel報告 需本週完成'}\``);
            return;
          }

          // Create update in SQLite
          const update = createUpdate({
            type: updateType,
            target: target,
            value: value,
            submittedBy: command.user_id
          });

          // Notify admin
          await notifyAdminOfUpdate(client, update);

          await say({
            text: 'Update submitted',
            blocks: [{
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `✅ *Update Submitted for Approval*\n\n*ID:* \`${update.id}\`\n*Type:* ${update.type}\n*Target:* ${update.target}\n*Value:* ${update.value}\n\n_Admin has been notified. You'll receive a DM when it's reviewed._`
              }
            }]
          });
        } catch (err) {
          await say(`❌ Error submitting update: ${err.message}`);
        }
        break;

      case 'review':
        // Show pending updates (admin only)
        try {
          if (command.user_id !== ADMIN_USER_ID) {
            await say('❌ Only admin can review pending updates.');
            return;
          }

          const pendingUpdates = getPendingUpdates();

          if (pendingUpdates.length === 0) {
            await say('✅ No pending updates to review.');
            return;
          }

          let reviewText = `*📋 Pending Updates (${pendingUpdates.length})*\n\n`;
          for (const u of pendingUpdates) {
            reviewText += `• \`${u.id}\` - *${u.type}*: ${u.target} → ${u.value} (by <@${u.submittedBy}>)\n`;
          }
          reviewText += '\n_Use `/kitt approve [id]` or `/kitt reject [id]` to process._';

          await say({
            text: 'Pending Updates',
            blocks: [{ type: 'section', text: { type: 'mrkdwn', text: reviewText } }]
          });
        } catch (err) {
          await say(`❌ Error loading pending updates: ${err.message}`);
        }
        break;

      case 'approve':
        // Approve an update (admin only)
        try {
          if (command.user_id !== ADMIN_USER_ID) {
            await say('❌ Only admin can approve updates.');
            return;
          }

          const approveId = message.trim().toUpperCase();
          if (!approveId) {
            await say('❌ Usage: `/kitt approve [id]`');
            return;
          }

          const updateToApprove = getUpdate(approveId);

          if (!updateToApprove || updateToApprove.status !== 'pending') {
            await say(`❌ Update \`${approveId}\` not found or already processed.`);
            return;
          }

          // Apply the update to PKM
          const applied = applyUpdate(updateToApprove);

          if (applied) {
            updateStatus(approveId, 'approved');

            // Notify submitter
            await notifyUserOfResult(client, updateToApprove.submittedBy, updateToApprove, true);

            // Reload knowledge base
            loadKnowledgeBase();

            await say(`✅ Update \`${approveId}\` approved and applied to PKM.`);
          } else {
            await say(`⚠️ Update \`${approveId}\` approved but could not be applied. Please update manually.`);
          }
        } catch (err) {
          await say(`❌ Error approving update: ${err.message}`);
        }
        break;

      case 'edit':
        // Edit a pending update before approving (admin only)
        try {
          if (command.user_id !== ADMIN_USER_ID) {
            await say('❌ Only admin can edit updates.');
            return;
          }

          // Usage: /kitt edit [id] [target] [value]
          const editArgs = message.split(' ');
          const editId = (editArgs[0] || '').toUpperCase();
          const newTarget = editArgs[1];
          const newValue = editArgs.slice(2).join(' ');

          if (!editId) {
            await say('❌ Usage: `/kitt edit [id] [new target] [new value]`\nExample: `/kitt edit ABC123 HP CES會議已確認`');
            return;
          }

          const updateToEdit = getUpdate(editId);

          if (!updateToEdit || updateToEdit.status !== 'pending') {
            await say(`❌ Update \`${editId}\` not found or already processed.`);
            return;
          }

          const oldTarget = updateToEdit.target;
          const oldValue = updateToEdit.value;

          // Update the values if provided
          const finalTarget = newTarget || oldTarget;
          const finalValue = newValue || oldValue;
          editUpdate(editId, finalTarget, finalValue, command.user_id);

          await say({
            text: 'Update edited',
            blocks: [{
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `✏️ *Update \`${editId}\` Edited*\n\n*Before:*\n• Target: ${oldTarget}\n• Value: ${oldValue}\n\n*After:*\n• Target: ${finalTarget}\n• Value: ${finalValue}\n\n_Use \`/kitt approve ${editId}\` or \`/kitt reject ${editId}\` to complete._`
              }
            }]
          });
        } catch (err) {
          await say(`❌ Error editing update: ${err.message}`);
        }
        break;

      case 'reject':
        // Reject an update (admin only)
        try {
          if (command.user_id !== ADMIN_USER_ID) {
            await say('❌ Only admin can reject updates.');
            return;
          }

          const rejectId = message.trim().toUpperCase();
          if (!rejectId) {
            await say('❌ Usage: `/kitt reject [id]`');
            return;
          }

          const updateToReject = getUpdate(rejectId);

          if (!updateToReject || updateToReject.status !== 'pending') {
            await say(`❌ Update \`${rejectId}\` not found or already processed.`);
            return;
          }

          updateStatus(rejectId, 'rejected');

          // Notify submitter
          await notifyUserOfResult(client, updateToReject.submittedBy, updateToReject, false);

          await say(`❌ Update \`${rejectId}\` rejected.`);
        } catch (err) {
          await say(`❌ Error rejecting update: ${err.message}`);
        }
        break;

      case 'status':
        await say({
          text: 'KITT Status',
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `📊 *KITT System Status*\n\n• All systems: Operational ✅\n• Current channel: <#${command.channel_id}>\n• Language support: Active 🌐\n• AI engine: Online 🤖\n• Knowledge base: ${knowledgeBase.lastUpdated ? '✅ Loaded' : '❌ Not loaded'}\n\n_KITT is ready to assist!_`
              }
            }
          ]
        });
        break;

      default:
        await say(`❓ Unknown command: "${action}". Type \`/kitt help\` for available commands.`);
    }
  } catch (error) {
    console.error('Command error:', error);
    await say(`❌ System error: ${error.message}`);
  }
});

// ============ BUTTON ACTION HANDLERS ============

/**
 * Handle approve button click
 */
app.action(/approve_update_(.*)/, async ({ action, ack, body, client }) => {
  await ack();

  const updateId = action.action_id.replace('approve_update_', '');
  console.log(`[Button] Approve clicked for ${updateId}`);

  try {
    const updateToApprove = getUpdate(updateId);

    if (!updateToApprove || updateToApprove.status !== 'pending') {
      await client.chat.postMessage({
        channel: body.channel.id,
        text: `❌ Update \`${updateId}\` not found or already processed.`
      });
      return;
    }

    const applied = applyUpdate(updateToApprove);

    if (applied) {
      updateStatus(updateId, 'approved');

      // Notify submitter
      await notifyUserOfResult(client, updateToApprove.submittedBy, updateToApprove, true);

      // Reload knowledge base
      loadKnowledgeBase();

      await client.chat.postMessage({
        channel: body.channel.id,
        text: `✅ Update \`${updateId}\` approved and applied to PKM.`
      });
    } else {
      // Still mark as approved even if auto-apply failed
      updateStatus(updateId, 'approved', 'Auto-apply not supported for this type');

      // Notify submitter
      await notifyUserOfResult(client, updateToApprove.submittedBy, updateToApprove, true);

      await client.chat.postMessage({
        channel: body.channel.id,
        text: `⚠️ Update \`${updateId}\` approved but could not be auto-applied. Please update PKM manually.\n\n*Content:* ${updateToApprove.value}`
      });
    }
  } catch (error) {
    console.error('Approve button error:', error);
    await client.chat.postMessage({
      channel: body.channel.id,
      text: `❌ Error: ${error.message}`
    });
  }
});

/**
 * Handle edit button click - opens modal with current values
 */
app.action(/edit_update_(.*)/, async ({ action, ack, body, client }) => {
  await ack();

  const updateId = action.action_id.replace('edit_update_', '');
  console.log(`[Button] Edit clicked for ${updateId}`);

  try {
    const update = getUpdate(updateId);

    if (!update || update.status !== 'pending') {
      await client.chat.postMessage({
        channel: body.channel.id,
        text: `❌ Update \`${updateId}\` not found or already processed.`
      });
      return;
    }

    // Open a modal for editing
    await client.views.open({
      trigger_id: body.trigger_id,
      view: {
        type: 'modal',
        callback_id: `edit_modal_${updateId}`,
        title: { type: 'plain_text', text: 'Edit Update' },
        submit: { type: 'plain_text', text: 'Save' },
        close: { type: 'plain_text', text: 'Cancel' },
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*ID:* \`${update.id}\`\n*Type:* ${update.type}\n*Submitted by:* <@${update.submittedBy}>`
            }
          },
          {
            type: 'input',
            block_id: 'target_block',
            element: {
              type: 'plain_text_input',
              action_id: 'target_input',
              initial_value: update.target,
              placeholder: { type: 'plain_text', text: 'Enter target (e.g., OEM name)' }
            },
            label: { type: 'plain_text', text: 'Target' }
          },
          {
            type: 'input',
            block_id: 'value_block',
            element: {
              type: 'plain_text_input',
              action_id: 'value_input',
              initial_value: update.value,
              multiline: true,
              placeholder: { type: 'plain_text', text: 'Enter new value/status' }
            },
            label: { type: 'plain_text', text: 'Value' }
          }
        ]
      }
    });
  } catch (error) {
    console.error('Edit button error:', error);
    await client.chat.postMessage({
      channel: body.channel.id,
      text: `❌ Error opening edit modal: ${error.message}`
    });
  }
});

/**
 * Handle edit modal submission
 */
app.view(/edit_modal_(.*)/, async ({ ack, body, view, client }) => {
  await ack();

  const updateId = view.callback_id.replace('edit_modal_', '');
  console.log(`[Modal] Edit submitted for ${updateId}`);

  try {
    const newTarget = view.state.values.target_block.target_input.value;
    const newValue = view.state.values.value_block.value_input.value;

    const updateToEdit = getUpdate(updateId);

    if (!updateToEdit || updateToEdit.status !== 'pending') {
      // DM admin with error
      const dmResult = await client.conversations.open({ users: ADMIN_USER_ID });
      await client.chat.postMessage({
        channel: dmResult.channel.id,
        text: `❌ Update \`${updateId}\` not found or already processed.`
      });
      return;
    }

    const oldTarget = updateToEdit.target;
    const oldValue = updateToEdit.value;

    editUpdate(updateId, newTarget, newValue, body.user.id);

    // DM admin with confirmation
    const dmResult = await client.conversations.open({ users: ADMIN_USER_ID });
    await client.chat.postMessage({
      channel: dmResult.channel.id,
      text: 'Update edited',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `✏️ *Update \`${updateId}\` Edited*\n\n*Before:*\n• Target: ${oldTarget}\n• Value: ${oldValue}\n\n*After:*\n• Target: ${newTarget}\n• Value: ${newValue}`
          }
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: '✅ Approve Now' },
              style: 'primary',
              action_id: `approve_update_${updateId}`
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: '❌ Reject' },
              style: 'danger',
              action_id: `reject_update_${updateId}`
            }
          ]
        }
      ]
    });
  } catch (error) {
    console.error('Modal submit error:', error);
  }
});

/**
 * Handle reject button click
 */
app.action(/reject_update_(.*)/, async ({ action, ack, body, client }) => {
  await ack();

  const updateId = action.action_id.replace('reject_update_', '');
  console.log(`[Button] Reject clicked for ${updateId}`);

  try {
    const updateToReject = getUpdate(updateId);

    if (!updateToReject || updateToReject.status !== 'pending') {
      await client.chat.postMessage({
        channel: body.channel.id,
        text: `❌ Update \`${updateId}\` not found or already processed.`
      });
      return;
    }

    updateStatus(updateId, 'rejected');

    // Notify submitter
    await notifyUserOfResult(client, updateToReject.submittedBy, updateToReject, false);

    await client.chat.postMessage({
      channel: body.channel.id,
      text: `❌ Update \`${updateId}\` rejected.`
    });
  } catch (error) {
    console.error('Reject button error:', error);
    await client.chat.postMessage({
      channel: body.channel.id,
      text: `❌ Error: ${error.message}`
    });
  }
});

// ============ MEMORY BUTTON HANDLERS ============

/**
 * Handle memory approve button click
 */
app.action(/approve_memory_(.*)/, async ({ action, ack, body, client }) => {
  await ack();

  const candidateId = action.action_id.replace('approve_memory_', '');
  console.log(`[Memory Button] Approve clicked for ${candidateId}`);

  try {
    const candidate = getCandidate(candidateId);

    if (!candidate || candidate.status !== 'pending') {
      await client.chat.postMessage({
        channel: body.channel.id,
        text: `❌ Memory candidate \`${candidateId}\` not found or already processed.`
      });
      return;
    }

    // Approve and save to shared database
    const createdIds = approveCandidate(candidateId, body.user.id);

    if (createdIds && createdIds.length > 0) {
      await client.chat.postMessage({
        channel: body.channel.id,
        text: `✅ *Memory Approved*\n\n${createdIds.length} memories saved to shared database.\n\nIDs: ${createdIds.map(id => `\`${id}\``).join(', ')}\n\n_Iris/Lucy can now query these memories._`
      });

      // Notify the submitter
      try {
        const dmResult = await client.conversations.open({ users: candidate.submitted_by });
        await client.chat.postMessage({
          channel: dmResult.channel.id,
          text: `✅ 你的記憶請求已通過審核！\n\n${createdIds.length} 條記憶已保存。`
        });
      } catch (e) {
        console.error('Failed to notify submitter:', e.message);
      }
    } else {
      await client.chat.postMessage({
        channel: body.channel.id,
        text: `⚠️ Memory candidate approved but no memories were created.`
      });
    }
  } catch (error) {
    console.error('Memory approve error:', error);
    await client.chat.postMessage({
      channel: body.channel.id,
      text: `❌ Error: ${error.message}`
    });
  }
});

/**
 * Handle memory edit button click - opens modal
 */
app.action(/edit_memory_(.*)/, async ({ action, ack, body, client }) => {
  await ack();

  const candidateId = action.action_id.replace('edit_memory_', '');
  console.log(`[Memory Button] Edit clicked for ${candidateId}`);

  try {
    const candidate = getCandidate(candidateId);

    if (!candidate || candidate.status !== 'pending') {
      await client.chat.postMessage({
        channel: body.channel.id,
        text: `❌ Memory candidate \`${candidateId}\` not found or already processed.`
      });
      return;
    }

    // Format current memories as editable text
    const memoriesText = candidate.extractedMemories.map((mem, i) => {
      return `[${mem.type}] ${mem.content}${mem.context ? ` | ${mem.context}` : ''}`;
    }).join('\n');

    // Open modal for editing
    await client.views.open({
      trigger_id: body.trigger_id,
      view: {
        type: 'modal',
        callback_id: `edit_memory_modal_${candidateId}`,
        title: { type: 'plain_text', text: 'Edit Memories' },
        submit: { type: 'plain_text', text: 'Save & Approve' },
        close: { type: 'plain_text', text: 'Cancel' },
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*ID:* \`${candidate.id}\`\n*Channel:* #${candidate.channel_name || candidate.channel}`
            }
          },
          {
            type: 'input',
            block_id: 'memories_block',
            element: {
              type: 'plain_text_input',
              action_id: 'memories_input',
              multiline: true,
              initial_value: memoriesText,
              placeholder: { type: 'plain_text', text: '[type] content | context\nOne memory per line' }
            },
            label: { type: 'plain_text', text: 'Memories (one per line)' },
            hint: { type: 'plain_text', text: 'Format: [decision|action|preference|fact|context] content | optional context' }
          }
        ]
      }
    });
  } catch (error) {
    console.error('Memory edit button error:', error);
    await client.chat.postMessage({
      channel: body.channel.id,
      text: `❌ Error opening edit modal: ${error.message}`
    });
  }
});

/**
 * Handle memory edit modal submission
 */
app.view(/edit_memory_modal_(.*)/, async ({ ack, body, view, client }) => {
  await ack();

  const candidateId = view.callback_id.replace('edit_memory_modal_', '');
  console.log(`[Memory Modal] Edit submitted for ${candidateId}`);

  try {
    const memoriesText = view.state.values.memories_block.memories_input.value;

    // Parse edited memories
    const lines = memoriesText.split('\n').filter(line => line.trim());
    const newMemories = [];

    for (const line of lines) {
      // Parse format: [type] content | context
      const typeMatch = line.match(/^\[(\w+)\]\s*/);
      if (!typeMatch) continue;

      const type = typeMatch[1];
      const rest = line.replace(typeMatch[0], '');
      const parts = rest.split('|').map(p => p.trim());

      newMemories.push({
        type: type,
        content: parts[0],
        context: parts[1] || null,
        tags: []
      });
    }

    if (newMemories.length === 0) {
      const dmResult = await client.conversations.open({ users: ADMIN_USER_ID });
      await client.chat.postMessage({
        channel: dmResult.channel.id,
        text: `⚠️ No valid memories found after editing. Please use format: [type] content | context`
      });
      return;
    }

    // Update candidate with new memories
    editCandidateMemories(candidateId, newMemories);

    // Auto-approve after edit
    const createdIds = approveCandidate(candidateId, body.user.id);

    const dmResult = await client.conversations.open({ users: ADMIN_USER_ID });
    await client.chat.postMessage({
      channel: dmResult.channel.id,
      text: `✅ *Memory Edited & Approved*\n\n${createdIds.length} memories saved.\n\nIDs: ${createdIds.map(id => `\`${id}\``).join(', ')}`
    });
  } catch (error) {
    console.error('Memory modal submit error:', error);
  }
});

/**
 * Handle memory reject button click
 */
app.action(/reject_memory_(.*)/, async ({ action, ack, body, client }) => {
  await ack();

  const candidateId = action.action_id.replace('reject_memory_', '');
  console.log(`[Memory Button] Reject clicked for ${candidateId}`);

  try {
    const candidate = getCandidate(candidateId);

    if (!candidate || candidate.status !== 'pending') {
      await client.chat.postMessage({
        channel: body.channel.id,
        text: `❌ Memory candidate \`${candidateId}\` not found or already processed.`
      });
      return;
    }

    rejectCandidate(candidateId, body.user.id);

    await client.chat.postMessage({
      channel: body.channel.id,
      text: `❌ Memory candidate \`${candidateId}\` rejected.`
    });

    // Notify submitter
    try {
      const dmResult = await client.conversations.open({ users: candidate.submitted_by });
      await client.chat.postMessage({
        channel: dmResult.channel.id,
        text: `❌ 你的記憶請求未通過審核。`
      });
    } catch (e) {
      console.error('Failed to notify submitter:', e.message);
    }
  } catch (error) {
    console.error('Memory reject error:', error);
    await client.chat.postMessage({
      channel: body.channel.id,
      text: `❌ Error: ${error.message}`
    });
  }
});

// ============ RELAY MESSAGE BUTTON HANDLERS ============

/**
 * Handle relay message "已讀" button click
 */
app.action(/relay_read_(.*)/, async ({ action, ack, body, client }) => {
  await ack();

  const msgId = action.action_id.replace('relay_read_', '');
  console.log(`[Relay Button] Read clicked for ${msgId}`);

  try {
    const msg = getMessage(msgId);

    if (!msg) {
      await client.chat.postMessage({
        channel: body.channel.id,
        text: `❌ 訊息 \`${msgId}\` 找不到。`
      });
      return;
    }

    markAsRead(msgId);

    // Update the original message to show it's been read
    await client.chat.update({
      channel: body.channel.id,
      ts: body.message.ts,
      text: `✅ 已讀 - 來自 ${msg.from_user_name} 的訊息`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `✅ *已讀* - 來自 <@${msg.from_user}> 的訊息：\n> ${msg.message}\n\n_${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })} 標記為已讀_`
          }
        }
      ]
    });
  } catch (error) {
    console.error('Relay read error:', error);
    await client.chat.postMessage({
      channel: body.channel.id,
      text: `❌ Error: ${error.message}`
    });
  }
});

/**
 * Handle relay message "回覆" button click
 */
app.action(/relay_reply_(.*)/, async ({ action, ack, body, client }) => {
  await ack();

  const msgId = action.action_id.replace('relay_reply_', '');
  console.log(`[Relay Button] Reply clicked for ${msgId}`);

  try {
    const msg = getMessage(msgId);

    if (!msg) {
      await client.chat.postMessage({
        channel: body.channel.id,
        text: `❌ 訊息 \`${msgId}\` 找不到。`
      });
      return;
    }

    // Open a modal for reply
    await client.views.open({
      trigger_id: body.trigger_id,
      view: {
        type: 'modal',
        callback_id: `relay_reply_modal_${msgId}`,
        title: {
          type: 'plain_text',
          text: '回覆訊息'
        },
        submit: {
          type: 'plain_text',
          text: '發送'
        },
        close: {
          type: 'plain_text',
          text: '取消'
        },
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*原訊息來自:* ${msg.from_user_name}\n*內容:* ${msg.message}`
            }
          },
          {
            type: 'input',
            block_id: 'reply_input',
            label: {
              type: 'plain_text',
              text: '你的回覆'
            },
            element: {
              type: 'plain_text_input',
              action_id: 'reply_text',
              multiline: true,
              placeholder: {
                type: 'plain_text',
                text: '輸入要回覆給對方的訊息...'
              }
            }
          }
        ],
        private_metadata: JSON.stringify({
          msgId: msgId,
          originalChannel: body.channel.id,
          originalTs: body.message.ts
        })
      }
    });
  } catch (error) {
    console.error('Relay reply modal error:', error);
    await client.chat.postMessage({
      channel: body.channel.id,
      text: `❌ Error: ${error.message}`
    });
  }
});

/**
 * Handle relay reply modal submission
 */
app.view(/relay_reply_modal_(.*)/, async ({ ack, view, client }) => {
  await ack();

  const msgId = view.callback_id.replace('relay_reply_modal_', '');
  const replyText = view.state.values.reply_input.reply_text.value;
  const metadata = JSON.parse(view.private_metadata);

  console.log(`[Relay] Reply submitted for ${msgId}: ${replyText.substring(0, 50)}...`);

  try {
    const msg = getMessage(msgId);

    if (!msg) {
      console.error(`[Relay] Message ${msgId} not found for reply`);
      return;
    }

    // Mark as replied
    markAsReplied(msgId, replyText);

    // Send reply to original sender via DM
    const dmResult = await client.conversations.open({ users: msg.from_user });
    await client.chat.postMessage({
      channel: dmResult.channel.id,
      text: `💬 Lman 回覆了你的訊息`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `💬 *Lman 回覆了你的訊息*\n\n你的原訊息：\n> ${msg.message}\n\nLman 的回覆：\n> ${replyText}`
          }
        }
      ]
    });

    // Update original notification to show replied
    await client.chat.update({
      channel: metadata.originalChannel,
      ts: metadata.originalTs,
      text: `💬 已回覆 - 來自 ${msg.from_user_name} 的訊息`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `💬 *已回覆* - 來自 <@${msg.from_user}> 的訊息：\n> ${msg.message}\n\n你的回覆：\n> ${replyText}\n\n_${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })} 已發送_`
          }
        }
      ]
    });

    console.log(`[Relay] Reply sent to ${msg.from_user_name}`);
  } catch (error) {
    console.error('Relay reply error:', error);
  }
});

// ============ MESSAGE LISTENERS ============

/**
 * Listen for @mentions of the bot
 */
app.event('app_mention', async ({ event, say, client }) => {
  console.log(`[mention] User: ${event.user}, Text: ${event.text}`);

  try {
    // Remove bot mention from message
    const message = event.text.replace(/<@[A-Z0-9]+>/g, '').trim();

    if (!message) {
      await say(`Hello <@${event.user}>! KITT here. How may I assist you? Try \`/kitt help\` to see what I can do.`);
      return;
    }

    // Check for memory trigger (e.g., "記住", "remember")
    if (hasMemoryTrigger(message)) {
      console.log(`[mention] Memory trigger detected: "${message}"`);

      // Determine the thread to analyze
      // If this is a reply in a thread, use the thread_ts
      // Otherwise, use the current message's ts as the thread start
      const threadTs = event.thread_ts || event.ts;

      await processMemoryTrigger(client, event.channel, threadTs, event.user, say);
      return;
    }

    // Check for relay trigger (e.g., "幫我轉達給 Lman", "跟老闆說")
    if (hasRelayTrigger(message)) {
      console.log(`[mention] Relay trigger detected: "${message}"`);

      // Get channel name
      let channelName = null;
      try {
        const channelInfo = await client.conversations.info({ channel: event.channel });
        channelName = channelInfo.channel?.name;
      } catch (e) {
        // May fail for DMs, that's ok
      }

      await processRelayTrigger(client, message, event.user, event.channel, channelName, say);
      return;
    }

    // Detect user's language
    const userLang = await detectLanguage(message);

    // Get user info
    const userInfo = await client.users.info({ user: event.user });
    const userName = userInfo.user?.real_name || userInfo.user?.name;

    // Generate AI response
    const response = await generateAIResponse(message, userLang, {
      userName,
      channel: event.channel
    });

    await say({
      text: response,
      thread_ts: event.ts // Reply in thread
    });
  } catch (error) {
    console.error('Mention error:', error);
    await say(`❌ Sorry <@${event.user}>, I encountered a system error: ${error.message}`);
  }
});

/**
 * Listen for direct messages
 */
app.event('message', async ({ event, say, client }) => {
  console.log('[message event] Received:', JSON.stringify({
    type: event.type,
    subtype: event.subtype,
    channel: event.channel,
    user: event.user,
    text: event.text?.substring(0, 50)
  }));

  // Skip bot messages and threaded replies
  if (event.subtype === 'bot_message' || event.thread_ts) {
    console.log('[message event] Skipped: bot_message or threaded reply');
    return;
  }

  try {
    // Check if it's a DM
    const channel = await client.conversations.info({ channel: event.channel });
    console.log('[message event] Channel info:', JSON.stringify({
      id: channel.channel?.id,
      is_im: channel.channel?.is_im,
      is_channel: channel.channel?.is_channel,
      is_group: channel.channel?.is_group
    }));

    // Support both 1-on-1 DM (is_im) and group DM (is_mpim)
    if (channel.channel?.is_im || channel.channel?.is_mpim) {
      const dmType = channel.channel?.is_mpim ? 'Group DM' : 'DM';
      console.log(`[${dmType}] User: ${event.user}, Text: ${event.text}`);
      console.log(`[DEBUG] Checking admin status...`);

      const isAdmin = event.user === ADMIN_USER_ID;
      console.log(`[DEBUG] isAdmin: ${isAdmin}, ADMIN_USER_ID: ${ADMIN_USER_ID}`);

      const isKnowledgeUpdate = await detectKnowledgeUpdateIntent(event.text);
      console.log(`[DEBUG] isKnowledgeUpdate: ${isKnowledgeUpdate}`);

      // Non-admin sending knowledge update → route through approval
      if (!isAdmin && isKnowledgeUpdate) {
        console.log(`[DM] Knowledge update detected from non-admin, routing to approval`);

        const { type, target } = extractKnowledgeInfo(event.text);

        // Create update in SQLite
        const update = createUpdate({
          type: type,
          target: target,
          value: event.text,
          submittedBy: event.user,
          source: 'dm'
        });

        // Notify admin
        await notifyAdminOfUpdate(client, update);

        // Acknowledge to user
        const userLang = await detectLanguage(event.text);
        const ackMessage = userLang === 'en'
          ? `✅ *Submitted for approval*\n\nID: \`${update.id}\`\nAdmin has been notified. You'll receive a message when it's reviewed.`
          : `✅ *已提交審核*\n\nID: \`${update.id}\`\n已通知管理員，審核完成後會通知你。`;

        await say(ackMessage);
      } else if (isAdmin && detectAdminCorrectionIntent(event.text)) {
        // Admin correction → also route through approval for consistency
        console.log(`[DM] Admin correction detected, routing to approval queue`);

        const { type, target } = extractKnowledgeInfo(event.text);

        // Create update in SQLite
        const update = createUpdate({
          type: 'admin_correction',
          target: target,
          value: event.text,
          submittedBy: event.user,
          source: 'admin_dm'
        });

        // Notify admin (self)
        await notifyAdminOfUpdate(client, update);

        // Acknowledge
        const userLang = await detectLanguage(event.text);
        const ackMessage = userLang === 'en'
          ? `✅ *Correction queued for review*\n\nID: \`${update.id}\`\nUse the buttons above to approve and write to PKM.`
          : `✅ *糾正已加入審核佇列*\n\nID: \`${update.id}\`\n請使用上方按鈕確認後寫入 PKM。`;

        await say(ackMessage);
      } else if (isAdmin && isKnowledgeUpdate) {
        // Admin knowledge update → also route through approval for safety
        console.log(`[DM] Admin knowledge update detected, routing to approval queue`);

        const { type, target } = extractKnowledgeInfo(event.text);

        // Create update in SQLite
        const update = createUpdate({
          type: type,
          target: target,
          value: event.text,
          submittedBy: event.user,
          source: 'admin_dm'
        });

        // Notify admin (self)
        await notifyAdminOfUpdate(client, update);

        // Acknowledge
        const userLang = await detectLanguage(event.text);
        const ackMessage = userLang === 'en'
          ? `✅ *Knowledge update queued for review*\n\nID: \`${update.id}\`\nUse the buttons above to approve and write to PKM.`
          : `✅ *知識更新已加入審核佇列*\n\nID: \`${update.id}\`\n請使用上方按鈕確認後寫入 PKM。`;

        await say(ackMessage);
      } else {
        // Regular query → normal AI response with conversation context
        console.log(`[DEBUG] Entering regular query path...`);
        const userLang = await detectLanguage(event.text);
        console.log(`[DEBUG] Detected language: ${userLang}`);

        // Save user message to conversation history
        addMessage(event.user, 'user', event.text);

        // Generate response with conversation context
        const response = await generateAIResponse(event.text, userLang, {
          userId: event.user,
          channel: event.channel
        });
        console.log(`[DEBUG] AI response generated, length: ${response?.length || 0}`);

        // Save KITT response to conversation history
        addMessage(event.user, 'assistant', response);

        await say(response);
        console.log(`[DEBUG] Response sent via say()`);
      }
    } else {
      console.log('[message event] Not a DM, skipping');
    }
  } catch (error) {
    console.error('DM error:', error);
    await say(`❌ System error: ${error.message}`);
  }
});

// ============ DEBUG: Alternative message handler (DISABLED to prevent duplicates) ============
// The app.event('message') handler above already handles DMs properly.
// This was kept for debugging but causes duplicate pending updates.
// Uncomment only if app.event('message') stops working.
/*
app.message(async ({ message, say, client }) => {
  // ... disabled ...
});
*/

// ============ APP HOME TAB ============

/**
 * Build the App Home view for team members.
 * Shows: Lman's focus, booking link, recent updates, company info shortcuts.
 */
function buildHomeView() {
  const blocks = [];

  // Header
  blocks.push({
    type: "header",
    text: { type: "plain_text", text: "🚗 KITT - Lman's PM Assistant", emoji: true }
  });

  blocks.push({
    type: "context",
    elements: [
      { type: "mrkdwn", text: "_Your gateway to company info & Lman_" }
    ]
  });

  blocks.push({ type: "divider" });

  // Current Focus Section
  blocks.push({
    type: "section",
    text: { type: "mrkdwn", text: "*📌 Lman 目前專注*" }
  });

  // Extract priorities from knowledge base
  let focusText = "";
  if (knowledgeBase.priorities) {
    // Parse P0 items from priorities
    const p0Match = knowledgeBase.priorities.match(/### P0[^\n]*\n([\s\S]*?)(?=### P1|---|\n## )/);
    if (p0Match) {
      const p0Lines = p0Match[1].split('\n')
        .filter(line => line.match(/^####|^- \[[ x]\]/))
        .slice(0, 4)
        .map(line => {
          if (line.startsWith('####')) {
            return `• *${line.replace(/^####\s*/, '').replace(/🚨|🔴/g, '').trim()}*`;
          }
          return `  ${line.replace(/^- \[[ x]\]/, '○').trim()}`;
        });
      focusText = p0Lines.join('\n');
    }
  }

  if (!focusText) {
    focusText = "• CES 2026 準備\n• OEM 合作追蹤\n• Mnemosyne Demo";
  }

  blocks.push({
    type: "section",
    text: { type: "mrkdwn", text: focusText }
  });

  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        text: { type: "plain_text", text: "📋 詳細進度", emoji: true },
        action_id: "home_view_priorities"
      }
    ]
  });

  blocks.push({ type: "divider" });

  // Book Meeting Section
  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: "*🗓️ 約時間找 Lman*\n直接預約 1:1 會議時段"
    },
    accessory: {
      type: "button",
      text: { type: "plain_text", text: "預約會議", emoji: true },
      url: "https://calendar.app.google/8477UdatSLsEVDzT8",
      action_id: "home_book_meeting",
      style: "primary"
    }
  });

  blocks.push({ type: "divider" });

  // Recent Updates Section
  blocks.push({
    type: "section",
    text: { type: "mrkdwn", text: "*📢 最新動態*" }
  });

  // Get recent approved updates
  const recentUpdates = getAllUpdates({ status: 'approved', limit: 3 });

  if (recentUpdates.length > 0) {
    const updatesText = recentUpdates.map(u => {
      const date = new Date(u.submittedAt).toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' });
      const typeEmoji = { oem: '🤝', pending: '📝', ces: '🎪', contact: '👤' }[u.type] || '📌';
      return `• ${date} ${typeEmoji} ${u.target}: ${u.value}`;
    }).join('\n');

    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: updatesText }
    });
  } else {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "_暫無最新動態_" }
    });
  }

  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        text: { type: "plain_text", text: "查看全部", emoji: true },
        action_id: "home_view_all_updates"
      }
    ]
  });

  blocks.push({ type: "divider" });

  // Quick Actions Section
  blocks.push({
    type: "section",
    text: { type: "mrkdwn", text: "*❓ 快速查詢*" }
  });

  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        text: { type: "plain_text", text: "🏢 公司簡介", emoji: true },
        action_id: "home_company_intro"
      },
      {
        type: "button",
        text: { type: "plain_text", text: "🎯 產品方向", emoji: true },
        action_id: "home_product_direction"
      },
      {
        type: "button",
        text: { type: "plain_text", text: "👥 團隊資源", emoji: true },
        action_id: "home_team_resources"
      },
      {
        type: "button",
        text: { type: "plain_text", text: "💬 留言給 Lman", emoji: true },
        action_id: "home_leave_message"
      }
    ]
  });

  blocks.push({ type: "divider" });

  // Footer Tips
  blocks.push({
    type: "context",
    elements: [
      { type: "mrkdwn", text: "💡 _私訊我任何問題，或在頻道 @KITT。我是 Lman 的 AI 特助，隨時為你服務！_" }
    ]
  });

  // Last updated timestamp
  blocks.push({
    type: "context",
    elements: [
      { type: "mrkdwn", text: `_Knowledge Base 更新：${knowledgeBase.lastUpdated || 'N/A'}_` }
    ]
  });

  return {
    type: "home",
    blocks: blocks
  };
}

// App Home Opened Event
app.event('app_home_opened', async ({ event, client, logger }) => {
  try {
    const userId = event.user;
    console.log(`[App Home] User ${userId} opened home tab`);

    await client.views.publish({
      user_id: userId,
      view: buildHomeView()
    });

    console.log(`[App Home] Published home view for ${userId}`);
  } catch (error) {
    logger.error(`[App Home] Error publishing home tab: ${error}`);
  }
});

// ============ APP HOME BUTTON ACTIONS ============

// View Priorities Modal
app.action('home_view_priorities', async ({ ack, body, client }) => {
  await ack();

  try {
    let prioritiesContent = knowledgeBase.priorities || '_優先事項資料未載入_';

    // Truncate if too long for modal (max ~3000 chars for text block)
    if (prioritiesContent.length > 2500) {
      prioritiesContent = prioritiesContent.substring(0, 2500) + '\n\n_...（內容過長，已截斷）_';
    }

    await client.views.open({
      trigger_id: body.trigger_id,
      view: {
        type: "modal",
        title: { type: "plain_text", text: "📋 優先事項" },
        close: { type: "plain_text", text: "關閉" },
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text: prioritiesContent }
          }
        ]
      }
    });
  } catch (error) {
    console.error('[home_view_priorities] Error:', error);
  }
});

// View All Updates Modal
app.action('home_view_all_updates', async ({ ack, body, client }) => {
  await ack();

  try {
    const allUpdates = getAllUpdates({ status: 'approved', limit: 10 });

    let blocks = [
      {
        type: "header",
        text: { type: "plain_text", text: "📢 所有已發布動態", emoji: true }
      },
      { type: "divider" }
    ];

    if (allUpdates.length > 0) {
      for (const u of allUpdates) {
        const date = new Date(u.submittedAt).toLocaleDateString('zh-TW');
        const typeLabel = { oem: 'OEM', pending: '待辦', ces: 'CES', contact: '聯絡人' }[u.type] || u.type;

        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*${date}* [${typeLabel}]\n*${u.target}*: ${u.value}`
          }
        });
      }
    } else {
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: "_暫無已發布動態_" }
      });
    }

    await client.views.open({
      trigger_id: body.trigger_id,
      view: {
        type: "modal",
        title: { type: "plain_text", text: "動態列表" },
        close: { type: "plain_text", text: "關閉" },
        blocks: blocks
      }
    });
  } catch (error) {
    console.error('[home_view_all_updates] Error:', error);
  }
});

// Company Intro Modal
app.action('home_company_intro', async ({ ack, body, client }) => {
  await ack();

  try {
    let introText = "";

    if (knowledgeBase.product) {
      // Extract key info from product KB
      const taglineMatch = knowledgeBase.product.match(/Tagline[：:]\s*(.+)/i);
      const missionMatch = knowledgeBase.product.match(/Mission[：:]\s*(.+)/i);
      const visionMatch = knowledgeBase.product.match(/Vision[：:]\s*(.+)/i);

      introText = "*IrisGo.AI*\n\n";
      if (taglineMatch) introText += `📌 *Tagline*: ${taglineMatch[1]}\n\n`;
      if (missionMatch) introText += `🎯 *Mission*: ${missionMatch[1]}\n\n`;
      if (visionMatch) introText += `🔮 *Vision*: ${visionMatch[1]}\n\n`;

      if (!taglineMatch && !missionMatch && !visionMatch) {
        // Fallback to first 1000 chars
        introText = knowledgeBase.product.substring(0, 1000);
      }
    } else {
      introText = "*IrisGo.AI*\n\nPersonal AI Assistant - 隱私優先的個人 AI 助手\n\n_更多資訊請私訊 KITT_";
    }

    await client.views.open({
      trigger_id: body.trigger_id,
      view: {
        type: "modal",
        title: { type: "plain_text", text: "🏢 公司簡介" },
        close: { type: "plain_text", text: "關閉" },
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text: introText }
          }
        ]
      }
    });
  } catch (error) {
    console.error('[home_company_intro] Error:', error);
  }
});

// Product Direction Modal
app.action('home_product_direction', async ({ ack, body, client }) => {
  await ack();

  try {
    let roadmapText = "";

    if (knowledgeBase.roadmap) {
      // Extract key roadmap items
      roadmapText = knowledgeBase.roadmap.substring(0, 2500);
      if (knowledgeBase.roadmap.length > 2500) {
        roadmapText += '\n\n_...（內容過長，已截斷）_';
      }
    } else {
      roadmapText = "*IrisGo 產品方向*\n\n• Mnemosyne - Context-Aware Engine\n• Skills Marketplace\n• Privacy-First AI\n\n_詳情請私訊 KITT_";
    }

    await client.views.open({
      trigger_id: body.trigger_id,
      view: {
        type: "modal",
        title: { type: "plain_text", text: "🎯 產品方向" },
        close: { type: "plain_text", text: "關閉" },
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text: roadmapText }
          }
        ]
      }
    });
  } catch (error) {
    console.error('[home_product_direction] Error:', error);
  }
});

// Team Resources Modal
app.action('home_team_resources', async ({ ack, body, client }) => {
  await ack();

  try {
    let resourcesText = "";

    if (knowledgeBase.resources) {
      resourcesText = knowledgeBase.resources.substring(0, 2500);
      if (knowledgeBase.resources.length > 2500) {
        resourcesText += '\n\n_...（內容過長，已截斷）_';
      }
    } else {
      resourcesText = "*團隊資源*\n\n• Slack: #general, #product, #engineering\n• Google Drive: IrisGo Shared\n• GitHub: github.com/irisgo-ai\n\n_詳情請私訊 KITT_";
    }

    await client.views.open({
      trigger_id: body.trigger_id,
      view: {
        type: "modal",
        title: { type: "plain_text", text: "👥 團隊資源" },
        close: { type: "plain_text", text: "關閉" },
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text: resourcesText }
          }
        ]
      }
    });
  } catch (error) {
    console.error('[home_team_resources] Error:', error);
  }
});

// Leave Message Modal
app.action('home_leave_message', async ({ ack, body, client }) => {
  await ack();

  try {
    await client.views.open({
      trigger_id: body.trigger_id,
      view: {
        type: "modal",
        callback_id: "leave_message_modal",
        title: { type: "plain_text", text: "💬 留言給 Lman" },
        submit: { type: "plain_text", text: "送出" },
        close: { type: "plain_text", text: "取消" },
        blocks: [
          {
            type: "input",
            block_id: "message_type_block",
            element: {
              type: "static_select",
              action_id: "message_type",
              placeholder: { type: "plain_text", text: "選擇類型" },
              options: [
                { text: { type: "plain_text", text: "💡 建議 / Idea" }, value: "idea" },
                { text: { type: "plain_text", text: "❓ 問題 / Question" }, value: "question" },
                { text: { type: "plain_text", text: "📋 進度更新 / Update" }, value: "update" },
                { text: { type: "plain_text", text: "🚨 緊急 / Urgent" }, value: "urgent" }
              ]
            },
            label: { type: "plain_text", text: "類型" }
          },
          {
            type: "input",
            block_id: "message_content_block",
            element: {
              type: "plain_text_input",
              action_id: "message_content",
              multiline: true,
              placeholder: { type: "plain_text", text: "輸入你想告訴 Lman 的內容..." }
            },
            label: { type: "plain_text", text: "內容" }
          }
        ]
      }
    });
  } catch (error) {
    console.error('[home_leave_message] Error:', error);
  }
});

// Handle Leave Message Modal Submission
app.view('leave_message_modal', async ({ ack, body, view, client }) => {
  await ack();

  try {
    const userId = body.user.id;
    const messageType = view.state.values.message_type_block.message_type.selected_option.value;
    const messageContent = view.state.values.message_content_block.message_content.value;

    // Get user info
    const userInfo = await client.users.info({ user: userId });
    const userName = userInfo.user.real_name || userInfo.user.name;

    // Create a relay message to Lman
    const typeEmoji = { idea: '💡', question: '❓', update: '📋', urgent: '🚨' }[messageType] || '💬';
    const typeLabel = { idea: '建議', question: '問題', update: '進度更新', urgent: '緊急' }[messageType] || '訊息';

    // Send to Lman's DM (U02G6CRD4 is Lman's Slack ID)
    const LMAN_USER_ID = process.env.LMAN_SLACK_ID || 'U02G6CRD4';

    await client.chat.postMessage({
      channel: LMAN_USER_ID,
      text: `${typeEmoji} *來自 ${userName} 的${typeLabel}*`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `${typeEmoji} *來自 <@${userId}> 的${typeLabel}*\n\n${messageContent}`
          }
        },
        {
          type: "context",
          elements: [
            { type: "mrkdwn", text: `_透過 KITT App Home 送出 • ${new Date().toLocaleString('zh-TW')}_` }
          ]
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "↩️ 回覆", emoji: true },
              action_id: `quick_reply_${userId}`
            }
          ]
        }
      ]
    });

    // Confirm to sender
    await client.chat.postMessage({
      channel: userId,
      text: `✅ 你的${typeLabel}已送達 Lman！\n\n> ${messageContent.substring(0, 100)}${messageContent.length > 100 ? '...' : ''}`
    });

    console.log(`[leave_message] ${userName} sent ${typeLabel} to Lman`);

  } catch (error) {
    console.error('[leave_message_modal] Error:', error);
  }
});

// Quick Reply Action (for Lman to reply)
app.action(/quick_reply_(.*)/, async ({ action, ack, body, client }) => {
  await ack();

  const targetUserId = action.action_id.replace('quick_reply_', '');

  try {
    await client.views.open({
      trigger_id: body.trigger_id,
      view: {
        type: "modal",
        callback_id: `quick_reply_modal_${targetUserId}`,
        title: { type: "plain_text", text: "↩️ 快速回覆" },
        submit: { type: "plain_text", text: "送出" },
        close: { type: "plain_text", text: "取消" },
        blocks: [
          {
            type: "context",
            elements: [
              { type: "mrkdwn", text: `回覆給 <@${targetUserId}>` }
            ]
          },
          {
            type: "input",
            block_id: "reply_content_block",
            element: {
              type: "plain_text_input",
              action_id: "reply_content",
              multiline: true,
              placeholder: { type: "plain_text", text: "輸入回覆內容..." }
            },
            label: { type: "plain_text", text: "內容" }
          }
        ]
      }
    });
  } catch (error) {
    console.error('[quick_reply] Error:', error);
  }
});

// Handle Quick Reply Modal Submission
app.view(/quick_reply_modal_(.*)/, async ({ ack, view, client }) => {
  await ack();

  const targetUserId = view.callback_id.replace('quick_reply_modal_', '');
  const replyContent = view.state.values.reply_content_block.reply_content.value;

  try {
    await client.chat.postMessage({
      channel: targetUserId,
      text: `💬 *Lman 回覆你：*\n\n${replyContent}`,
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: `💬 *Lman 回覆你：*\n\n${replyContent}` }
        },
        {
          type: "context",
          elements: [
            { type: "mrkdwn", text: `_${new Date().toLocaleString('zh-TW')}_` }
          ]
        }
      ]
    });

    console.log(`[quick_reply] Lman replied to ${targetUserId}`);
  } catch (error) {
    console.error('[quick_reply_modal] Error:', error);
  }
});

// Book Meeting Action (just for logging, actual link opens in browser)
app.action('home_book_meeting', async ({ ack }) => {
  await ack();
  console.log('[App Home] User clicked book meeting button');
});

// ============ STARTUP ============

(async () => {
  try {
    // Initialize SQLite database
    initDB();

    await app.start();
    console.log('⚡️ KITT is online!');
    console.log(`🚗 Bot Name: ${process.env.BOT_NAME || 'KITT'}`);
    console.log(`📡 Full Name: ${process.env.BOT_FULL_NAME || 'Knight Industries Team Tool'}`);
    console.log(`🌐 Default Language: ${process.env.DEFAULT_LANGUAGE || 'zh-TW'}`);
    console.log(`🔌 Port: ${process.env.PORT || 3000}`);
    console.log('');
    console.log('💬 Ready to assist your team!');
  } catch (error) {
    console.error('❌ KITT system error:', error);
    process.exit(1);
  }
})();

module.exports = app;
