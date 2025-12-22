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

// Initialize Slack App
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
  port: process.env.PORT || 3000
});

// Use local Ollama instead of Gemini API (no quota limits, faster response)
const OLLAMA_API = 'http://localhost:11434/api/generate';
// Note: gpt-oss:20b has issues (puts answers in thinking field, not response)
// Using qwen2.5:3b which properly returns response field
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
  const updatePatterns = [
    /記得|記住|記錄|记得|记住|记录/,           // remember (繁體+簡體)
    /更新|update/i,                           // update
    /新增|加入|添加|add/i,                     // add
    /邀請了|邀请了|contacted|聯繫了|联系了/i,   // contacted someone (繁體+簡體)
    /已經.*完成|已完成|已经.*完成/,             // completed something
    /狀態.*變成|改為|changed|状态.*变成|改为/i, // status change (繁體+簡體)
    /進度|进度|progress/i,                     // progress update (繁體+簡體)
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
    const prompt = `Classify this message. Is it a request to UPDATE, RECORD, or REMEMBER information (like contacts, status, progress, tasks)?

Message: "${text}"

Reply with ONLY one word:
- YES (if it's asking to record/update/remember something)
- NO (if it's just a question or general chat)

Answer:`;

    const result = await callOllama(prompt, 10);
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
 * Call local Ollama API
 * @param {string} prompt - Prompt for the model
 * @param {number} maxTokens - Maximum tokens to generate
 * @returns {Promise<string>} - Generated text
 */
async function callOllama(prompt, maxTokens = 300) {
  try {
    const response = await fetch(OLLAMA_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt: prompt,
        stream: false,
        options: {
          temperature: 0.3,
          num_predict: maxTokens,
          top_p: 0.9
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status}`);
    }

    const data = await response.json();

    // Handle gpt-oss model that puts answers in thinking instead of response
    if (data.response && data.response.trim()) {
      return data.response.trim();
    }

    // If response is empty but thinking exists, extract usable content
    if (data.thinking && data.thinking.trim()) {
      const thinking = data.thinking.trim();

      // Try to find quoted answer patterns like "答案是..." or final statements
      const patterns = [
        /(?:So (?:I'll|we) (?:say|respond|answer)[:\s]+)["']?([^"'\n]+)["']?/i,
        /(?:回答|答案|回覆)[：:\s]+["']?([^"'\n]+)["']?/,
        /(?:Let's (?:say|respond))[:\s]+["']?([^"'\n]+)["']?/i,
      ];

      for (const pattern of patterns) {
        const match = thinking.match(pattern);
        if (match && match[1] && match[1].length > 10) {
          return match[1].trim();
        }
      }

      // Fallback: Get the last meaningful paragraph (likely the conclusion)
      const paragraphs = thinking.split(/\n\n+/).filter(p => p.trim().length > 20);
      if (paragraphs.length > 0) {
        const lastParagraph = paragraphs[paragraphs.length - 1].trim();
        // If last paragraph looks like a conclusion, use it
        if (lastParagraph.length < 500) {
          return lastParagraph;
        }
      }

      // Last resort: Return truncated thinking with warning
      console.warn('[Ollama] Using raw thinking output - response was empty');
      return thinking.substring(0, 500) + (thinking.length > 500 ? '...' : '');
    }

    return '';
  } catch (error) {
    console.error('Ollama API error:', error.message);
    throw error;
  }
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

    const result = await callOllama(prompt, 500);
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
    const currentPriorities = knowledgeBase.priorities ? `\n\nCurrent Priorities:\n${knowledgeBase.priorities.substring(0, 1000)}` : '';

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

About IrisGo.AI (Updated: ${knowledgeBase.lastUpdated || 'N/A'}):
${productInfo || '- IrisGo is a Personal AI Assistant product (B2C consumer product)\n- Privacy-first, on-device AI solution\n- Helps users manage knowledge, tasks, and daily workflows\n- Uses local AI models for maximum privacy\n- While the product is B2C, we explore B2B distribution channels (e.g., OEM partnerships with PC manufacturers)\n- NOT an enterprise B2B SaaS service'}
${currentPriorities}
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

    const result = await callOllama(systemPrompt, 500);
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

    if (channel.channel?.is_im) {
      console.log(`[DM] User: ${event.user}, Text: ${event.text}`);
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
