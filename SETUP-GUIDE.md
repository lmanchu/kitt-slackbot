# Iris PM Slack Bot - Setup Guide

Complete step-by-step guide to set up your multilingual Slack bot.

## Step 1: Create Slack App

### 1.1 Go to Slack API Console
Visit: https://api.slack.com/apps

### 1.2 Create New App
1. Click "Create New App"
2. Choose "From an app manifest"
3. Select your workspace
4. Paste the following manifest:

```yaml
display_information:
  name: Iris PM
  description: Multilingual team collaboration assistant
  background_color: "#22c55e"
features:
  bot_user:
    display_name: Iris PM
    always_online: true
  slash_commands:
    - command: /pm
      url: https://your-server.com/slack/events
      description: Iris PM commands
      usage_hint: help | translate | ask | status
oauth_config:
  scopes:
    bot:
      - app_mentions:read
      - channels:history
      - channels:read
      - chat:write
      - commands
      - im:history
      - im:read
      - im:write
      - users:read
settings:
  event_subscriptions:
    bot_events:
      - app_mention
      - message.channels
      - message.im
  interactivity:
    is_enabled: true
  org_deploy_enabled: false
  socket_mode_enabled: true
  token_rotation_enabled: false
```

5. Review permissions and create app

### 1.3 Enable Socket Mode
1. Go to **Socket Mode** in sidebar
2. Toggle "Enable Socket Mode" to **ON**
3. Generate an app-level token with `connections:write` scope
4. Name it "Iris PM Socket" and save
5. **Copy the token** (starts with `xapp-`)

### 1.4 Get Bot Token
1. Go to **OAuth & Permissions**
2. Click "Install to Workspace"
3. Authorize the app
4. **Copy Bot User OAuth Token** (starts with `xoxb-`)

### 1.5 Get Signing Secret
1. Go to **Basic Information**
2. Scroll to "App Credentials"
3. **Copy Signing Secret**

## Step 2: Get Gemini API Key

### 2.1 Visit Google AI Studio
Go to: https://aistudio.google.com/

### 2.2 Get API Key
1. Click "Get API Key"
2. Create a new project or select existing
3. Generate API key
4. **Copy the key**

## Step 3: Install Bot

### 3.1 Clone/Download Project
```bash
cd ~/iris-pm-slackbot
```

### 3.2 Install Dependencies
```bash
npm install
```

### 3.3 Configure Environment
```bash
cp .env.example .env
nano .env
```

Paste your credentials:
```env
SLACK_BOT_TOKEN=your-bot-token-here
SLACK_SIGNING_SECRET=your-signing-secret-here
SLACK_APP_TOKEN=your-app-token-here
GEMINI_API_KEY=your-gemini-api-key-here

PORT=3000
BOT_NAME=KITT
DEFAULT_LANGUAGE=zh-TW
```

Save and exit (Ctrl+X, Y, Enter)

## Step 4: Run Bot

### 4.1 Start Bot
```bash
npm start
```

You should see:
```
⚡️ Iris PM Slack Bot is running!
🤖 Bot Name: Iris PM
🌐 Default Language: zh-TW
🔌 Port: 3000
```

### 4.2 Test in Slack

**Test 1: Help Command**
```
/pm help
```

**Test 2: Translation**
```
/pm translate Hello team!
```

**Test 3: Mention**
```
@Iris PM hello!
```

**Test 4: Direct Message**
Send a DM to Iris PM:
```
Hi Iris!
```

## Step 5: Production Deployment

### Option A: Keep Running with PM2
```bash
# Install PM2
npm install -g pm2

# Start bot
pm2 start bot.js --name iris-pm-slackbot

# Save PM2 configuration
pm2 save

# Set PM2 to start on boot
pm2 startup
```

### Option B: Docker
```bash
# Create Dockerfile
cat > Dockerfile <<'EOF'
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

CMD ["node", "bot.js"]
EOF

# Build and run
docker build -t iris-pm-slackbot .
docker run -d --env-file .env --name iris-pm iris-pm-slackbot
```

### Option C: Cloud Hosting

**Heroku**:
```bash
# Install Heroku CLI
brew tap heroku/brew && brew install heroku

# Login
heroku login

# Create app
heroku create iris-pm-slackbot

# Set environment variables
heroku config:set SLACK_BOT_TOKEN=xoxb-...
heroku config:set SLACK_SIGNING_SECRET=...
heroku config:set SLACK_APP_TOKEN=xapp-...
heroku config:set GEMINI_API_KEY=...

# Deploy
git push heroku main
```

## Step 6: Advanced Configuration

### 6.1 Customize Bot Name
In `.env`:
```env
BOT_NAME=Your Custom Name
```

### 6.2 Change Default Language
```env
DEFAULT_LANGUAGE=en  # or ja, ko, es, etc.
```

### 6.3 Add Custom Commands
Edit `bot.js` and add new cases in the `/pm` command handler:

```javascript
case 'custom':
  await say('Your custom response!');
  break;
```

## Troubleshooting

### Problem: Bot doesn't start
**Solution**:
```bash
# Check Node version
node --version  # Should be 16+

# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install

# Check environment variables
cat .env  # Verify all tokens are set
```

### Problem: Bot starts but doesn't respond
**Solution**:
1. Verify Socket Mode is enabled in Slack app settings
2. Check bot is invited to channels: `/invite @Iris PM`
3. Review bot logs for errors

### Problem: Translation not working
**Solution**:
1. Test Gemini API key:
```bash
curl "https://generativelanguage.googleapis.com/v1/models/gemini-2.0-flash:generateContent?key=YOUR_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"contents":[{"parts":[{"text":"Hello"}]}]}'
```
2. Check API quota: https://ai.google.dev/

### Problem: Permission errors
**Solution**:
1. Reinstall app to workspace (OAuth & Permissions page)
2. Verify scopes match the manifest
3. Invite bot to channels

## Monitoring

### View Logs
```bash
# If using PM2
pm2 logs iris-pm-slackbot

# If using Docker
docker logs -f iris-pm

# If running directly
# Logs appear in terminal
```

### Check Status
```bash
# PM2
pm2 status

# Docker
docker ps | grep iris-pm

# Process
ps aux | grep bot.js
```

## Next Steps

1. ✅ Bot is running
2. ✅ Test all commands
3. ✅ Invite to team channels
4. 📢 Announce to team
5. 📊 Monitor usage
6. 🔧 Customize commands

## Support

- Check logs for errors
- Review Slack app settings
- Verify API keys and tokens
- Test with `/pm help` first

---

🚀 Your Iris PM bot is ready! Enjoy multilingual team collaboration!
