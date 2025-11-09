#!/usr/bin/env node
/**
 * KITT - Knight Industries Team Tool
 * Multilingual AI collaboration assistant for Slack
 *
 * "A shadowy flight into the dangerous world of team collaboration..."
 */

require('dotenv').config();
const { App } = require('@slack/bolt');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Initialize Slack App
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
  port: process.env.PORT || 3000
});

// Initialize Gemini AI for multilingual support
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });

// ============ AI HELPERS ============

/**
 * Detect language of text
 * @param {string} text - Input text
 * @returns {Promise<string>} - Language code (zh-TW, en, ja, etc.)
 */
async function detectLanguage(text) {
  try {
    const prompt = `Detect the language of this text and return ONLY the language code (e.g., zh-TW, en, ja, ko, es):

Text: "${text}"

Return only the language code, nothing else.`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text().trim();
  } catch (error) {
    console.error('Language detection error:', error.message);
    return 'en'; // Default to English
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

    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text().trim();
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
    const systemPrompt = `You are KITT (Knight Industries Team Tool), an advanced AI assistant in a Slack workspace.

Your personality:
- Professional, efficient, and helpful
- Slightly sophisticated but friendly
- Always ready to assist with team collaboration
- Multilingual capabilities (speak the user's language naturally)

Context:
- User's language: ${userLang}
- User's message: ${userMessage}
${context.teamMembers ? `- Team members: ${context.teamMembers.join(', ')}` : ''}
${context.channel ? `- Channel: ${context.channel}` : ''}

Respond naturally in the user's language (${userLang}). Be concise, helpful, and professional.`;

    const result = await model.generateContent(systemPrompt);
    const response = await result.response;
    return response.text().trim();
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

*Capabilities:*
✨ Automatic language detection
🌐 Multi-language translation (zh-TW, en, ja, ko, and more)
🤖 AI-powered intelligent responses
💬 Natural conversation in your language
👥 Team collaboration support

*Quick Tips:*
• Mention @KITT in any channel for help
• Send a DM for private conversations
• KITT responds in your preferred language`
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

      case 'status':
        await say({
          text: 'KITT Status',
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `📊 *KITT System Status*\n\n• All systems: Operational ✅\n• Current channel: <#${command.channel_id}>\n• Language support: Active 🌐\n• AI engine: Online 🤖\n\n_KITT is ready to assist!_`
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
  // Skip bot messages and threaded replies
  if (event.subtype === 'bot_message' || event.thread_ts) {
    return;
  }

  // Only respond in DMs (channel type: 'im')
  const channel = await client.conversations.info({ channel: event.channel });
  if (channel.channel?.is_im) {
    console.log(`[DM] User: ${event.user}, Text: ${event.text}`);

    try {
      const userLang = await detectLanguage(event.text);
      const response = await generateAIResponse(event.text, userLang);

      await say(response);
    } catch (error) {
      console.error('DM error:', error);
      await say(`❌ System error: ${error.message}`);
    }
  }
});

// ============ STARTUP ============

(async () => {
  try {
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
