/**
 * Knowledge Base Manager - Review Handler
 * 處理 Lman 審批 KB 更新
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const KB_CONFIG = require('../services/kb-config');
const { loadUpdate, loadPendingUpdates } = require('./kb-submit');

/**
 * 清理和修正會議記錄內容
 * 自動修正常見的語音辨識錯誤（如 Arisco -> IrisGo）
 */
function sanitizeContent(content) {
  if (!content) return content;

  // 常見的 IrisGo 誤寫修正
  const corrections = [
    { pattern: /\bArisco\b/gi, replacement: 'IrisGo' },
    { pattern: /\bIris\s+Go\b/gi, replacement: 'IrisGo' },
    { pattern: /\bIRISGO\b/g, replacement: 'IrisGo' },
    { pattern: /\birisgo\b/g, replacement: 'IrisGo' },
    { pattern: /\bIrisGO\b/g, replacement: 'IrisGo' },
    { pattern: /\bArisgo\b/gi, replacement: 'IrisGo' },
    { pattern: /\bIrisco\b/gi, replacement: 'IrisGo' },
    { pattern: /\bErisgo\b/gi, replacement: 'IrisGo' },
    // 可以繼續添加其他常見錯誤
  ];

  let sanitized = content;
  corrections.forEach(({ pattern, replacement }) => {
    sanitized = sanitized.replace(pattern, replacement);
  });

  return sanitized;
}

/**
 * 顯示 Pending Review 列表
 */
async function handlePendingReviewClick({ client, ack, body }) {
  await ack();

  const pendingUpdates = loadPendingUpdates();

  if (pendingUpdates.length === 0) {
    await client.chat.postMessage({
      channel: body.user.id,
      text: '📭 No pending updates to review.'
    });
    return;
  }

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: '⏳ Pending KB Updates' }
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `Total: *${pendingUpdates.length}* updates pending review`
      }
    },
    { type: 'divider' }
  ];

  pendingUpdates.forEach(update => {
    blocks.push(
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${update.type}* by <@${update.submitter.id}>\n_${new Date(update.submitted_at).toLocaleString('zh-TW')}_\n${update.content.substring(0, 150)}${update.content.length > 150 ? '...' : ''}`
        },
        accessory: {
          type: 'button',
          text: { type: 'plain_text', text: 'Review' },
          action_id: `kb_review_${update.id}`,
          value: update.id,
          style: 'primary'
        }
      },
      { type: 'divider' }
    );
  });

  await client.chat.postMessage({
    channel: body.user.id,
    blocks: blocks
  });
}

/**
 * 顯示單一 Update 的 Review Modal
 */
async function handleReviewClick({ client, ack, body }) {
  await ack();

  const updateId = body.actions[0].value;
  const update = loadUpdate(updateId);

  if (!update) {
    await client.chat.postMessage({
      channel: body.user.id,
      text: `❌ Update ${updateId} not found.`
    });
    return;
  }

  // 清理和修正內容（顯示修正後的版本）
  const sanitizedContent = sanitizeContent(update.content);
  const hasCorrections = sanitizedContent !== update.content;

  const modal = {
    type: 'modal',
    callback_id: 'kb_review_modal',
    title: { type: 'plain_text', text: 'Review Update' },
    close: { type: 'plain_text', text: 'Close' },
    private_metadata: updateId,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Type*: ${update.type}\n*From*: <@${update.submitter.id}>\n*Tags*: ${update.tags.join(', ') || 'none'}\n*Submitted*: ${new Date(update.submitted_at).toLocaleString('zh-TW')}${update.file_url ? `\n*File*: ${update.file_url}` : ''}${hasCorrections ? '\n⚠️ _內容已自動修正拼寫錯誤_' : ''}`
        }
      },
      { type: 'divider' },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Content*:\n\`\`\`\n${sanitizedContent}\n\`\`\``
        }
      },
      { type: 'divider' },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: '✅ Approve' },
            action_id: `kb_approve_${updateId}`,
            value: updateId,
            style: 'primary'
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: '✏️ Edit' },
            action_id: `kb_edit_${updateId}`,
            value: updateId
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: '❌ Reject' },
            action_id: `kb_reject_${updateId}`,
            value: updateId,
            style: 'danger'
          }
        ]
      }
    ]
  };

  await client.views.open({
    trigger_id: body.trigger_id,
    view: modal
  });
}

/**
 * 處理 Approve
 */
