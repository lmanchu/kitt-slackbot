/**
 * Knowledge Base Manager - Configuration
 * 配置 NotebookLM 同步和知識庫設定
 */

const path = require('path');

const KB_CONFIG = {
  // NotebookLM 設定
  notebooklm: {
    notebook_id: 'irisgo-pm-knowledge-base',
    notebook_url: 'https://notebooklm.google.com/notebook/30d11cb1-5663-4755-9344-f1cf6f3d613e',
    skill_path: path.join(process.env.HOME, '.claude/skills/notebooklm')
  },

  // 本地 PM 文件路徑
  local: {
    pm_dir: path.join(process.env.HOME, 'Dropbox/PKM-Vault/1-Projects/IrisGo/Product'),
    pm_memory: path.join(process.env.HOME, 'Dropbox/PKM-Vault/1-Projects/IrisGo/Product/pm-memory.md'),
    customers: path.join(process.env.HOME, 'Dropbox/PKM-Vault/1-Projects/IrisGo/Product/customers.md'),
    priorities: path.join(process.env.HOME, 'Dropbox/PKM-Vault/1-Projects/IrisGo/Product/priorities.md')
  },

  // Google Drive 設定
  drive: {
    folder: 'NotebookLM-Sources/IrisGo-PM',
    folder_id: '15slyQFtU2B14ZxYjGjCy6uY7ShbRPM67'
  },

  // Pending updates 設定
  pending: {
    dir: path.join(__dirname, '../pending-updates'),
    archive_dir: path.join(__dirname, '../pending-archive')
  },

  // Update 類型定義
  update_types: [
    {
      value: 'meeting',
      label: 'Meeting Record',
      description: '會議記錄',
      target_file: 'pm-memory.md',
      section: '決策脈絡'
    },
    {
      value: 'customer',
      label: 'Customer Update',
      description: '客戶進度更新',
      target_file: 'customers.md',
      section: 'OEM Partners'
    },
    {
      value: 'priority',
      label: 'Priority Update',
      description: '優先級調整',
      target_file: 'priorities.md',
      section: 'P0 - Critical'
    },
    {
      value: 'decision',
      label: 'Decision',
      description: '重要決策記錄',
      target_file: 'pm-memory.md',
      section: '決策脈絡'
    },
    {
      value: 'other',
      label: 'Other',
      description: '其他類型',
      target_file: null,
      section: null
    }
  ],

  // 標籤選項
  tags: [
    { value: 'acer', label: 'Acer' },
    { value: 'asus', label: 'ASUS' },
    { value: 'mouse', label: 'Mouse Computer' },
    { value: 'gigabyte', label: 'Gigabyte' },
    { value: 'hp', label: 'HP' },
    { value: 'lenovo', label: 'Lenovo' },
    { value: 'ces', label: 'CES' },
    { value: 'computex', label: 'Computex' },
    { value: 'series-a', label: 'Series A' },
    { value: 'product', label: 'Product' },
    { value: 'fundraising', label: 'Fundraising' },
    { value: 'partnership', label: 'Partnership' }
  ]
};

module.exports = KB_CONFIG;
