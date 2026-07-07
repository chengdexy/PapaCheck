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

  return {
    method: event.httpMethod,
    path: event.path,
    headers,
    query: event.queryStringParameters || {},
    body,
  };
}
