export interface HomeworkItem {
  subject: string;
  content: string;
  date?: string;
}

export interface AIResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

/**
 * 调用 OpenAI/DeepSeek 兼容 API
 */
export async function callAI(
  prompt: string,
  apiKey: string,
  apiUrl: string
): Promise<string> {
  // 兼容用户只配置了 base URL 的情况（如 https://api.deepseek.com）
  const endpoint = apiUrl.includes('/chat/completions')
    ? apiUrl
    : apiUrl.replace(/\/+$/, '') + '/v1/chat/completions';
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
            '你是一个帮助家长从邮件中提取孩子作业的助手。请从以下邮件内容中提取作业信息，以 JSON 数组格式返回，每个作业包含 subject（科目）、content（内容）、date（日期 YYYY-MM-DD）三个字段。如果没有找到作业，返回空数组 []。',
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
  try {
    // 尝试直接解析 JSON
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (item: any) =>
          item && typeof item.subject === 'string' && typeof item.content === 'string'
      );
    }
    return [];
  } catch {
    // 尝试从 markdown 代码块中提取 JSON
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
