# KITT DM Issue - Root Cause & Fix

## 🔍 Diagnosis (2025-11-11)

### Issue
KITT receives @mentions perfectly but doesn't respond to Direct Messages (DMs).

### Root Cause
The Slack App is **NOT subscribed to `message.im` events** in the actual Slack App configuration, even though it's in the manifest file.

### Evidence
```bash
# Searched entire kitt.log file:
grep -i "channel_type" ~/kitt-slackbot/kitt.log
# Result: Only "channel_type":"channel" found

grep -E '"channel":"D[A-Z0-9]+"' ~/kitt-slackbot/kitt.log
# Result: Zero DM channel IDs (no channels starting with "D")

grep -i "\[DM\]" ~/kitt-slackbot/kitt.log
# Result: Zero DM log entries
```

### What's Working vs Not Working
- ✅ `app_mention` events - KITT responds to @mentions
- ✅ `message.channels` events - logs show channel messages received
- ❌ `message.im` events - **ZERO DM events ever received**

## 🔧 Fix Instructions

### Option 1: Add `message.im` via Slack App Settings (Recommended)

1. Go to https://api.slack.com/apps
2. Select the KITT app
3. Go to **Event Subscriptions** → **Subscribe to bot events**
4. Click **Add Bot User Event**
5. Add `message.im` event
6. Click **Save Changes**
7. **Reinstall the app** to workspace (required for event changes)

### Option 2: Recreate App from Manifest

1. Go to https://api.slack.com/apps
2. Click **Create New App** → **From an app manifest**
3. Select your workspace
4. Paste the content of `/Users/lman/kitt-slackbot/slack-manifest.yaml`
5. Create the app
6. Note the new tokens and update `.env` file
7. Install app to workspace

### Option 3: Verify Current Event Subscriptions

To see what events are currently subscribed:
1. Go to https://api.slack.com/apps
2. Select the KITT app
3. Go to **Event Subscriptions**
4. Check the **Subscribe to bot events** section

Expected bot events:
- `app_mention` ✅ (working)
- `message.channels` ✅ (working)
- `message.im` ❌ (**MISSING** - this is the issue)

## ✅ Verification

After adding `message.im` and reinstalling:

1. Restart KITT:
```bash
launchctl unload ~/Library/LaunchAgents/com.irisgo.kitt.plist
launchctl load ~/Library/LaunchAgents/com.irisgo.kitt.plist
```

2. Send a DM to KITT

3. Check logs:
```bash
tail -f ~/kitt-slackbot/kitt.log
```

You should see:
```
[app.message()] Received: {"type":"message","channel":"D...","channel_type":"im",...}
[app.message()] Channel info: {"is_im":true,...}
[app.message()] Processing as DM...
```

## 📝 Technical Notes

- **Manifest vs Configuration**: The manifest file (`slack-manifest.yaml`) is a template used during app creation. Changes to event subscriptions MUST be done through the Slack App settings web interface.

- **Event Types**: Slack has separate event types for different message sources:
  - `message.channels` - public/private channels
  - `message.im` - direct messages
  - `message.groups` - group DMs
  - `message.mpim` - multi-party DMs

- **Socket Mode**: KITT uses Socket Mode, so no public webhook URL is needed. However, event subscriptions still need to be explicitly added in app settings.

- **Code is Correct**: The bot.js code has proper handlers for DMs. The issue is purely configuration - Slack isn't sending the events to the bot.

## 🤖 Generated with Claude Code via Happy
