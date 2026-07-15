import Anthropic from '@anthropic-ai/sdk'

export type AiProvider = 'claude' | 'openai' | 'gemini' | 'ollama'

export interface AiRuntimeConfig {
  provider: AiProvider
  model: string
  /** Ollama: base URL (mặc định http://localhost:11434). OpenAI: tuỳ chọn base URL. */
  baseUrl?: string
  /** Claude/OpenAI: API key (đã giải mã). Ollama: không cần. */
  apiKey?: string
}

export interface AiAskResult {
  text: string
  /** Lệnh shell trích từ code block đầu tiên (nếu có) — để chèn vào terminal. */
  command?: string
}

export type AiMode = 'generate' | 'explain' | 'explain-error' | 'diagnose'

export interface AiAskRequest {
  mode: AiMode
  /** Yêu cầu của user (ngôn ngữ tự nhiên) hoặc lệnh/lỗi cần giải thích. */
  input: string
  /** Context tuỳ chọn: OS đích, vài dòng cuối của terminal, hoặc transcript các bước đã chạy. */
  context?: string
}

const SYSTEM_GENERATE =
  'Bạn là trợ lý dòng lệnh cho kỹ sư hệ thống. Người dùng mô tả việc cần làm bằng tiếng Việt hoặc tiếng Anh. ' +
  'Trả về DUY NHẤT một lệnh shell đặt trong code block ```sh ... ```, rồi một dòng giải thích ngắn gọn bằng tiếng Việt. ' +
  'Không thêm lời rào đón. Nếu nguy hiểm (xoá dữ liệu, ghi đè), cảnh báo ngắn ở dòng giải thích.'

const SYSTEM_EXPLAIN =
  'Bạn là trợ lý dòng lệnh. Giải thích lệnh shell người dùng đưa: nó làm gì, từng phần nghĩa là gì, rủi ro nếu có. ' +
  'Trả lời ngắn gọn bằng tiếng Việt.'

const SYSTEM_EXPLAIN_ERROR =
  'Bạn là trợ lý debug. Người dùng đưa output/lỗi từ terminal. Giải thích nguyên nhân và đề xuất cách khắc phục (kèm lệnh nếu phù hợp, đặt trong ```sh```). Ngắn gọn, tiếng Việt.'

const SYSTEM_DIAGNOSE =
  'Bạn là agent chẩn đoán sự cố máy chủ Linux, làm việc TỪNG BƯỚC. Người dùng đưa triệu chứng + lịch sử các lệnh đã chạy kèm output. ' +
  'Nhiệm vụ mỗi lượt: đề xuất ĐÚNG MỘT lệnh chẩn đoán CHỈ-ĐỌC tiếp theo để thu hẹp nguyên nhân, đặt trong một code block ```sh ... ``` (chỉ một lệnh), rồi 1-2 câu tiếng Việt giải thích vì sao chạy lệnh đó. ' +
  'TUYỆT ĐỐI chỉ dùng lệnh đọc thông tin (uptime, free, df, ss, netstat, ps, top -bn1, cat/head/tail/grep trên /proc, /var/log…, systemctl status, journalctl, dmesg, ss, dig…). ' +
  'CẤM mọi lệnh ghi/sửa/khởi động lại/xoá (rm, mv, chmod, chown, kill, systemctl restart|stop|start, service restart, iptables, cài gói, sed -i, ghi ra file bằng > hoặc >>). ' +
  'Khi đã đủ dữ liệu để kết luận, ĐỪNG đưa code block nữa — thay vào đó trả lời bằng văn xuôi: chẩn đoán nguyên nhân + đề xuất cách khắc phục để NGƯỜI DÙNG tự làm (mô tả các lệnh sửa dưới dạng chữ, không đặt trong ```sh```). Ngắn gọn, tiếng Việt.'

const SYSTEM_PROMPTS: Record<AiMode, string> = {
  generate: SYSTEM_GENERATE,
  explain: SYSTEM_EXPLAIN,
  'explain-error': SYSTEM_EXPLAIN_ERROR,
  diagnose: SYSTEM_DIAGNOSE
}

/** Mạng treo không để user chờ vô hạn (undici mặc định ~5 phút, không hủy được từ UI). */
const REQUEST_TIMEOUT_MS = 60_000

/**
 * Trần token đầu ra theo mode. `diagnose` (đặc biệt là lượt KẾT LUẬN) là văn xuôi dài
 * — nguyên nhân gốc + nhiều bước khắc phục — và tiếng Việt tốn token gấp 2-3 lần tiếng Anh,
 * nên 1500 hay bị cắt cụt giữa câu. Nâng riêng cho diagnose (chỉ tính token thực sinh nên
 * bước ngắn không tốn thêm). Xem thêm continuation cho Claude bên dưới.
 */
const MAX_TOKENS_DEFAULT = 1500
const MAX_TOKENS_DIAGNOSE = 4096

/** Số vòng nối tiếp tối đa (Claude) khi bị cắt do max_tokens — 4×4096 ≈ 16k token, thừa cho kết luận. */
const MAX_CONTINUATIONS = 4

/**
 * Trợ lý AI đa nhà cung cấp (F09): sinh lệnh từ ngôn ngữ tự nhiên, giải thích lệnh/lỗi.
 * Claude qua SDK chính thức; OpenAI/Ollama qua REST (provider khác — không trộn SDK).
 */
export class AiService {
  async ask(config: AiRuntimeConfig, req: AiAskRequest): Promise<AiAskResult> {
    const system = SYSTEM_PROMPTS[req.mode]
    const prompt = buildPrompt(req)
    const maxTokens = req.mode === 'diagnose' ? MAX_TOKENS_DIAGNOSE : MAX_TOKENS_DEFAULT
    const text = await this.complete(config, system, prompt, maxTokens)
    return { text, command: req.mode !== 'explain' ? extractCommand(text) : undefined }
  }

