import { create } from 'zustand'
import type { AiDiagnoseRecordDto } from '@infra/shared'
import { translate } from '../i18n'
import { useSettingsStore } from './settings'
import { errorMessage, useToastsStore } from './toasts'
import { useUiStore } from './ui'

/**
 * F48 — AI chẩn đoán sự cố (agent mode). Vòng lặp: AI đề xuất MỘT lệnh read-only →
 * user duyệt từng bước → chạy qua kênh exec riêng (ai.diagnoseExec, KHÔNG đụng terminal
 * đang mở) → output đưa lại cho AI → bước tiếp, tới khi AI ra kết luận (không còn lệnh).
 * Guard read-only enforce ở MAIN (ai.diagnoseExec trả ok:false nếu lệnh không read-only).
 */

/** Trần ký tự output mỗi bước đưa vào transcript (giữ ĐUÔI — thông tin quan trọng thường ở cuối). */
const MAX_STEP_OUTPUT = 4000

export type StepStatus = 'proposed' | 'running' | 'done' | 'skipped' | 'blocked' | 'error'

export interface DiagnoseStep {
  reasoning: string
  command: string
  status: StepStatus
  blockedReason?: string
  output?: string
  code?: number | null
  error?: string
}

export type SessionStatus = 'thinking' | 'awaiting' | 'running' | 'done' | 'stopped' | 'error'

export interface DiagnoseSession {
  hostId: string
  hostLabel: string
  symptom: string
  steps: DiagnoseStep[]
  status: SessionStatus
  conclusion?: string
  error?: string
  /** Thời điểm phiên được lưu (chỉ có khi đang xem lại từ lịch sử). */
  createdAt?: number
  /** Id trong DB nếu phiên này đang được xem lại từ lịch sử (chặn lưu trùng). */
  savedId?: string
  /** Đang xem lại lịch sử → chỉ đọc, không chạy tiếp, không lưu lại. */
  readonly?: boolean
}

interface AiDiagnoseState {
  session: DiagnoseSession | null
  history: AiDiagnoseRecordDto[]
  start: (hostId: string, hostLabel: string, symptom: string) => Promise<void>
  approve: () => Promise<void>
  skip: () => Promise<void>
  stop: () => void
  close: () => void
  /** Nạp danh sách lịch sử chẩn đoán từ vault. */
  loadHistory: () => Promise<void>
  /** Mở lại một phiên đã lưu để xem chi tiết (read-only). */
  openHistory: (id: string) => Promise<void>
  /** Xoá một phiên khỏi lịch sử. */
  deleteHistory: (id: string) => Promise<void>
}

/** Tăng mỗi lần start/stop/close/openHistory — chặn kết quả async cũ ghi đè phiên mới. */
let gen = 0

/** gen đã được lưu vào lịch sử — chặn lưu trùng khi có nhiều transition kết thúc. */
let savedGen = -1

/** Cắt output giữ đuôi để transcript không phình. */
function clip(text: string): string {
  const t = text.trimEnd()
  if (t.length <= MAX_STEP_OUTPUT) return t
  return '…(đã cắt phần đầu)\n' + t.slice(-MAX_STEP_OUTPUT)
}

/** Dựng transcript các bước đã chạy để nhồi vào context của lượt hỏi AI kế. */
function buildTranscript(steps: DiagnoseStep[]): string {
  const parts: string[] = []
  steps.forEach((s, i) => {
    if (s.status === 'skipped') {
      parts.push(`[Bước ${i + 1}] Người dùng BỎ QUA lệnh: ${s.command}`)
    } else if (s.status === 'blocked') {
      parts.push(`[Bước ${i + 1}] Lệnh bị chặn (không read-only): ${s.command}\nLý do: ${s.blockedReason ?? ''}`)
    } else if (s.status === 'done') {
      parts.push(`[Bước ${i + 1}] Đã chạy: ${s.command}\nKết quả (exit ${s.code ?? '?'}):\n${clip(s.output ?? '')}`)
    } else if (s.status === 'error') {
      parts.push(`[Bước ${i + 1}] Lệnh lỗi: ${s.command}\n${s.error ?? ''}`)
    }
  })
  return parts.join('\n---\n')
}

