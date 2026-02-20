#!/usr/bin/env node
/**
 * Post Business Model analysis to Slack #fundraising channel
 */

require('dotenv').config();
const { WebClient } = require('@slack/web-api');
const fs = require('fs');

// Initialize Slack client
const client = new WebClient(process.env.SLACK_BOT_TOKEN);

async function postToFundraising() {
  try {
    // Read the markdown content
    const content = fs.readFileSync('/tmp/slack-fundraising-post.md', 'utf8');

    // Find #fundraising channel
    const channelsList = await client.conversations.list({
      types: 'public_channel,private_channel'
    });

    const fundraisingChannel = channelsList.channels.find(
      ch => ch.name === 'fundraising'
    );

    if (!fundraisingChannel) {
      console.error('❌ #fundraising channel not found');
      console.log('Available channels:', channelsList.channels.map(ch => ch.name).join(', '));
      process.exit(1);
    }

    console.log(`✅ Found #fundraising channel: ${fundraisingChannel.id}`);

    // Post the message
    const result = await client.chat.postMessage({
      channel: fundraisingChannel.id,
      text: '🚀 IrisGo Business Model 重大突破：三引擎飛輪',
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: '🚀 IrisGo Business Model 重大突破：三引擎飛輪',
            emoji: true
          }
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: content
          }
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `📎 完整文件: \`Business-Model-Three-Engine-Flywheel.md\` | 📅 ${new Date().toISOString().split('T')[0]} | 👤 Lman + Iris (PM)`
            }
          ]
        }
      ]
    });

    console.log('✅ Message posted successfully!');
    console.log(`📱 Message timestamp: ${result.ts}`);
    console.log(`🔗 Channel: #fundraising (${fundraisingChannel.id})`);

  } catch (error) {
    console.error('❌ Error posting to Slack:', error.message);
    if (error.data) {
      console.error('Error details:', error.data);
    }
    process.exit(1);
  }
}

postToFundraising();
