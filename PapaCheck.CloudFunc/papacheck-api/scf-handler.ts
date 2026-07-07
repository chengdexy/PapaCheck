export interface ScfEvent {
  httpMethod: string;
  path: string;
  headers: Record<string, string> | null;
  queryStringParameters: Record<string, string> | null;
  body: string | null;
  isBase64Encoded?: boolean;
}

export interface ParsedRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  query: Record<string, string>;
  body: any;
}

export function parseGatewayEvent(event: ScfEvent): ParsedRequest {
  const headers: Record<string, string> = {};
  if (event.headers) {
    for (const [key, value] of Object.entries(event.headers)) {
      headers[key.toLowerCase()] = value;
    }
  }

  let body: any = null;
  if (event.body) {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf-8')
      : event.body;
    const contentType = headers['content-type'] || '';
    if (contentType.includes('application/json')) {
      try {
        body = JSON.parse(raw);
      } catch {
        body = raw;
      }
    } else {
      body = raw;
    }
  }

  // 剥离 /papacheck 前缀（CloudBase 网关透传完整路径，Fastify 路由不含前缀）
  let path = event.path;
  const URL_PREFIX = '/papacheck';
  if (path.startsWith(URL_PREFIX)) {
    path = path.substring(URL_PREFIX.length);
    if (!path.startsWith('/')) {
      path = '/' + path;
    }
  }

  return {
    method: event.httpMethod,
    path,
    headers,
    query: event.queryStringParameters || {},
    body,
  };
}
