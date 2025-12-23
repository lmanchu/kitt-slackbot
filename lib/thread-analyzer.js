/**
 * Thread Analyzer for KITT Memory System
 *
 * Reads Slack thread messages and uses AI to extract
 * key information worth remembering.
 */

/**
 * Fetch all messages in a thread
 * @param {Object} client - Slack client
 * @param {string} channel - Channel ID
 * @param {string} threadTs - Thread timestamp
 * @returns {Promise<Array>} Thread messages
 */
async function fetchThreadMessages(client, channel, threadTs) {
  try {
    const result = await client.conversations.replies({
      channel: channel,
      ts: threadTs,
      limit: 100 // Max messages to fetch
    });

    if (!result.ok || !result.messages) {
      console.error('[ThreadAnalyzer] Failed to fetch thread:', result.error);
      return [];
    }

    // Filter out bot messages and format
    const messages = result.messages
      .filter(msg => !msg.bot_id) // Skip bot messages
      .map(msg => ({
        user: msg.user,
        text: msg.text,
        ts: msg.ts,
        reactions: msg.reactions || []
      }));

    return messages;
  } catch (error) {
    console.error('[ThreadAnalyzer] Error fetching thread:', error.message);
    return [];
  }
}

/**
 * Get thread permalink
 */
async function getThreadPermalink(client, channel, threadTs) {
  try {
    const result = await client.chat.getPermalink({
      channel: channel,
      message_ts: threadTs
    });
    return result.permalink;
  } catch (error) {
    console.error('[ThreadAnalyzer] Error getting permalink:', error.message);
    return null;
  }
}

/**
 * Get channel name from ID
 */
async function getChannelName(client, channelId) {
  try {
    const result = await client.conversations.info({ channel: channelId });
    return result.channel?.name || channelId;
  } catch (error) {
    return channelId;
  }
}

/**
 * Format messages for AI analysis
 */
function formatMessagesForAnalysis(messages, userMap = {}) {
  return messages.map(msg => {
    const userName = userMap[msg.user] || msg.user;
    return `[${userName}]: ${msg.text}`;
  }).join('\n\n');
}

/**
 * Build the AI prompt for memory extraction
 */
function buildExtractionPrompt(formattedMessages, channelName) {
  return `你是 KITT，一個 Slack 團隊助手。用戶要求你記住以下對話的重點。

## 對話來源
頻道: #${channelName}

## 對話內容
${formattedMessages}

## 任務
請從這段對話中提取值得長期記住的資訊。

### 值得記住的類型
1. **decision** - 決策、共識、結論
2. **action** - 待辦事項、下一步行動
3. **preference** - 用戶偏好、喜好
4. **fact** - 重要事實、數據
5. **context** - 背景資訊、脈絡

### 不需要記住的
- 一般閒聊
- 重複的資訊
- 臨時性的討論
- 問候語

## 輸出格式
請以 JSON 陣列格式輸出，每個記憶項目包含：
- type: 類型 (decision/action/preference/fact/context)
- content: 記憶內容（簡潔明確）
- context: 相關脈絡（可選）
- tags: 標籤陣列（可選）

範例：
[
  {
    "type": "decision",
    "content": "Skill system prompt 不應被用戶編輯，用戶只能創建和編輯 Skill Prompts",
    "context": "12/22 weekly sync - Skill Consensus",
    "tags": ["skill", "product-decision"]
  },
  {
    "type": "action",
    "content": "Arnold 提供下一個迭代的 UI/UX design guidance",
    "context": "Next action from 12/22 sync",
    "tags": ["ui", "arnold"]
  }
]

如果沒有值得記住的資訊，請回覆空陣列 []

請只輸出 JSON，不要有其他文字：`;
}

/**
 * Parse AI response to extract memories
 */
function parseAIResponse(response) {
  try {
    // Try to extract JSON from response
    let jsonStr = response.trim();

    // Handle markdown code blocks
    if (jsonStr.includes('```json')) {
      jsonStr = jsonStr.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    } else if (jsonStr.includes('```')) {
      jsonStr = jsonStr.replace(/```\n?/g, '');
    }

    jsonStr = jsonStr.trim();

    // Parse JSON
    const memories = JSON.parse(jsonStr);

    // Validate structure
    if (!Array.isArray(memories)) {
      console.error('[ThreadAnalyzer] AI response is not an array');
      return [];
    }

    // Validate each memory
    return memories.filter(mem => {
      if (!mem.type || !mem.content) {
        console.warn('[ThreadAnalyzer] Invalid memory item:', mem);
        return false;
      }
      return true;
    });
  } catch (error) {
    console.error('[ThreadAnalyzer] Failed to parse AI response:', error.message);
    console.error('[ThreadAnalyzer] Raw response:', response);
    return [];
  }
}

/**
 * Analyze a thread and extract memories
 * @param {Object} client - Slack client
 * @param {Function} callAI - AI call function
 * @param {string} channel - Channel ID
 * @param {string} threadTs - Thread timestamp
 * @param {string} submittedBy - User who requested
 * @returns {Promise<Object>} Analysis result
 */
async function analyzeThread(client, callAI, channel, threadTs, submittedBy) {
  console.log(`[ThreadAnalyzer] Analyzing thread ${threadTs} in channel ${channel}`);

  // Fetch thread messages
  const messages = await fetchThreadMessages(client, channel, threadTs);
  if (messages.length === 0) {
    return { success: false, error: 'No messages found in thread' };
  }

  console.log(`[ThreadAnalyzer] Found ${messages.length} messages`);

  // Get channel name
  const channelName = await getChannelName(client, channel);

  // Get thread permalink
  const threadUrl = await getThreadPermalink(client, channel, threadTs);

  // Build user map for better readability
  const userMap = {};
  for (const msg of messages) {
    if (!userMap[msg.user]) {
      try {
        const userInfo = await client.users.info({ user: msg.user });
        userMap[msg.user] = userInfo.user?.real_name || userInfo.user?.name || msg.user;
      } catch (e) {
        userMap[msg.user] = msg.user;
      }
    }
  }

  // Format messages for AI
  const formattedMessages = formatMessagesForAnalysis(messages, userMap);
  console.log(`[ThreadAnalyzer] Formatted ${formattedMessages.length} chars for AI`);

  // Build prompt and call AI
  const prompt = buildExtractionPrompt(formattedMessages, channelName);

  try {
    const aiResponse = await callAI(prompt, 1500);
    console.log(`[ThreadAnalyzer] AI response length: ${aiResponse.length}`);

    // Parse extracted memories
    const extractedMemories = parseAIResponse(aiResponse);
    console.log(`[ThreadAnalyzer] Extracted ${extractedMemories.length} memories`);

    return {
      success: true,
      data: {
        source: 'slack-thread',
        channel,
        channelName,
        threadTs,
        threadUrl,
        rawMessages: messages.map(m => ({
          user: userMap[m.user] || m.user,
          text: m.text,
          ts: m.ts
        })),
        extractedMemories,
        submittedBy
      }
    };
  } catch (error) {
    console.error('[ThreadAnalyzer] AI analysis failed:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Check if a message contains memory trigger keywords
 */
function hasMemoryTrigger(text) {
  const triggers = [
    /記住/,
    /記下/,
    /要記/,
    /幫我記/,
    /記得/,
    /remember/i,
    /記錄下來/,
    /save\s+this/i,
    /note\s+this/i
  ];

  return triggers.some(pattern => pattern.test(text));
}

module.exports = {
  fetchThreadMessages,
  getThreadPermalink,
  getChannelName,
  analyzeThread,
  hasMemoryTrigger,
  parseAIResponse
};
