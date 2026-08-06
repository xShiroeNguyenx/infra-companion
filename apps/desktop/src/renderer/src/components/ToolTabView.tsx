import type { ReactNode } from 'react'
import { AiDiagnoseModal } from './AiDiagnoseModal'
import { ProcessesModal } from './ProcessesModal'
import { ReplicationModal } from './ReplicationModal'
import { ServicesModal } from './ServicesModal'
import { TunnelsModal } from './TunnelsModal'
import { useT } from '../i18n'
import type { I18nKey } from '../i18n/dict'
import type { ToolTabKind } from '../stores/tabs'

/**
 * Bọc một công cụ vào TAB (thay vì popup) — dùng lại ĐÚNG component của popup ở chế độ
 * `embedded` nên không có bản thứ hai phải bảo trì song song, và state giữ nguyên vì cả hai
 * đọc chung store.
 *
 * Ẩn bằng `hidden` khi tab không active (khuôn của các tab view khác) — KHÔNG unmount, để phiên
 * chẩn đoán AI đang chạy hoặc bộ lọc tiến trình không mất khi user nhảy sang tab khác.
 */
const TOOLS: Partial<Record<ToolTabKind, { icon: string; titleKey: I18nKey; render: () => ReactNode }>> = {
  tunnels: { icon: '🔀', titleKey: 'tunnel.title', render: () => <TunnelsModal embedded /> },
  processes: { icon: '📋', titleKey: 'procs.title', render: () => <ProcessesModal embedded /> },
  services: { icon: '⚙', titleKey: 'svc.title', render: () => <ServicesModal embedded /> },
  'ai-diagnose': { icon: '🩺', titleKey: 'ai.diagnose.title', render: () => <AiDiagnoseModal embedded /> },
  replication: { icon: '🔁', titleKey: 'repl.title', render: () => <ReplicationModal embedded /> }
}

export function ToolTabView({ kind, active }: { kind: ToolTabKind; active: boolean }) {
  const t = useT()
  const tool = TOOLS[kind]
  if (!tool) return null
  return (
    <div className={`bg-app absolute inset-0 flex flex-col ${active ? '' : 'hidden'}`}>
      <div className="border-edge bg-panel flex shrink-0 items-center gap-2 border-b px-4 py-2">
        <span className="text-content text-sm font-medium">
          {tool.icon} {t(tool.titleKey)}
        </span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">{tool.render()}</div>
    </div>
  )
}