async function handleApprove({ client, ack, body }) {
  await ack();

  const updateId = body.actions[0].value;
  const update = loadUpdate(updateId);

  if (!update) {
    await client.chat.postMessage({
      channel: body.user.id,
      text: `❌ Update ${updateId} not found.`
    });
    return;
  }

  try {
    // 1. 歸檔到知識庫
    await archiveToKnowledgeBase(update);

    // 2. 執行自動同步
    await syncToNotebookLM();

    // 3. 更新狀態
    update.status = 'approved';
    update.approved_at = new Date().toISOString();
    update.approved_by = body.user.id;

    // 4. 移至 archive
    const archivePath = path.join(KB_CONFIG.pending.archive_dir, `${update.id}.json`);
    fs.writeFileSync(archivePath, JSON.stringify(update, null, 2));
    fs.unlinkSync(path.join(KB_CONFIG.pending.dir, `${update.id}.json`));

    // 5. 通知提交者
    await client.chat.postMessage({
      channel: update.submitter.id,
      text: `✅ *Your update has been approved!*\n\n*Type*: ${update.type}\n*ID*: ${update.id}\n\nYour content has been added to the Knowledge Base and synced to NotebookLM.`
    });

    // 6. 通知審批者
    await client.chat.postMessage({
      channel: body.user.id,
      text: `✅ Update *${update.id}* approved and synced successfully!`
    });

    console.log(`[KB] Approved: ${update.id}`);

  } catch (error) {
    console.error('[KB] Failed to approve update:', error);
    await client.chat.postMessage({
      channel: body.user.id,
      text: `❌ Failed to approve update: ${error.message}`
    });
  }
}

/**
 * 處理 Edit - 更新現有 Modal 為編輯模式
 */
