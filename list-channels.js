#!/usr/bin/env node
require('dotenv').config();
const { WebClient } = require('@slack/web-api');

const client = new WebClient(process.env.SLACK_BOT_TOKEN);

async function listChannels() {
  try {
    // List public channels
    console.log('📢 Public Channels:');
    const publicChannels = await client.conversations.list({
      types: 'public_channel',
      limit: 100
    });
    publicChannels.channels.forEach(ch => {
      console.log(`  - #${ch.name} (${ch.id})`);
    });

    console.log('\n🔒 Trying to list private channels (may fail if no groups:read scope):');
    try {
      const privateChannels = await client.conversations.list({
        types: 'private_channel',
        limit: 100
      });
      privateChannels.channels.forEach(ch => {
        console.log(`  - #${ch.name} (${ch.id}) [private]`);
      });
    } catch (err) {
      console.log(`  ⚠️  Cannot list private channels: ${err.message}`);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

listChannels();
