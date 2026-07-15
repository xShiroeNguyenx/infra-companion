import { ipcMain } from 'electron'
import { AiService, execOnce, isReadOnlyCommand, type AiProvider } from '@infra/core'
import {
  IPC,
  type AiAskResultDto,
  type AiConfigDto,
  type AiConfigInput,
  type AiDiagnoseExecResultDto,
  type AiDiagnoseSaveInput,
  type AiModeDto
} from '@infra/shared'
import { makeHostKeyVerifier, prepareConnection } from './connection'
import { getVault, touchActivity } from './vault'

/** Trợ lý AI (F09): sinh lệnh / giải thích lệnh-lỗi qua Claude / OpenAI / Ollama. */
export function registerAiIpc(): void {
  const service = new AiService()

  ipcMain.handle(IPC.AI_GET_CONFIG, (): AiConfigDto | null => {
    touchActivity()
    const cfg = getVault().getAiConfig()
    if (!cfg) return null
    return { provider: cfg.provider as AiConfigDto['provider'], model: cfg.model, baseUrl: cfg.baseUrl, hasApiKey: cfg.hasApiKey }
  })

  ipcMain.handle(IPC.AI_SET_CONFIG, (_e, input: AiConfigInput) => {
    touchActivity()
    getVault().setAiConfig(input)
  })

  ipcMain.handle(IPC.AI_ASK, async (_e, mode: AiModeDto, input: string, context?: string): Promise<AiAskResultDto> => {
    touchActivity()
    const vault = getVault()
    const cfg = vault.getAiConfig()
    if (!cfg) throw new Error('Chưa cấu hình AI — mở Settings AI để chọn provider')
    const result = await service.ask(
      {
        provider: cfg.provider as AiProvider,
        model: cfg.model,
        baseUrl: cfg.baseUrl || undefined,
        apiKey: vault.getAiApiKey()
      },
      { mode, input, context }
    )
    return { text: result.text, command: result.command }
  })

  // F48 — chạy 1 lệnh chẩn đoán read-only qua kênh exec riêng (KHÔNG đụng phiên terminal đang mở).
  // Guard read-only enforce Ở ĐÂY (không tin renderer): lệnh không read-only → trả ok:false, KHÔNG chạy.
  ipcMain.handle(
    IPC.AI_DIAGNOSE_EXEC,
    async (event, hostId: string, command: string): Promise<AiDiagnoseExecResultDto> => {
      touchActivity()
      const verdict = isReadOnlyCommand(command)
      if (!verdict.ok) {
        return { ok: false, blockedReason: verdict.reason, stdout: '', stderr: '', code: null }
      }
      const prepared = await prepareConnection(event.sender, hostId)
      const res = await execOnce(prepared.chain, command, makeHostKeyVerifier(event.sender), {
        loginSteps: prepared.loginSteps,
        timeoutMs: 30_000
      })
      return {
        ok: true,
        stdout: res.stdout,
        stderr: res.stderr,
        code: res.code,
        error: res.status === 'error' ? res.error : undefined
      }
    }
  )

  // F48 — lịch sử chẩn đoán: lưu/liệt kê/xem/xoá (steps + conclusion mã hoá bằng DEK ở vault).
  ipcMain.handle(IPC.AI_DIAGNOSE_SAVE, (_e, input: AiDiagnoseSaveInput) => {
    touchActivity()
    return getVault().saveDiagnosis(input)
  })

  ipcMain.handle(IPC.AI_DIAGNOSE_LIST, (_e, limit?: number) => {
    touchActivity()
    return getVault().listDiagnoses(limit)
  })

  ipcMain.handle(IPC.AI_DIAGNOSE_GET, (_e, id: string) => {
    touchActivity()
    return getVault().getDiagnosis(id)
  })

  ipcMain.handle(IPC.AI_DIAGNOSE_DELETE, (_e, id: string) => {
    touchActivity()
    getVault().deleteDiagnosis(id)
  })
}
