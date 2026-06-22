import Connection from 'imap';
import { simpleParser } from 'mailparser';
import type { ParsedMail } from 'mailparser';
import { PassThrough } from 'stream';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

export interface ImapConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  markAsRead?: boolean;
  attachmentDir?: string;
}

export interface EmailMessage {
  uid: number;
  subject: string;
  from: string;
  date: string;
  text: string;
  html?: string;
  hasAttachments: boolean;
}

/**
 * 连接 IMAP 服务器，返回连接对象
 */
export function connect(config: ImapConfig): Promise<Connection> {
  return new Promise((resolve, reject) => {
    const imap = new Connection({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      tls: config.port === 993,
    });

    imap.once('ready', () => {
      resolve(imap);
    });

    imap.once('error', (err: Error) => {
      reject(err);
    });

    imap.connect();
  });
}

/**
 * 获取未读邮件列表，解析邮件内容返回 EmailMessage[]
 */
export function fetchUnseen(imap: Connection, markAsRead = true, attachmentDir?: string): Promise<EmailMessage[]> {
  return new Promise((resolve, reject) => {
    imap.openBox('INBOX', false, (openErr) => {
      if (openErr) {
        try { imap.end(); } catch { /* ignore */ }
        return reject(openErr);
      }

      imap.search(['UNSEEN'], (searchErr, results) => {
        if (searchErr) {
          try { imap.end(); } catch { /* ignore */ }
          return reject(searchErr);
        }

        if (!results || results.length === 0) {
          imap.end();
          return resolve([]);
        }

        const fetch = imap.fetch(results, { bodies: '' });
        const messages: EmailMessage[] = [];
        const uids: number[] = [];
        let pending = results.length;

        let settled = false;

        fetch.on('message', (msg, seqno) => {
          const chunks: Buffer[] = [];

          msg.on('error', () => {
            pending--;
            if (pending <= 0) {
              if (!settled) {
                settled = true;
                imap.end();
                resolve(messages);
              }
            }
          });

          msg.on('body', (stream, info) => {
            stream.on('error', () => { /* ignore stream error */ });
            stream.on('data', (chunk: Buffer) => {
              chunks.push(chunk);
            });
          });

          msg.once('attributes', (attrs) => {
            const uid = attrs.uid;
            uids.push(uid);
            msg.once('end', async () => {
              const raw = Buffer.concat(chunks);
              try {
                const parsed = await simpleParser(raw) as ParsedMail;
                messages.push({
                  uid,
                  subject: parsed.subject || '',
                  from: typeof parsed.from === 'object' && parsed.from ? parsed.from.text || '' : '',
                  date: parsed.date ? parsed.date.toISOString() : '',
                  text: parsed.text || '',
                  html: parsed.html as string | undefined,
                  hasAttachments: Array.isArray(parsed.attachments) && parsed.attachments.length > 0,
                });

                // 保存附件到附件目录
                if (attachmentDir && Array.isArray(parsed.attachments) && parsed.attachments.length > 0) {
                  try {
                    await mkdir(attachmentDir, { recursive: true });
                    for (const att of parsed.attachments) {
                      if (att.filename && att.content) {
                        const prefix = Date.now() + '-' + Math.random().toString(36).slice(2,6) + '-';
                        const filePath = join(attachmentDir, prefix + att.filename);
                        await writeFile(filePath, att.content);
                      }
                    }
                  } catch {
                    // 附件下载失败不影响主流程
                  }
                }
              } catch {
                // skip parse errors
              }
              pending -= 1;
              if (pending === 0) {
                if (!settled) {
                  settled = true;
                  if (markAsRead && uids.length > 0) {
                    imap.addFlags(uids, '\\Seen', () => {
                      imap.end();
                      resolve(messages);
                    });
                  } else {
                    imap.end();
                    resolve(messages);
                  }
                }
              }
            });
          });
        });

        fetch.once('error', (fetchErr) => {
          if (settled) return;
          settled = true;
          imap.end();
          reject(fetchErr);
        });
      });
    });
  });
}
