import { ipcMain } from 'electron'
import { AiService, type AiProvider } from '@infra/core'
import { IPC, type AiAskResultDto, type AiConfigDto, type AiConfigInput, type AiModeDto } from '@infra/shared'
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
}
