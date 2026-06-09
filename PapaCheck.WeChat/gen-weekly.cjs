// PapaCheck.WeChat/gen-weekly.cjs
// 将 Markdown 文章转换为微信兼容 HTML

const WECHAT_CSS = `
section { margin-bottom: 24px; }
h2 { font-size: 18px; color: #1F6C9F; margin-bottom: 12px; border-left: 3px solid #1F6C9F; padding-left: 10px; }
h3 { font-size: 15px; color: #333; margin: 16px 0 8px; }
p { font-size: 15px; color: #444; line-height: 1.8; margin-bottom: 10px; }
strong { color: #111; }
em { color: #787774; }
ul { padding-left: 20px; margin-bottom: 12px; }
li { font-size: 14px; color: #555; line-height: 1.7; margin-bottom: 4px; }
blockquote { border-left: 3px solid #EAEAEA; padding: 10px 14px; margin: 12px 0; background: #F9F9F8; color: #666; font-size: 14px; }
.separator { text-align: center; color: #CCC; margin: 20px 0; font-size: 12px; }
.end { text-align: center; color: #9F9F9F; font-size: 13px; margin-top: 32px; }
`;

function markdownToWeChat(md) {
  let html = md;

  // Headers
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');

  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // Italic
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Unordered lists
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');

  // Blockquotes
  html = html.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');

  // Separators
  html = html.replace(/^---$/gm, '<p class="separator">· · ·</p>');

  // Paragraphs (double newline)
  html = html.replace(/\n\n/g, '</p><p>');
  html = '<p>' + html + '</p>';

  // Clean up empty paragraphs
  html = html.replace(/<p>\s*<\/p>/g, '');
  html = html.replace(/<p><(h[23]|ul|blockquote)/g, '<$1');
  html = html.replace(/<\/(h[23]|ul|blockquote)><\/p>/g, '</$1>');

  return `<style>${WECHAT_CSS}</style><section>${html}</section>`;
}

// CLI: read markdown from stdin, output HTML to stdout
function main() {
  let input = '';
  process.stdin.setEncoding('utf-8');
  process.stdin.on('data', chunk => input += chunk);
  process.stdin.on('end', () => {
    const html = markdownToWeChat(input.trim());
    process.stdout.write(html);
  });
}

if (require.main === module) {
  main();
}

module.exports = { markdownToWeChat };
