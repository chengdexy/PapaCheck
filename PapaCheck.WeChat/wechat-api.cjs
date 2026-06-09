// PapaCheck.WeChat/wechat-api.cjs
// 微信公众号草稿 API 封装

const https = require('https');
const fs = require('fs');
const path = require('path');

class WeChatAPI {
  constructor(config) {
    this.appId = config.appId || process.env.WECHAT_APPID;
    this.appSecret = config.appSecret || process.env.WECHAT_APPSECRET;
    this.accessToken = null;
    this.tokenExpiresAt = 0;
  }

  async _request(method, url, body, contentType) {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const options = {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method,
        headers: {}
      };
      if (contentType) options.headers['Content-Type'] = contentType;
      if (body && typeof body === 'object') body = JSON.stringify(body);

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch { resolve(data); }
        });
      });
      req.on('error', reject);
      if (body) req.write(body);
      req.end();
    });
  }

  async getAccessToken() {
    if (this.accessToken && Date.now() < this.tokenExpiresAt) {
      return this.accessToken;
    }
    const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${this.appId}&secret=${this.appSecret}`;
    const res = await this._request('GET', url);
    if (res.access_token) {
      this.accessToken = res.access_token;
      this.tokenExpiresAt = Date.now() + (res.expires_in - 300) * 1000;
      return this.accessToken;
    }
    throw new Error('获取 access_token 失败: ' + JSON.stringify(res));
  }

  async uploadImage(filePath) {
    const token = await this.getAccessToken();
    const url = `https://api.weixin.qq.com/cgi-bin/material/add_material?access_token=${token}&type=image`;
    const boundary = '----FormBoundary' + Math.random().toString(36).substring(2);
    const fileName = path.basename(filePath);
    const fileBuffer = fs.readFileSync(filePath);

    let body = Buffer.concat([
      Buffer.from(`--${boundary}\r\n`),
      Buffer.from(`Content-Disposition: form-data; name="media"; filename="${fileName}"\r\n`),
      Buffer.from('Content-Type: image/jpeg\r\n\r\n'),
      fileBuffer,
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);

    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const req = https.request({
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': body.length
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.media_id) resolve(json.media_id);
            else reject(new Error('上传素材失败: ' + data));
          } catch { reject(new Error(data)); }
        });
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  async createDraft(title, content, digest, thumbMediaId, author) {
    const token = await this.getAccessToken();
    const url = `https://api.weixin.qq.com/cgi-bin/draft/add?access_token=${token}`;
    const payload = {
      articles: [{
        title: title.substring(0, 32),
        thumb_media_id: thumbMediaId,
        author: (author || 'PapaCheck').substring(0, 16),
        digest: (digest || '').substring(0, 128),
        show_cover_pic: 1,
        content: content,
        content_source_url: '',
        need_open_comment: 1,
        only_fans_can_comment: 0
      }]
    };
    const res = await this._request('POST', url, payload, 'application/json');
    if (res.media_id) return res.media_id;
    throw new Error('创建草稿失败: ' + JSON.stringify(res));
  }
}

// CLI 入口：接收 JSON 配置从 stdin
async function main() {
  let input = '';
  process.stdin.setEncoding('utf-8');
  process.stdin.on('data', chunk => input += chunk);
  process.stdin.on('end', async () => {
    try {
      const config = JSON.parse(input);
      const api = new WeChatAPI(config);

      if (config.action === 'upload') {
        const mediaId = await api.uploadImage(config.filePath);
        process.stdout.write(JSON.stringify({ ok: true, media_id: mediaId }));
      } else if (config.action === 'draft') {
        const mediaId = await api.createDraft(
          config.title, config.content, config.digest,
          config.thumbMediaId, config.author
        );
        process.stdout.write(JSON.stringify({ ok: true, media_id: mediaId }));
      } else {
        process.stdout.write(JSON.stringify({ ok: false, error: '未知 action: ' + config.action }));
      }
    } catch (e) {
      process.stdout.write(JSON.stringify({ ok: false, error: e.message }));
    }
  });
}

if (require.main === module) {
  main();
}

module.exports = WeChatAPI;
