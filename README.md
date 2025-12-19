# KITT - Knight Industries Team Tool

🚗 Your advanced multilingual AI collaboration assistant for Slack

_"A shadowy flight into the dangerous world of team collaboration..."_

## What is KITT?

KITT (Knight Industries Team Tool) is an intelligent Slack bot that breaks down language barriers and enhances team collaboration with AI-powered features. Named after the iconic AI from Knight Rider, KITT is your team's sophisticated assistant, always ready to help.

## ✨ Key Features

🌐 **Multilingual Support** - Auto-detect Simplified/Traditional Chinese, English, Japanese, Korean
🤖 **AI-Powered Responses** - Natural language Q&A powered by local Ollama (qwen3-vl:4b)
📚 **Live PKM Sync** - Auto-loads IrisGo knowledge base from PKM-Vault
✅ **Approval Workflow** - Non-admin knowledge updates require admin approval
💬 **Seamless Integration** - Slash commands, @mentions, DMs

## 🏗️ Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Slack DM   │────▶│    KITT     │────▶│   Ollama    │
│  @mention   │     │   bot.js    │     │ qwen3-vl:4b │
│  /commands  │     └──────┬──────┘     └─────────────┘
└─────────────┘            │
                           ▼
              ┌────────────────────────┐
              │   PKM-Vault (Dropbox)  │
              │  └─ IrisGo/Product/    │
              │      ├─ knowledge-base │
              │      ├─ customers      │
              │      ├─ roadmap        │
              │      ├─ priorities     │
              │      └─ pm-memory      │
              └────────────────────────┘
```

## 🔐 Approval Workflow

Non-admin users sending knowledge updates go through approval:

1. **Rule-based filter** - Quick keyword detection (記錄/更新/邀請了/進度...)
2. **LLM confirmation** - qwen3-vl:4b confirms intent to reduce false positives
3. **Admin notification** - Lman receives DM with Approve/Reject buttons
4. **User feedback** - Submitter gets confirmation or rejection notice

## 🚀 Quick Start

```bash
cd ~/kitt-slackbot
npm install
npm start
```

### Prerequisites

- Node.js 18+
- Ollama with `qwen3-vl:4b` model
- Slack App with Socket Mode enabled

### Environment Variables

```bash
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
ADMIN_USER_ID=U08MZ609BGX
```

## 💬 Usage

**DM KITT directly**:
```
你知道我們 CES 2026 的進度嗎？
```

**Knowledge updates (requires approval)**:
```
記錄一下：Tony 邀請了小米參加 CES
```

**Slash commands**:
```
/kitt help
/kitt oem      # Show OEM pipeline
/kitt ces      # Show CES schedule
/kitt pending  # Show waiting items
```

## 🛠️ Tech Stack

- **Slack**: Bolt SDK + Socket Mode
- **AI**: Ollama (qwen3-vl:4b) - local, no API limits
- **Knowledge**: PKM-Vault markdown files with live file watching
- **Process Manager**: PM2

## 📖 Documentation

- [QUICK-START.md](QUICK-START.md) - Get running in 5 minutes
- [SETUP-GUIDE.md](SETUP-GUIDE.md) - Detailed configuration
- [KNOWLEDGE-BASE-UPDATE.md](KNOWLEDGE-BASE-UPDATE.md) - PKM integration details

## 🚀 Deploy

```bash
# Development
npm run dev

# Production
pm2 start bot.js --name kitt
pm2 save
```

## 📝 Recent Updates (2025-12)

- **Hybrid intent detection**: Rule-based + LLM confirmation for better accuracy
- **Simplified/Traditional Chinese support**: Separate language detection
- **Model upgrade**: Switched from gpt-oss:20b to qwen3-vl:4b for faster responses
- **Approval workflow**: Non-admin knowledge updates require admin approval

---

🚗 **KITT is ready to turbocharge your team collaboration!**

Built with ❤️ for the IrisGo team

Co-Authored-By: Claude <noreply@anthropic.com>
Co-Authored-By: Happy <yesreply@happy.engineering>
