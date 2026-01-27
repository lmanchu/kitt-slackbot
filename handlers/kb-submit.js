/**
 * Knowledge Base Manager - Submit Handler
 * 處理團隊成員提交 KB 更新
 */

const fs = require('fs');
const path = require('path');
const KB_CONFIG = require('../services/kb-config');

/**
 * 處理 Submit Update 按鈕點擊
 */
async function handleSubmitClick({ client, ack, body }) {
  await ack();

  const modal = {
    type: 'modal',
    callback_id: 'kb_submit_modal',
    title: { type: 'plain_text', text: 'Submit KB Update' },
    submit: { type: 'plain_text', text: 'Submit' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*💡 提示*：如需附加檔案，請先在私訊中上傳檔案，KITT 會自動偵測最近上傳的檔案。'
        }
      },
      { type: 'divider' },
      {
        type: 'input',
        block_id: 'update_type',
        label: { type: 'plain_text', text: 'Update Type' },
        element: {
          type: 'static_select',
          action_id: 'type_select',
          placeholder: { type: 'plain_text', text: 'Select update type' },
          options: KB_CONFIG.update_types.map(t => ({
            text: { type: 'plain_text', text: `${t.label} - ${t.description}` },
            value: t.value
          }))
        }
      },
      {
        type: 'input',
        block_id: 'tags',
        label: { type: 'plain_text', text: 'Related Tags' },
        optional: true,
        element: {
          type: 'multi_static_select',
          action_id: 'tags_select',
          placeholder: { type: 'plain_text', text: 'Select relevant tags' },
          options: KB_CONFIG.tags.map(t => ({
            text: { type: 'plain_text', text: t.label },
            value: t.value
          }))
        }
      },
      {
        type: 'input',
        block_id: 'file_url',
        label: { type: 'plain_text', text: 'File Link (Optional)' },
        optional: true,
        element: {
          type: 'plain_text_input',
          action_id: 'file_url_input',
          placeholder: { type: 'plain_text', text: '貼上 Slack 檔案連結或外部 URL...' }
        }
      },
      {
        type: 'input',
        block_id: 'content',
        label: { type: 'plain_text', text: 'Content' },
        element: {
          type: 'plain_text_input',
          action_id: 'content_input',
          multiline: true,
          placeholder: { type: 'plain_text', text: 'Paste meeting notes, updates, or description...' }
        }
      }
    ]
  };

  await client.views.open({
    trigger_id: body.trigger_id,
    view: modal
  });
}

/**
 * 處理 Modal 提交
 */
async function handleSubmitModalSubmission({ client, ack, view, body }) {
  await ack();

  const values = view.state.values;
  const fileUrl = values.file_url?.file_url_input?.value || null;

  const update = {
    id: `update-${Date.now()}`,
    type: values.update_type.type_select.selected_option.value,
    tags: values.tags.tags_select.selected_options?.map(o => o.value) || [],
    content: values.content.content_input.value,
    file_url: fileUrl,
    submitter: {
      id: body.user.id,
      name: body.user.name
    },
    submitted_at: new Date().toISOString(),
    status: 'pending'
  };

  // 儲存到 pending-updates/
  const filename = `${update.id}.json`;
  const filepath = path.join(KB_CONFIG.pending.dir, filename);

  try {
    fs.writeFileSync(filepath, JSON.stringify(update, null, 2));
    console.log(`[KB] Update submitted: ${update.id} by ${update.submitter.name}`);

    // 通知提交者
    await client.chat.postMessage({
      channel: body.user.id,
      text: `✅ Your update has been submitted for review!\n\n*Type*: ${update.type}\n*ID*: ${update.id}${fileUrl ? `\n*File*: ${fileUrl}` : ''}\n\nYou'll be notified once Lman reviews it.`
    });

    // 通知 Lman（ADMIN_USER_ID）
    const ADMIN_USER_ID = process.env.ADMIN_USER_ID;
    if (ADMIN_USER_ID) {
      await client.chat.postMessage({
        channel: ADMIN_USER_ID,
        text: `📚 *New KB Update Pending Review*\n\n*From*: <@${update.submitter.id}>\n*Type*: ${update.type}\n*Tags*: ${update.tags.join(', ') || 'none'}${fileUrl ? `\n*File*: ${fileUrl}` : ''}\n\n*Preview*:\n${update.content.substring(0, 200)}${update.content.length > 200 ? '...' : ''}\n\nReview in KITT App Home → Pending Review`
      });
    }

  } catch (error) {
    console.error('[KB] Failed to save update:', error);

    // 通知提交者失敗
    await client.chat.postMessage({
      channel: body.user.id,
      text: `❌ Failed to submit update. Please try again or contact support.`
    });
  }
}

/**
 * 載入所有 pending updates
 */
function loadPendingUpdates() {
  try {
    const files = fs.readdirSync(KB_CONFIG.pending.dir);
    const updates = files
      .filter(f => f.endsWith('.json'))
      .map(f => {
        const filepath = path.join(KB_CONFIG.pending.dir, f);
        return JSON.parse(fs.readFileSync(filepath, 'utf-8'));
      })
      .sort((a, b) => new Date(b.submitted_at) - new Date(a.submitted_at));

    return updates;
  } catch (error) {
    console.error('[KB] Failed to load pending updates:', error);
    return [];
  }
}

/**
 * 載入單一 update
 */
function loadUpdate(updateId) {
  try {
    const filepath = path.join(KB_CONFIG.pending.dir, `${updateId}.json`);
    return JSON.parse(fs.readFileSync(filepath, 'utf-8'));
  } catch (error) {
    console.error(`[KB] Failed to load update ${updateId}:`, error);
    return null;
  }
}

module.exports = {
  handleSubmitClick,
  handleSubmitModalSubmission,
  loadPendingUpdates,
  loadUpdate
};
