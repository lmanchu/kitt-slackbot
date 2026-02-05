/**
 * Slack mrkdwn Format Utilities
 * Converts standard Markdown to Slack's mrkdwn format
 */

/**
 * Convert Markdown to Slack mrkdwn
 * @param {string} text - Markdown formatted text
 * @returns {string} - Slack mrkdwn formatted text
 */
function formatForSlack(text) {
  if (!text) return '';

  let result = text;

  // Convert bold: **text** or __text__ → *text*
  result = result.replace(/\*\*(.+?)\*\*/g, '*$1*');
  result = result.replace(/__(.+?)__/g, '*$1*');

  // Convert strikethrough: ~~text~~ → ~text~
  result = result.replace(/~~(.+?)~~/g, '~$1~');

  // Convert code blocks: ```lang\ncode\n``` → ```code```
  result = result.replace(/```\w*\n([\s\S]*?)```/g, '```$1```');

  // Convert links: [text](url) → <url|text>
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<$2|$1>');

  // Convert headers: # Header → *Header* (bold, since Slack has no headers)
  result = result.replace(/^#{1,6}\s+(.+)$/gm, '*$1*');

  // Convert unordered lists: - item or * item → • item
  result = result.replace(/^[\-\*]\s+/gm, '• ');

  // Convert horizontal rules: --- or *** → ───────────
  result = result.replace(/^(-{3,}|\*{3,})$/gm, '───────────');

  return result;
}

module.exports = { formatForSlack };
