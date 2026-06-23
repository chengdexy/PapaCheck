import { connect, fetchUnseen, type ImapConfig } from './imap.js';
import { callAI, parseHomework, type HomeworkItem } from './ai.js';

export type { ImapConfig, EmailMessage } from './imap.js';
export type { HomeworkItem } from './ai.js';

export interface EmailSyncConfig extends ImapConfig {
  apiKey: string;
  apiUrl: string;
  markAsRead?: boolean;
}

export interface EmailSyncResult {
  ok: boolean;
  homeworks?: HomeworkItem[];
  error?: string;
  hasAttachments?: boolean;
}

/**
 * 邮件同步主类
 *
 * 负责：连接 IMAP → 获取未读邮件 → AI 解析 → 返回作业项
 */
export class EmailSync {
  private config: EmailSyncConfig;

  constructor(config: EmailSyncConfig) {
    this.config = config;
  }

  /**
   * 执行邮件同步
   * 1. 连接 IMAP 服务器
   * 2. 获取未读邮件
   * 3. 用 AI 解析邮件内容提取作业
   * 4. 返回解析结果
   */
  async sync(): Promise<EmailSyncResult> {
    try {
      // 1. 连接 IMAP
      const imap = await connect({
        host: this.config.host,
        port: this.config.port,
        user: this.config.user,
        password: this.config.password,
      });

      // 2. 获取未读邮件
      const messages = await fetchUnseen(imap, this.config.markAsRead, this.config.attachmentDir);

      if (messages.length === 0) {
        return { ok: true, homeworks: [] };
      }

      // 3. 拼接邮件内容用于 AI 解析
      const emailText = messages
        .map((m) => `主题: ${m.subject}\n发件人: ${m.from}\n日期: ${m.date}\n内容: ${m.text}`)
        .join('\n---\n');

      const prompt = `请从以下邮件内容中提取孩子的作业：\n\n${emailText}`;

      // 4. 调用 AI API
      const aiResponse = await callAI(prompt, this.config.apiKey, this.config.apiUrl);

      // 5. 解析作业
      const homeworks = parseHomework(aiResponse);

      // 6. 检查是否有附件
      const hasAttachments = messages.some((m) => m.hasAttachments);

      return { ok: true, homeworks, hasAttachments };
    } catch (err) {
      const message = err instanceof Error ? err.message : '未知错误';
      return { ok: false, error: message };
    }
  }
}
