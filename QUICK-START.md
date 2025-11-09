# KITT Quick Start Guide

🚗 Get KITT running in your Slack workspace in 5 minutes!

## Step 1: Create Slack App (3 min)

1. Go to https://api.slack.com/apps
2. Click **"Create New App"** → **"From an app manifest"**
3. Select your workspace
4. **Copy and paste** the contents of `slack-manifest.yaml`
5. Click **Create**

## Step 2: Get Your Credentials (2 min)

### Enable Socket Mode
1. Go to **Socket Mode** in sidebar
2. Toggle **ON**
3. Generate token with `connections:write` scope
4. **Copy** the token (starts with `xapp-`)

### Get Bot Token
1. Go to **OAuth & Permissions**
2. Click **Install to Workspace**
3. Authorize
4. **Copy** Bot Token (starts with `xoxb-`)

### Get Signing Secret
1. Go to **Basic Information**
2. Scroll to **App Credentials**
3. **Copy** Signing Secret

### Get Gemini API Key
1. Go to https://aistudio.google.com/
2. Click **Get API Key**
3. **Copy** the key

## Step 3: Setup Environment

```bash
cd ~/kitt-slackbot

# Install dependencies
npm install

# Create .env file
cp .env.example .env

# Edit .env
nano .env
```

Paste your credentials:
```env
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...
SLACK_APP_TOKEN=xapp-...
GEMINI_API_KEY=...
```

Save (Ctrl+X, Y, Enter)

## Step 4: Run KITT

```bash
npm start
```

You should see:
```
⚡️ KITT is online!
🚗 Bot Name: KITT
📡 Full Name: Knight Industries Team Tool
🌐 Default Language: zh-TW
🔌 Port: 3000

💬 Ready to assist your team!
```

## Step 5: Test in Slack

### Test 1: Help Command
```
/kitt help
```

### Test 2: Translation
```
/kitt translate Good morning team!
```

Expected output:
```
Original (en): Good morning team!

Translations:
• zh-TW: 大家早安！
• ja: おはようございます！
• ko: 좋은 아침입니다！
```

### Test 3: Ask Question
```
/kitt ask What's our team doing today?
```

### Test 4: Mention
In any channel:
```
@KITT hello!
```

### Test 5: Direct Message
Send a DM to KITT:
```
Hi KITT, can you help me?
```

## Done! 🎉

KITT is now assisting your team with:
- 🌐 Multilingual translation
- 🤖 AI-powered responses
- 💬 Natural language conversation
- 👥 Team collaboration

## Common Commands

```bash
/kitt help              # Show all commands
/kitt translate [text]  # Translate to multiple languages
/kitt ask [question]    # Ask KITT anything
/kitt status            # Check system status
```

## Keep Running (Production)

### Option 1: PM2
```bash
npm install -g pm2
pm2 start bot.js --name kitt
pm2 save
```

### Option 2: Screen/Tmux
```bash
screen -S kitt
npm start
# Press Ctrl+A then D to detach
```

## Troubleshooting

**Bot doesn't respond?**
- Check tokens in `.env`
- Verify Socket Mode is ON
- Invite bot to channels: `/invite @KITT`

**Translation not working?**
- Verify Gemini API key
- Check quota: https://ai.google.dev/

**Need help?**
- Check logs in terminal
- Read full docs in `README.md`

---

🚗 KITT is ready to turbocharge your team collaboration!
