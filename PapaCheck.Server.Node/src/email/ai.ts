export interface HomeworkItem {
  subject: string;
  content: string;
  date?: string;
  suggestedDuration?: number;
  basePoints?: number;
}

export interface AIResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

/**
 * 构建 AI API 端点 URL：兼容用户只配置了 base URL 的情况
 */
export function buildAIEndpoint(apiUrl: string): string {
  return apiUrl.includes('/chat/completions')
    ? apiUrl
    : apiUrl.replace(/\/+$/, '') + '/chat/completions';
}

/**
 * 调用 OpenAI/DeepSeek 兼容 API
 */
export async function callAI(
  prompt: string,
  apiKey: string,
  apiUrl: string
): Promise<string> {
  const endpoint = buildAIEndpoint(apiUrl);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        {
          role: 'system',
          content:
            '你是一个作业清单解析器。下面一段是待解析的邮件内容，请从中提取作业信息，并严格按照 JSON 格式返回。\n' +
            '\n' +
            '## 输出格式\n' +
            '\n' +
            '[\n' +
            '  {"subject": "道德与法治", "content": "完成第10课练习题", "date": "2026-06-07"},\n' +
            '  {"subject": "数学", "content": "练习册第15-20页", "date": "2026-06-07"},\n' +
            '  {"subject": "数学", "content": "口算一页", "date": "2026-06-07"},\n' +
            '  {"subject": "英语", "content": "熟读Unit 5单词", "date": "2026-06-07"},\n' +
            '  {"subject": "语文", "content": "背诵课文第3课", "date": "2026-06-07"}\n' +
            ']\n' +
            '\n' +
            '## 规则\n' +
            '\n' +
            '1. 判断作业内容：只提取明确描述作业/任务的条目，过滤聊天记录、问候语、签名等无关内容。如果整段与作业无关，返回空数组 []。\n' +
            '2. 提取科目：从描述中识别科目（如语文/数学/英语/科学/道德与法治等）。同一科目有多项作业时分别列出，不要合并。无法判断时用"其他"，不要臆造。\n' +
            '3. 日期字段：使用邮件中的日期或上下文日期，格式为 YYYY-MM-DD。\n' +
            '\n' +
            '## 约束\n' +
            '\n' +
            '只输出 JSON 数组，不要输出任何解释、说明或额外文字。无作业内容时返回 []。',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.1,
    }),
  });

  if (!response.ok) {
    throw new Error(`AI API 调用失败: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as AIResponse;
  if (!data.choices || data.choices.length === 0) {
    throw new Error('AI API 返回空结果');
  }

  return data.choices[0].message.content;
}

/**
 * 解析 AI 回复内容，提取作业项列表
 */
export function parseHomework(text: string): HomeworkItem[] {
  // 优先尝试直接解析纯 JSON
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (item: any) =>
          item && typeof item.subject === 'string' && typeof item.content === 'string'
      );
    }
    return [];
  } catch {
    // 部分 AI 模型可能仍返回 markdown 代码块包裹，回退提取
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1].trim());
        if (Array.isArray(parsed)) {
          return parsed.filter(
            (item: any) =>
              item && typeof item.subject === 'string' && typeof item.content === 'string'
          );
        }
      } catch {
        // ignore
      }
    }
    return [];
  }
}
