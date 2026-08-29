import { useState } from 'react'
import type { HostExportFormat } from '@infra/shared'
import { Button, Modal, Select } from './ui'
import { useT } from '../i18n'

const FORMATS: HostExportFormat[] = ['ssh_config', 'csv', 'json']

/**
 * P30 — xuất hosts ra định dạng đọc được.
 *
 * Có modal riêng thay vì bấm phát ra file ngay, vì **phải nói trước bản xuất chứa gì**:
 * đây là file phẳng, ai mở được file là đọc được hết. Người dùng cần biết nó KHÔNG kèm mật
 * khẩu/key (để không tưởng đây là bản backup đầy đủ) và cũng cần biết nó có gì (để không
 * vô tình chia sẻ danh sách hạ tầng của mình).
 */
export function ExportHostsModal({ onClose }: { onClose: () => void }) {
  const t = useT()
  const [format, setFormat] = useState<HostExportFormat>('ssh_config')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = async (): Promise<void> => {
    setError(null)
    setMessage(null)
    setBusy(true)
    try {
      const result = await window.infra.exporter.hosts(format)
      if (result.ok) {
        setMessage(
          result.skipped > 0 ? `${result.message} (${t('export.skipped', { n: result.skipped })})` : result.message
        )
      } else {
        setError(result.message)
      }
    } catch (err) {
      // invoke có thể reject (vault khoá, không ghi được file…) — không bắt thì busy kẹt true
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={t('export.title')} onClose={onClose}>
      <div className="w-[460px] max-w-full">
        <p className="mb-3 text-xs leading-relaxed text-muted">{t('export.desc')}</p>

        <div className="mb-3 rounded border border-warning/40 bg-warning/10 px-3 py-2 text-[11px] leading-relaxed">
          <div className="mb-1 font-medium text-warning">{t('export.contains')}</div>
          <div className="text-muted">{t('export.containsList')}</div>
          <div className="mt-1.5 mb-1 font-medium text-warning">{t('export.excludes')}</div>
          <div className="text-muted">{t('export.excludesList')}</div>
        </div>

        <div className="mb-3">
          <Select value={format} onChange={(e) => setFormat(e.target.value as HostExportFormat)}>
            {FORMATS.map((f) => (
              <option key={f} value={f}>
                {t(`export.fmt.${f}` as 'export.fmt.ssh_config')}
              </option>
            ))}
          </Select>
          <p className="mt-1.5 text-[11px] text-subtle">
            {t(`export.hint.${format}` as 'export.hint.ssh_config')}
          </p>
        </div>

        {error && <p className="mb-2 text-xs text-danger">{error}</p>}
        {message && <p className="mb-2 break-all text-xs text-success">{message}</p>}

        <div className="flex justify-end">
          <Button variant="primary" disabled={busy} onClick={() => void run()}>
            {busy ? t('export.working') : t('export.run')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
