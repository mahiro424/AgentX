// 对模型目录和最小推理响应都限制实际读取量，不能等完整响应进入内存后才检查。
async function readLimitedJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('empty-body');
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1024 * 1024) { await reader.cancel(); throw new Error('response-too-large'); }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally { reader.releaseLock(); }
}

export async function fetchDeepSeekModels(apiKey: string): Promise<string[]> {
  let response: Response;
  try {
    response = await fetch('https://api.deepseek.com/models', {
      method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    });
  } catch (cause) {
    const name = (cause as Error).name;
    throw new Error(name === 'TimeoutError' || name === 'AbortError' ? '模型拉取超时；未自动重试' : '无法连接 DeepSeek，请检查网络；未自动重试');
  }
  if (!response.ok) {
    const reasons: Record<number, string> = { 401: '认证失败，请检查 API Key', 402: '余额不足', 429: '请求过于频繁', 500: '服务内部错误', 503: '服务暂时繁忙' };
    throw new Error(`DeepSeek HTTP ${response.status}：${reasons[response.status] ?? '请求未成功，请检查服务状态'}`);
  }
  let data: unknown;
  try {
    data = await readLimitedJson(response);
  } catch { throw new Error('DeepSeek 模型列表响应无效，保留此前列表'); }
  const items = (data as { data?: unknown })?.data;
  if (!Array.isArray(items) || items.length > 1000 || items.some(item => !item || typeof item.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(item.id))) {
    throw new Error('DeepSeek 模型列表格式无效，保留此前列表');
  }
  return [...new Set<string>(items.map(item => item.id))];
}

export async function testDeepSeekFlash(apiKey: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch('https://api.deepseek.com/responses', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ model: 'deepseek-v4-flash', input: 'Reply with exactly: OK', reasoning: { effort: 'none' }, max_output_tokens: 32, stream: false }),
    });
  } catch (cause) {
    const name = (cause as Error).name;
    throw new Error(name === 'TimeoutError' || name === 'AbortError' ? '连接测试超时；未自动重试' : '无法连接 DeepSeek，请检查网络；未自动重试');
  }
  if (!response.ok) {
    const reasons: Record<number, string> = { 401: '认证失败，请检查 API Key', 402: '余额不足', 429: '请求过于频繁', 500: '服务内部错误', 503: '服务暂时繁忙' };
    throw new Error(`DeepSeek HTTP ${response.status}：${reasons[response.status] ?? '请求未成功，请检查服务状态'}`);
  }
  let data: { object?: string; status?: string; model?: string; output?: unknown };
  try {
    data = await readLimitedJson(response) as typeof data;
  } catch { throw new Error('连接测试响应格式无效，不计为测试成功'); }
  if (data?.object !== 'response' || data.status !== 'completed' || data.model !== 'deepseek-v4-flash' ||
      !Array.isArray(data.output) || !data.output.some((item: { type?: string; content?: { type?: string; text?: string }[] }) =>
        item?.type === 'message' && Array.isArray(item.content) && item.content.some(part => part?.type === 'output_text' && typeof part.text === 'string' && part.text.trim()))) {
    throw new Error('未收到指定 Flash 模型的完整文本响应，不计为测试成功');
  }
}
