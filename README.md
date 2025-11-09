# KITT - Knight Industries Team Tool

🚗 Your advanced multilingual AI collaboration assistant for Slack

_"A shadowy flight into the dangerous world of team collaboration..."_

## What is KITT?

KITT (Knight Industries Team Tool) is an intelligent Slack bot that breaks down language barriers and enhances team collaboration with AI-powered features. Named after the iconic AI from Knight Rider, KITT is your team's sophisticated assistant, always ready to help.

## ✨ Key Features

🌐 **Multilingual Translation** - Auto-detect and translate to zh-TW, en, ja, ko, and more
🤖 **AI-Powered Responses** - Natural language Q&A in your language  
💬 **Seamless Integration** - Slash commands, @mentions, DMs
📊 **Team Collaboration** - Break down language barriers instantly

## 🚀 Quick Start (5 minutes)

👉 See [QUICK-START.md](QUICK-START.md) for complete setup

```bash
cd ~/kitt-slackbot
npm install
npm start
```

Then test in Slack:
```
/kitt help
/kitt translate Good morning team!
```

## 💬 Example Usage

**Translation**:
```
/kitt translate 今天的目標：完成 API 整合

Output:
• en: Today's goal: Complete API integration
• ja: 今日の目標：API統合を完了する
• ko: 오늘의 목표: API 통합 완료
```

**AI Q&A**:
```
/kitt ask What's our project status?
```

**@Mention**:
```
@KITT can you help with the deployment?
```

## 📖 Documentation

- [QUICK-START.md](QUICK-START.md) - Get running in 5 minutes
- [SETUP-GUIDE.md](SETUP-GUIDE.md) - Detailed configuration
- [slack-manifest.yaml](slack-manifest.yaml) - Slack app manifest

## 🎯 Perfect For

- ✅ Multilingual teams (Taiwan-Japan-Korea collaboration)
- ✅ Global remote teams
- ✅ International projects
- ✅ Customer support across languages

## 🛠️ Tech Stack

- Slack Bolt + Socket Mode
- Google Gemini AI
- Node.js

## 🚀 Deploy

**Development**: `npm run dev`
**Production**: `pm2 start bot.js --name kitt`

---

🚗 **KITT is ready to turbocharge your team collaboration!**

Built with ❤️ for the IrisGo team

Co-Authored-By: Claude <noreply@anthropic.com>
Co-Authored-By: Happy <yesreply@happy.engineering>