  private complete(config: AiRuntimeConfig, system: string, prompt: string, maxTokens: number): Promise<string> {
    if (config.provider === 'claude') return this.askClaude(config, system, prompt, maxTokens)
    if (config.provider === 'openai') return this.askOpenAi(config, system, prompt, maxTokens)
    if (config.provider === 'gemini') return this.askGemini(config, system, prompt, maxTokens)
    return this.askOllama(config, system, prompt, maxTokens)
  }

  // --- Claude (SDK chính thức) ---
  private async askClaude(
    config: AiRuntimeConfig,
    system: string,
    prompt: string,
    maxTokens: number
  ): Promise<string> {
    if (!config.apiKey) throw new Error('Chưa cấu hình Claude API key')
    const client = new Anthropic({ apiKey: config.apiKey, timeout: REQUEST_TIMEOUT_MS })
    const model = config.model || 'claude-opus-4-8'
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: prompt }]
    let full = ''
    // Nối tiếp nếu bị cắt do max_tokens: đưa phần đã sinh làm lượt "assistant" (prefill) để
    // model viết TIẾP thay vì bắt đầu lại — nhờ vậy kết luận dài không bao giờ bị cụt.
    for (let round = 0; round < MAX_CONTINUATIONS; round++) {
      const response = await client.messages.create({ model, max_tokens: maxTokens, system, messages })
      const chunk = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('')
      full += chunk
      if (response.stop_reason !== 'max_tokens') break
      // Prefill không được kết thúc bằng khoảng trắng (API sẽ báo lỗi) → cắt đuôi trắng khi gửi lại.
      const prefill = full.replace(/\s+$/, '')
      if (!prefill) break // không có gì để nối tiếp
      if (messages.length === 1) messages.push({ role: 'assistant', content: prefill })
      else messages[messages.length - 1] = { role: 'assistant', content: prefill }
    }
    return full.trim()
  }

  // --- OpenAI (REST) ---
  private async askOpenAi(
    config: AiRuntimeConfig,
    system: string,
    prompt: string,
    maxTokens: number
  ): Promise<string> {
    if (!config.apiKey) throw new Error('Chưa cấu hình OpenAI API key')
    const base = config.baseUrl?.replace(/\/$/, '') || 'https://api.openai.com/v1'
    const model = config.model || 'gpt-4o-mini'
    // Model reasoning (o-series, gpt-5…) từ chối max_tokens, bắt buộc max_completion_tokens
    const tokenParam = /^(o\d|gpt-5)/.test(model)
      ? { max_completion_tokens: maxTokens }
      : { max_tokens: maxTokens }
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      body: JSON.stringify({
        model,
        ...tokenParam,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt }
        ]
      })
    })
    if (!res.ok) throw new Error(`OpenAI lỗi ${res.status}: ${(await res.text()).slice(0, 200)}`)
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
    return (data.choices?.[0]?.message?.content ?? '').trim()
  }

  // --- Gemini (Google Generative Language REST) ---
  private async askGemini(
    config: AiRuntimeConfig,
    system: string,
    prompt: string,
    maxTokens: number
  ): Promise<string> {
    if (!config.apiKey) throw new Error('Chưa cấu hình Gemini API key')
    const base = config.baseUrl?.replace(/\/$/, '') || 'https://generativelanguage.googleapis.com/v1beta'
    const model = config.model || 'gemini-2.0-flash'
    const res = await fetch(`${base}/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.apiKey },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: maxTokens }
      })
    })
    if (!res.ok) throw new Error(`Gemini lỗi ${res.status}: ${(await res.text()).slice(0, 200)}`)
    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    }
    const parts = data.candidates?.[0]?.content?.parts ?? []
    return parts
      .map((p) => p.text ?? '')
      .join('')
      .trim()
  }

  // --- Ollama (REST, local) ---
  private async askOllama(
    config: AiRuntimeConfig,
    system: string,
    prompt: string,
    maxTokens: number
  ): Promise<string> {
    const base = config.baseUrl?.replace(/\/$/, '') || 'http://localhost:11434'
    const res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      body: JSON.stringify({
        model: config.model || 'llama3.1',
        stream: false,
        // num_predict = trần token đầu ra (mặc định Ollama có thể rất thấp → kết luận bị cắt)
        options: { num_predict: maxTokens },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt }
        ]
      })
    })
    if (!res.ok) throw new Error(`Ollama lỗi ${res.status} — đã chạy "ollama serve" và pull model chưa?`)
    const data = (await res.json()) as { message?: { content?: string } }
    return (data.message?.content ?? '').trim()
  }
}

function buildPrompt(req: AiAskRequest): string {
  const ctx = req.context ? `\n\n--- Bối cảnh ---\n${req.context}` : ''
  if (req.mode === 'generate') return `Yêu cầu: ${req.input}${ctx}`
  if (req.mode === 'explain') return `Giải thích lệnh sau:\n${req.input}${ctx}`
  if (req.mode === 'diagnose') return `Triệu chứng: ${req.input}${ctx}\n\nĐề xuất lệnh chẩn đoán chỉ-đọc tiếp theo (hoặc kết luận nếu đã đủ dữ liệu).`
  return `Output/lỗi từ terminal:\n${req.input}${ctx}`
}

/** Trích lệnh từ code block đầu tiên (```sh ... ``` hoặc ``` ... ```). */
function extractCommand(text: string): string | undefined {
  const fenced = /```(?:sh|bash|shell|zsh)?\s*\n([\s\S]*?)```/.exec(text)
  if (fenced) {
    const cmd = fenced[1]!.trim()
    return cmd || undefined
  }
  return undefined
}
