import type { Readable, Writable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';

type Message = Record<string, unknown>;
type Pending = { resolve(value: unknown): void; reject(error: Error): void; timer: NodeJS.Timeout };
type Handlers = {
  notification(message: Message): void;
  request(message: Message): void;
  disconnected(error: Error): void;
};

// 仅供 Main 内 Codex 适配器使用；不是 Renderer 的通用 RPC 接口。
export class CodexTransport {
  private sequence = 0;
  private pending = new Map<number, Pending>();
  private requests = new Map<string | number, string | null>();
  private fault: Error | null = null;
  private buffer = '';
  private decoder = new StringDecoder('utf8');

  constructor(private readonly input: Writable, private readonly output: Readable, private readonly handlers: Handlers) {
    output.on('data', this.data);
    output.on('end', this.ended);
    output.on('close', this.ended);
    output.on('error', this.streamError);
    input.on('error', this.streamError);
  }

  call(method: string, params: unknown, timeoutMs = 30000): Promise<unknown> {
    if (this.fault) return Promise.reject(this.fault);
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new Error('引擎应答超时，结果需核对；不会自动重发')), timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.input.write(JSON.stringify({ id, method, params }) + '\n', error => { if (error) this.streamError(); });
      } catch { this.streamError(); }
    });
  }

  respond(id: string | number, result: unknown): Promise<void> {
    if (this.fault) return Promise.reject(this.fault);
    if (!this.requests.delete(id)) return Promise.reject(new Error('审批请求已失效或已回应，不会再次发送'));
    // 写入前消费请求；写失败属于未知，不能重试批准。
    return new Promise((resolve, reject) => {
      try {
        this.input.write(JSON.stringify({ id, result }) + '\n', error => {
          if (error) { this.streamError(); reject(this.fault!); } else resolve();
        });
      } catch { this.streamError(); reject(this.fault!); }
    });
  }

  notify(method: string): Promise<void> {
    if (this.fault) return Promise.reject(this.fault);
    return new Promise((resolve, reject) => {
      try {
        this.input.write(JSON.stringify({ method }) + '\n', error => {
          if (error) { this.streamError(); reject(this.fault!); } else resolve();
        });
      } catch { this.streamError(); reject(this.fault!); }
    });
  }

  close(): void {
    this.fail(new Error('引擎连接已关闭，未完成操作需核对'));
    this.output.off('data', this.data);
    this.output.off('end', this.ended);
    this.output.off('close', this.ended);
    // 子进程回收可能晚于逻辑断线；保留幂等错误监听直到流随进程释放，避免迟到 EPIPE 崩溃 Main。
  }

  private streamError = (): void => { this.fail(new Error('引擎通信失败，结果需核对；不会自动重发')); };
  private ended = (): void => { this.fail(new Error('引擎输出已断开，结果需核对；不会自动重发')); };

  private data = (chunk: Buffer | string): void => {
    if (this.fault) return;
    this.buffer += typeof chunk === 'string' ? chunk : this.decoder.write(chunk);
    try {
      let end: number;
      while ((end = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, end);
        this.buffer = this.buffer.slice(end + 1);
        if (!line.trim()) continue;
        this.receive(JSON.parse(line));
        if (this.fault) return;
      }
    } catch { this.fail(new Error('引擎协议消息无效，结果需核对；未记录原始内容')); }
  };

  private receive(value: unknown): void {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid-message');
    const message = value as Message;
    if ('method' in message) {
      if (typeof message.method !== 'string' || !message.method || 'result' in message || 'error' in message) throw new Error('invalid-method');
      if ('id' in message) {
        if ((typeof message.id !== 'string' && typeof message.id !== 'number') || this.requests.has(message.id)) throw new Error('invalid-request-id');
        const threadId = (message.params as { threadId?: unknown } | null)?.threadId;
        this.requests.set(message.id, typeof threadId === 'string' ? threadId : null);
        this.handlers.request(message);
      }
      else {
        if (message.method === 'serverRequest/resolved') {
          const params = message.params as { threadId?: unknown; requestId?: unknown } | null;
          if (!params || typeof params.threadId !== 'string' || (typeof params.requestId !== 'string' && typeof params.requestId !== 'number')) throw new Error('invalid-resolved-request');
          if (this.requests.get(params.requestId) === params.threadId) this.requests.delete(params.requestId);
        }
        this.handlers.notification(message);
      }
      return;
    }
    if (typeof message.id !== 'number') throw new Error('invalid-response-id');
    const pending = this.pending.get(message.id);
    if (!pending || ('result' in message) === ('error' in message)) throw new Error('invalid-response');
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    // 上游错误正文可能含输入或凭据，协议层只返回数值错误码。
    if ('error' in message) {
      const code = (message.error as { code?: unknown } | null)?.code;
      pending.reject(new Error(`引擎请求失败${typeof code === 'number' ? `（RPC ${code}）` : ''}`));
    } else pending.resolve(message.result);
  }

  private fail(error: Error): void {
    if (this.fault) return;
    this.fault = error;
    this.buffer = '';
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
    this.requests.clear();
    try { this.handlers.disconnected(error); }
    catch { console.error('AgentX 引擎断线处理失败：产品状态尚未核对，连接保持不可用'); }
  }
}
