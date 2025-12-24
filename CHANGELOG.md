# Changelog

All notable changes to KITT Slack Bot will be documented in this file.

## [1.2.0] - 2025-12-24

### Added
- **App Home Tab**: Interactive home page for team members
  - Shows Lman's current focus (auto-parsed from priorities.md)
  - One-click meeting booking via Google Calendar
  - Recent updates section with approved announcements
  - Quick action buttons: Company Intro, Product Direction, Team Resources
  - "Leave Message for Lman" feature with type selection (Idea/Question/Update/Urgent)
  - Messages auto-forwarded to Lman's DM with quick reply button
- New event handler: `app_home_opened`
- New action handlers: `home_view_priorities`, `home_view_all_updates`, `home_company_intro`, `home_product_direction`, `home_team_resources`, `home_leave_message`
- Modal forms: Leave message modal, Quick reply modal

### Changed
- KITT now serves as a gateway for team members to access company info and reach Lman

## [1.1.0] - 2025-12-22

### Added
- **Conversation Memory**: KITT now remembers recent conversations per user
  - Stores last 10 message pairs per user
  - 30-minute timeout for conversation context
  - Enables contextual responses that reference previous messages
- New functions: `addToConversation()`, `getConversationHistory()`, `clearConversation()`, `formatConversationForPrompt()`

### Changed
- AI prompt generation now includes conversation history for better context

## [1.0.2] - 2025-12-19

### Fixed
- Reverted to `gpt-oss:20b` model for better response quality

## [1.0.1] - 2025-12-18

### Added
- Hybrid intent detection for knowledge updates
- Simplified Chinese language support

## [1.0.0] - 2025-12-17

### Added
- Initial release
- PKM knowledge base integration (read from Obsidian vault)
- Admin review workflow for knowledge updates
- Slash commands: `/kitt oem`, `/kitt pending`, `/kitt ces`
- Multilingual support (Traditional Chinese, Simplified Chinese, English, Japanese)
- Gemini AI integration for natural language responses