export const useAiDiagnoseStore = create<AiDiagnoseState>((set, get) => {
  /** Hỏi AI bước tiếp — trả 1 lệnh đề xuất (status awaiting) hoặc kết luận (status done). */
  const askNext = async (myGen: number): Promise<void> => {
    const s = get().session
    if (!s || myGen !== gen) return
    set({ session: { ...s, status: 'thinking' } })
    try {
      const transcript = buildTranscript(s.steps)
      const res = await window.infra.ai.ask('diagnose', s.symptom, transcript || undefined)
      if (myGen !== gen) return
      const cur = get().session
      if (!cur) return
      if (res.command) {
        const step: DiagnoseStep = { reasoning: res.text, command: res.command, status: 'proposed' }
        set({ session: { ...cur, steps: [...cur.steps, step], status: 'awaiting' } })
      } else {
        // Không còn lệnh → AI đã kết luận
        set({ session: { ...cur, status: 'done', conclusion: res.text } })
        finalize(myGen)
      }
    } catch (error) {
      if (myGen !== gen) return
      const cur = get().session
      if (cur) {
        set({ session: { ...cur, status: 'error', error: errorMessage(error) } })
        finalize(myGen)
      }
    }
  }

  /** Cập nhật bước cuối (bước đang chờ/chạy). */
  const patchLastStep = (fn: (step: DiagnoseStep) => DiagnoseStep): void => {
    const s = get().session
    if (!s || s.steps.length === 0) return
    const steps = [...s.steps]
    steps[steps.length - 1] = fn(steps[steps.length - 1]!)
    set({ session: { ...s, steps } })
  }

  /**
   * Lưu phiên vào lịch sử khi kết thúc (done/stopped/error). Gọi ở MỌI điểm chuyển sang trạng thái
   * kết thúc; savedGen chặn lưu trùng khi có nhiều transition trong cùng một phiên. Bỏ qua nếu:
   * đang xem lại (readonly), phiên rỗng (không bước & không kết luận), hoặc phiên đã cũ (gen đổi).
   */
  const finalize = (myGen: number): void => {
    if (myGen !== gen || savedGen === myGen) return
    const s = get().session
    if (!s || s.readonly) return
    if (s.status !== 'done' && s.status !== 'stopped' && s.status !== 'error') return
    if (s.steps.length === 0 && !s.conclusion) return
    savedGen = myGen
    void window.infra.ai
      .saveDiagnosis({
        hostId: s.hostId,
        hostLabel: s.hostLabel,
        symptom: s.symptom,
        status: s.status,
        steps: s.steps.map((st) => ({
          reasoning: st.reasoning,
          command: st.command,
          status: st.status,
          blockedReason: st.blockedReason,
          output: st.output,
          code: st.code,
          error: st.error
        })),
        conclusion: s.conclusion,
        error: s.error
      })
      .then(() => get().loadHistory())
      .catch(() => {
        // Lưu thất bại (vd vault vừa khoá) — cho phép thử lại ở transition sau, không chặn UX.
        if (savedGen === myGen) savedGen = -1
      })
  }

  return {
    session: null,
    history: [],

    start: async (hostId, hostLabel, symptom) => {
      const text = symptom.trim()
      if (!text) return
      // AI chưa cấu hình → mở modal AI settings (tái dùng pattern F46)
      const config = await window.infra.ai.getConfig().catch(() => null)
      if (!config) {
        const lang = useSettingsStore.getState().language
        useToastsStore.getState().push(translate(lang, 'ai.notConfigured'), 'info')
        useUiStore.getState().setModal('ai')
        return
      }
      gen++
      const myGen = gen
      set({ session: { hostId, hostLabel, symptom: text, steps: [], status: 'thinking' } })
      await askNext(myGen)
    },

    approve: async () => {
      const s = get().session
      if (!s || s.status !== 'awaiting') return
      const step = s.steps[s.steps.length - 1]
      if (!step || step.status !== 'proposed') return
      const myGen = gen
      patchLastStep((st) => ({ ...st, status: 'running' }))
      set((state) => (state.session ? { session: { ...state.session, status: 'running' } } : state))
      try {
        const res = await window.infra.ai.diagnoseExec(s.hostId, step.command)
        if (myGen !== gen) return
        if (!res.ok) {
          patchLastStep((st) => ({ ...st, status: 'blocked', blockedReason: res.blockedReason }))
          await askNext(myGen) // báo AI lệnh bị chặn → đề xuất lệnh read-only khác / kết luận
          return
        }
        if (res.error) {
          patchLastStep((st) => ({ ...st, status: 'error', error: res.error, output: res.stderr }))
        } else {
          const out = [res.stdout, res.stderr].filter((x) => x.trim()).join('\n')
          patchLastStep((st) => ({ ...st, status: 'done', output: out, code: res.code }))
        }
        await askNext(myGen)
      } catch (error) {
        if (myGen !== gen) return
        patchLastStep((st) => ({ ...st, status: 'error', error: errorMessage(error) }))
        const cur = get().session
        if (cur) {
          set({ session: { ...cur, status: 'error', error: errorMessage(error) } })
          finalize(myGen)
        }
      }
    },

    skip: async () => {
      const s = get().session
      if (!s || s.status !== 'awaiting') return
      const step = s.steps[s.steps.length - 1]
      if (!step || step.status !== 'proposed') return
      const myGen = gen
      patchLastStep((st) => ({ ...st, status: 'skipped' }))
      await askNext(myGen)
    },

    stop: () => {
      gen++
      const s = get().session
      if (s) {
        set({ session: { ...s, status: 'stopped' } })
        finalize(gen) // gen vừa tăng → lưu phiên vừa dừng dưới gen mới
      }
    },

    close: () => {
      gen++
      set({ session: null })
    },

    loadHistory: async () => {
      try {
        set({ history: await window.infra.ai.listDiagnoses(50) })
      } catch {
        // vault có thể vừa khoá — bỏ qua
      }
    },

    openHistory: async (id) => {
      try {
        const rec = await window.infra.ai.getDiagnosis(id)
        if (!rec) return
        gen++ // huỷ mọi async đang chạy trước khi chuyển sang chế độ xem lại
        set({
          session: {
            hostId: rec.hostId,
            hostLabel: rec.hostLabel,
            symptom: rec.symptom,
            steps: rec.steps as DiagnoseStep[],
            status: rec.status,
            conclusion: rec.conclusion,
            error: rec.error,
            createdAt: rec.createdAt,
            savedId: rec.id,
            readonly: true
          }
        })
      } catch (error) {
        useToastsStore.getState().push(errorMessage(error))
      }
    },

    deleteHistory: async (id) => {
      try {
        await window.infra.ai.deleteDiagnosis(id)
        set({ history: get().history.filter((h) => h.id !== id) })
      } catch (error) {
        useToastsStore.getState().push(errorMessage(error))
      }
    }
  }
})
