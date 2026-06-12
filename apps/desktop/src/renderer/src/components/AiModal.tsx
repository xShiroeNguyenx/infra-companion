import { useEffect, useState } from 'react'
import type { AiConfigDto, AiModeDto, AiProviderDto } from '@infra/shared'
import { useTabsStore } from '../stores/tabs'
import { errorMessage, useToastsStore } from '../stores/toasts'
import { Button, Field, Modal, Select, TextArea, TextInput } from './ui'

const MODEL_HINT: Record<AiProviderDto, string> = {
  claude: 'claude-opus-4-8',
  openai: 'gpt-4o-mini',
  gemini: 'gemini-2.0-flash',
  ollama: 'llama3.1'
}

const BASEURL_HINT: Record<AiProviderDto, string> = {
  claude: '',
  openai: 'https://api.openai.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  ollama: 'http://localhost:11434'
}

/** Trợ lý AI (F09): sinh lệnh từ tiếng Việt/Anh, giải thích lệnh-lỗi; chèn lệnh vào terminal. */
export function AiModal({ onClose }: { onClose: () => void }) {
  const [config, setConfig] = useState<AiConfigDto | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [mode, setMode] = useState<AiModeDto>('generate')
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [answer, setAnswer] = useState<{ text: string; command?: string } | null>(null)
  const activeTab = useTabsStore((s) => s.tabs.find((t) => t.id === s.activeId))
  const activePane =
    activeTab?.kind === 'terminal' ? (activeTab.panes.find((p) => p.id === activeTab.activePaneId) ?? activeTab.panes[0]) : undefined

  useEffect(() => {
    void window.infra.ai.getConfig().then((c) => {
      setConfig(c)
      if (!c) setShowSettings(true)
    })
  }, [])

  const ask = async (): Promise<void> => {
    if (!input.trim() || busy) return
    setBusy(true)
    setAnswer(null)
    try {
      const res = await window.infra.ai.ask(mode, input.trim())
      setAnswer(res)
    } catch (error) {
      useToastsStore.getState().push(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const insertCommand = (): void => {
    if (!answer?.command || !activePane) return
    // Ghi vào terminal KHÔNG kèm Enter — user xem lại rồi tự bấm chạy (an toàn)
    window.infra.terminal.write(activePane.sessionId, answer.command)
    useToastsStore.getState().push('Đã chèn lệnh vào terminal (bấm Enter để chạy)', 'info')
    onClose()
  }

  if (showSettings) {
    return (
      <AiSettings
        current={config}
        // đã có config: "Đóng" quay về khung hỏi đáp (giữ câu trả lời đang xem); chưa có thì đóng hẳn
        onClose={() => (config ? setShowSettings(false) : onClose())}
        onSaved={(c) => {
          setConfig(c)
          setShowSettings(false)
        }}
      />
    )
  }

  return (
    <Modal title="Trợ lý AI" onClose={onClose}>
      <div className="w-[560px] max-w-full">
        <div className="mb-2 flex items-center justify-between text-[11px] text-zinc-500">
          <span>
            {config ? `${config.provider} · ${config.model}` : 'Chưa cấu hình'}
          </span>
          <button className="hover:text-zinc-200" onClick={() => setShowSettings(true)}>
            ⚙ Cấu hình
          </button>
        </div>

        <div className="mb-2 flex gap-1.5">
          {(['generate', 'explain', 'explain-error'] as AiModeDto[]).map((m) => (
            <button
              key={m}
              className={`rounded border px-2 py-1 text-xs ${
                mode === m ? 'border-blue-500 bg-blue-500/15 text-blue-300' : 'border-zinc-700 text-zinc-400 hover:bg-zinc-800'
              }`}
              onClick={() => setMode(m)}
            >
              {m === 'generate' ? 'Sinh lệnh' : m === 'explain' ? 'Giải thích lệnh' : 'Giải thích lỗi'}
            </button>
          ))}
        </div>

        <TextArea
          rows={3}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void ask()
          }}
          placeholder={
            mode === 'generate'
              ? 'VD: tìm 5 file lớn nhất trong /var/log; kill process đang chiếm cổng 8080'
              : mode === 'explain'
                ? 'Dán lệnh cần giải thích…'
                : 'Dán output/lỗi cần giải thích…'
          }
        />
        <div className="mt-2 flex justify-end">
          <Button variant="primary" disabled={busy || !input.trim()} onClick={() => void ask()}>
            {busy ? 'Đang hỏi…' : 'Hỏi AI (Ctrl+Enter)'}
          </Button>
        </div>

        {answer && (
          <div className="mt-3 rounded border border-zinc-800 bg-zinc-950 p-3">
            <pre className="max-h-64 overflow-auto text-[12px] whitespace-pre-wrap text-zinc-300">{answer.text}</pre>
            {answer.command && (
              <div className="mt-2 flex items-center justify-between gap-2 border-t border-zinc-800 pt-2">
                <code className="min-w-0 flex-1 truncate text-[11px] text-emerald-400">{answer.command}</code>
                <Button
                  variant="primary"
                  className="!px-2 !py-1 !text-xs"
                  disabled={!activePane}
                  title={activePane ? 'Chèn vào terminal đang mở (không tự chạy)' : 'Mở 1 tab terminal trước'}
                  onClick={insertCommand}
                >
                  ↵ Chèn vào terminal
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}

function AiSettings({
  current,
  onClose,
  onSaved
}: {
  current: AiConfigDto | null
  onClose: () => void
  onSaved: (c: AiConfigDto) => void
}) {
  const [provider, setProvider] = useState<AiProviderDto>(current?.provider ?? 'claude')
  const [model, setModel] = useState(current?.model ?? MODEL_HINT.claude)
  const [baseUrl, setBaseUrl] = useState(current?.baseUrl ?? '')
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)

  const changeProvider = (p: AiProviderDto): void => {
    setProvider(p)
    if (!current || current.provider !== p) setModel(MODEL_HINT[p])
    if (p === 'ollama' && !baseUrl) setBaseUrl('http://localhost:11434')
  }

  const save = async (): Promise<void> => {
    setBusy(true)
    try {
      await window.infra.ai.setConfig({
        provider,
        model: model.trim() || MODEL_HINT[provider],
        baseUrl: baseUrl.trim(),
        // undefined = giữ key cũ; chỉ gửi khi user nhập mới
        apiKey: apiKey ? apiKey : undefined
      })
      const cfg = await window.infra.ai.getConfig()
      if (cfg) onSaved(cfg)
    } catch (error) {
      useToastsStore.getState().push(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Cấu hình Trợ lý AI" onClose={onClose}>
      <div className="w-[440px] max-w-full">
        <Field label="Nhà cung cấp">
          <Select value={provider} onChange={(e) => changeProvider(e.target.value as AiProviderDto)}>
            <option value="claude">Claude (Anthropic)</option>
            <option value="openai">OpenAI</option>
            <option value="gemini">Gemini (Google)</option>
            <option value="ollama">Ollama (local — riêng tư 100%)</option>
          </Select>
        </Field>
        <Field label="Model">
          <TextInput value={model} onChange={(e) => setModel(e.target.value)} placeholder={MODEL_HINT[provider]} />
        </Field>
        {provider !== 'claude' && (
          <Field label={provider === 'ollama' ? 'Ollama URL' : 'Base URL (tuỳ chọn)'}>
            <TextInput value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={BASEURL_HINT[provider]} />
          </Field>
        )}
        {provider !== 'ollama' && (
          <Field label={current?.hasApiKey ? 'API key (để trống = giữ nguyên)' : 'API key'}>
            <TextInput
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={
                current?.hasApiKey ? '••••••••' : provider === 'claude' ? 'sk-ant-…' : provider === 'gemini' ? 'AIza…' : 'sk-…'
              }
            />
          </Field>
        )}
        <p className="mb-3 text-[11px] text-zinc-500">
          API key được mã hoá trong vault. Ollama chạy local nên không cần key và không gửi dữ liệu ra ngoài.
        </p>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Đóng</Button>
          <Button variant="primary" disabled={busy} onClick={() => void save()}>
            {busy ? 'Đang lưu…' : 'Lưu'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