async function handleEdit({ client, ack, body }) {
  // 立即 ack，確保 Slack 不會超時
  await ack();

  try {
    const updateId = body.actions[0].value;
    const update = loadUpdate(updateId);

    if (!update) {
      await client.chat.postMessage({
        channel: body.user.id,
        text: `❌ Update ${updateId} not found.`
      });
      return;
    }

    const modal = {
      type: 'modal',
      callback_id: `kb_edit_modal_${updateId}`,
      title: { type: 'plain_text', text: 'Edit Update' },
      submit: { type: 'plain_text', text: 'Save & Approve' },
      close: { type: 'plain_text', text: 'Cancel' },
      private_metadata: updateId,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Type*: ${update.type}\n*From*: <@${update.submitter.id}>\n*Tags*: ${update.tags.join(', ') || 'none'}`
          }
        },
        { type: 'divider' },
        {
          type: 'input',
          block_id: 'content_block',
          element: {
            type: 'plain_text_input',
            action_id: 'content_input',
            initial_value: update.content,
            multiline: true,
            placeholder: { type: 'plain_text', text: 'Edit content here...' }
          },
          label: { type: 'plain_text', text: 'Content' }
        }
      ]
    };

    // 使用 views.update 更新現有 modal，不需要 trigger_id
    await client.views.update({
      view_id: body.view.id,
      view: modal
    });

    console.log(`[KB] Edit modal opened for ${updateId}`);

  } catch (error) {
    console.error('[KB] Failed to open edit modal:', error);
    // 如果 modal update 失敗，發送 DM 作為備用方案
    await client.chat.postMessage({
      channel: body.user.id,
      text: `❌ 無法開啟編輯視窗，請關閉目前的視窗後重試。\n錯誤：${error.message}`
    });
  }
}

/**
 * 處理 Edit Modal Submission
 */
async function handleEditSubmission({ client, ack, view, body }) {
  await ack();

  const updateId = view.private_metadata;
  const update = loadUpdate(updateId);

  if (!update) {
    await client.chat.postMessage({
      channel: body.user.id,
      text: `❌ Update ${updateId} not found.`
    });
    return;
  }

  try {
    // 取得編輯後的內容
    const editedContent = view.state.values.content_block.content_input.value;

    // 更新 update 物件
    update.content = editedContent;
    update.edited_at = new Date().toISOString();
    update.edited_by = body.user.id;

    // 儲存修改
    const pendingPath = path.join(KB_CONFIG.pending.dir, `${update.id}.json`);
    fs.writeFileSync(pendingPath, JSON.stringify(update, null, 2));

    // 1. 歸檔到知識庫
    await archiveToKnowledgeBase(update);

    // 2. 執行自動同步
    await syncToNotebookLM();

    // 3. 更新狀態為 approved
    update.status = 'approved';
    update.approved_at = new Date().toISOString();
    update.approved_by = body.user.id;

    // 4. 移至 archive
    const archivePath = path.join(KB_CONFIG.pending.archive_dir, `${update.id}.json`);
    fs.writeFileSync(archivePath, JSON.stringify(update, null, 2));
    fs.unlinkSync(pendingPath);

    // 5. 通知提交者
    await client.chat.postMessage({
      channel: update.submitter.id,
      text: `✅ *Your update has been edited and approved!*\n\n*Type*: ${update.type}\n*ID*: ${update.id}\n\n_Content was modified by Lman before approval._`
    });

    // 6. 通知審批者
    await client.chat.postMessage({
      channel: body.user.id,
      text: `✅ Update *${update.id}* edited and approved successfully!`
    });

    console.log(`[KB] Edited & Approved: ${update.id}`);

  } catch (error) {
    console.error('[KB] Failed to edit update:', error);
    await client.chat.postMessage({
      channel: body.user.id,
      text: `❌ Failed to edit update: ${error.message}`
    });
  }
}

/**
 * 處理 Reject
 */
async function handleReject({ client, ack, body }) {
  await ack();

  const updateId = body.actions[0].value;
  const update = loadUpdate(updateId);

  if (!update) {
    await client.chat.postMessage({
      channel: body.user.id,
      text: `❌ Update ${updateId} not found.`
    });
    return;
  }

  try {
    // 更新狀態
    update.status = 'rejected';
    update.rejected_at = new Date().toISOString();
    update.rejected_by = body.user.id;

    // 移至 archive
    const archivePath = path.join(KB_CONFIG.pending.archive_dir, `${update.id}.json`);
    fs.writeFileSync(archivePath, JSON.stringify(update, null, 2));
    fs.unlinkSync(path.join(KB_CONFIG.pending.dir, `${update.id}.json`));

    // 通知提交者
    await client.chat.postMessage({
      channel: update.submitter.id,
      text: `❌ *Your update was rejected*\n\n*Type*: ${update.type}\n*ID*: ${update.id}\n\nIf you have questions, please reach out to Lman.`
    });

    // 通知審批者
    await client.chat.postMessage({
      channel: body.user.id,
      text: `❌ Update *${update.id}* rejected.`
    });

    console.log(`[KB] Rejected: ${update.id}`);

  } catch (error) {
    console.error('[KB] Failed to reject update:', error);
    await client.chat.postMessage({
      channel: body.user.id,
      text: `❌ Failed to reject update: ${error.message}`
    });
  }
}

/**
 * 歸檔到知識庫文件
 */
async function archiveToKnowledgeBase(update) {
  const typeConfig = KB_CONFIG.update_types.find(t => t.value === update.type);

  if (!typeConfig || !typeConfig.target_file) {
    throw new Error(`Unknown update type: ${update.type}`);
  }

  const targetFile = path.join(KB_CONFIG.local.pm_dir, typeConfig.target_file);

  if (!fs.existsSync(targetFile)) {
    throw new Error(`Target file not found: ${targetFile}`);
  }

  // 讀取現有內容
  let content = fs.readFileSync(targetFile, 'utf-8');

  // 清理和修正提交的內容
  const sanitizedContent = sanitizeContent(update.content);

  // 準備要追加的內容
  const timestamp = new Date().toISOString().split('T')[0];
  const fileInfo = update.file_url ? `\n**File**: ${update.file_url}` : '';
  const newEntry = `\n### ${update.type} (${timestamp}) 🆕\n\n${sanitizedContent}\n\n**From**: ${update.submitter.name}\n**Tags**: ${update.tags.join(', ')}${fileInfo}\n**狀態**: 已歸檔\n\n---\n`;

  // 找到對應 section 並插入
  const sectionMarker = `## ${typeConfig.section}`;
  const sectionIndex = content.indexOf(sectionMarker);

  if (sectionIndex !== -1) {
    // 找到下一個 ## 的位置
    const nextSectionIndex = content.indexOf('\n##', sectionIndex + sectionMarker.length);
    const insertPos = nextSectionIndex !== -1 ? nextSectionIndex : content.length;

    content = content.slice(0, insertPos) + newEntry + content.slice(insertPos);
  } else {
    // 如果找不到 section，追加到文件末尾
    content += newEntry;
  }

  // 更新 "最後更新" 時間戳
  const dateRegex = /> 最後更新：\d{4}-\d{2}-\d{2}/;
  if (dateRegex.test(content)) {
    content = content.replace(dateRegex, `> 最後更新：${timestamp}`);
  }

  // 寫回文件
  fs.writeFileSync(targetFile, content, 'utf-8');
  console.log(`[KB] Archived to ${typeConfig.target_file}`);
}

/**
 * 同步到 NotebookLM
 */
async function syncToNotebookLM() {
  const syncCommand = `cd ${KB_CONFIG.notebooklm.skill_path} && python3 scripts/run.py auto_sync.py --local "${KB_CONFIG.local.pm_dir}" --drive "${KB_CONFIG.drive.folder}" --notebook-url "${KB_CONFIG.notebooklm.notebook_url}"`;

  console.log('[KB] Syncing to NotebookLM...');

  try {
    execSync(syncCommand, {
      stdio: 'inherit',
      timeout: 120000 // 2 minutes timeout
    });
    console.log('[KB] Sync completed successfully');
  } catch (error) {
    console.error('[KB] Sync failed:', error.message);
    throw new Error(`NotebookLM sync failed: ${error.message}`);
  }
}

module.exports = {
  handlePendingReviewClick,
  handleReviewClick,
  handleApprove,
  handleEdit,
  handleEditSubmission,
  handleReject
};
