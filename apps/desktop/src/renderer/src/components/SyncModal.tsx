import { useEffect, useState } from 'react'
import type { SyncChannelStatusDto, SyncRunResult, SyncStatusDto } from '@infra/shared'
import { useDataStore } from '../stores/data'
import { useGdriveStore } from '../stores/gdrive'
import { Button, Field, Modal, Select, TextInput } from './ui'
import { useT } from '../i18n'

const AUTO_CHOICES = [0, 5, 15, 30, 60]

type BackendChoice = 'folder' | 'gdrive'

/**
 * Sync E2EE (Phase 4): đồng bộ vault mã hoá qua NHIỀU KÊNH chạy song song — thư mục
 * (Syncthing/Drive for Desktop/ổ mạng…) và/hoặc Google Drive API. Backend chỉ thấy blob
 * mã hoá; sync passphrase không bao giờ rời máy, đăng nhập Google KHÔNG thay passphrase.
 *
 * Mỗi kênh một thẻ: bật/tắt/đồng bộ riêng — kênh này chết không làm câm kênh kia.
 * Ngoài ra còn đường "chuyển bằng file": xuất/nhập thẳng blob, dùng khi ngồi máy khác
 * và chỉ có trình duyệt — không cần cài client đồng bộ nào.
 */
export function SyncModal({ onClose }: { onClose: () => void }) {
  const t = useT()
  const [status, setStatus] = useState<SyncStatusDto | null>(null)
  /** Trạng thái Google nằm ở store CHUNG — StatusBar cũng hiện "☁️ email" từ đúng nguồn này. */
  const gdrive = useGdriveStore((s) => s.status)
  /** Backend của form thêm/cấu hình kênh + form có đang mở không (luôn mở khi chưa có kênh nào). */
  const [formBackend, setFormBackend] = useState<BackendChoice>('folder')
  const [formOpen, setFormOpen] = useState(false)
  /** Đang chờ user thao tác trong trình duyệt — tách khỏi `busy` vì có thể kéo dài vài phút. */
  const [loggingIn, setLoggingIn] = useState(false)
  const [folder, setFolder] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [filePass, setFilePass] = useState('')
  const [showFile, setShowFile] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  /**
   * Hành động vừa bị chặn vì nghi ghi đè mất dữ liệu — giữ lại CHÍNH hành động đó để nút
   * "ghi đè có chủ ý" chạy lại đúng nó với force=true (chặn có thể đến từ configure một kênh
   * hoặc sync một kênh cụ thể, nút force phải nhắm đúng chỗ).
   */
  const [forceAction, setForceAction] = useState<((force: boolean) => Promise<SyncRunResult>) | null>(null)

  const channels = status?.channels ?? []
  const hasBackend = (backend: BackendChoice): boolean => channels.some((c) => c.backend === backend)

  const refresh = (): void => {
    void window.infra.sync.status().then(setStatus)
    void useGdriveStore.getState().refresh()
  }
  useEffect(refresh, [])

  const gdriveLogin = async (): Promise<void> => {
    setError(null)
    setMessage(null)
    setLoggingIn(true)
    try {
      const result = await window.infra.sync.gdriveLogin()
      if (result.ok) {
        useGdriveStore.setState({ status: { connected: true, email: result.email } })
        setMessage(t('sync.gd.connected', { email: result.email ?? 'Google' }))
      } else {
        setError(
          `${t(`sync.gd.err.${result.error}` as 'sync.gd.err.timeout')}${result.detail ? ` (${result.detail})` : ''}`
        )
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoggingIn(false)
    }
  }

  const gdriveLogout = async (): Promise<void> => {
    try {
      useGdriveStore.setState({ status: await window.infra.sync.gdriveLogout() })
      setMessage(t('sync.gd.loggedOut'))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  /**
   * Bọc chung mọi hành động gọi main: reset thông báo, khoá nút, và quan trọng nhất là
   * `catch` — invoke có thể reject (vault khoá, path không hợp lệ…), không bắt thì `busy`
   * kẹt true và nút treo vĩnh viễn.
   */
  const run = async (
    action: (force: boolean) => Promise<SyncRunResult>,
    force = false,
    onOk?: () => void
  ): Promise<void> => {
    setError(null)
    setMessage(null)
    setForceAction(null)
    setBusy(true)
    try {
      const result = await action(force)
      if (result.ok) {
        setMessage(result.message)
        onOk?.()
        refresh()
        void useDataStore.getState().refreshAll() // dữ liệu có thể vừa được kéo về
      } else {
        setError(result.message)
        if (result.needsConfirm) setForceAction(() => action)
        refresh() // trạng thái per-kênh trên thẻ cũng phải cập nhật khi lỗi
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const pickFolder = async (): Promise<void> => {
    const picked = await window.infra.sync.pickFolder()
    if (picked) setFolder(picked)
  }

  const configure = (): void => {
    if (formBackend === 'gdrive') {
      if (!gdrive?.connected) return setError(t('sync.gd.err.notConnected'))
      // Blob nằm trên cloud → passphrase là lớp bảo vệ duy nhất, siết hơn mức 8 của thư mục
      if (passphrase.length < 12) return setError(t('sync.gd.errPass'))
      void run((force) => window.infra.sync.configureGdrive(passphrase, force), false, () => {
        setPassphrase('')
        setFormOpen(false)
      })
      return
    }
    if (!folder.trim()) return setError(t('sync.errFolder'))
    if (passphrase.length < 8) return setError(t('sync.errPass'))
    void run((force) => window.infra.sync.configure(folder.trim(), passphrase, force), false, () => {
      setPassphrase('')
      setFormOpen(false)
    })
  }

  const syncNow = (channelId?: string): void => void run((force) => window.infra.sync.now(force, channelId))

  const setAuto = async (minutes: number): Promise<void> => {
    try {
      setStatus(await window.infra.sync.setAuto(minutes))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const disableChannel = async (channelId: string): Promise<void> => {
    try {
      setStatus(await window.infra.sync.disable(channelId))
      setMessage(t('sync.disabled'))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  /** Hàng tài khoản Google — dùng ở form bật kênh Drive lẫn cảnh báo mất kết nối trên thẻ. */
  const googleAccount = gdrive?.connected ? (
    <div className="mb-3 flex items-center gap-2 text-xs">
      <span className="text-success">✓ {t('sync.gd.connected', { email: gdrive.email ?? 'Google' })}</span>
      <button type="button" className="text-subtle hover:text-danger underline" onClick={() => void gdriveLogout()}>
        {t('sync.gd.logout')}
      </button>
    </div>
  ) : (
    <div className="mb-3">
      <Button type="button" disabled={loggingIn} onClick={() => void gdriveLogin()}>
        {loggingIn ? t('sync.gd.waiting') : t('sync.gd.login')}
      </Button>
      {loggingIn && <p className="mt-1.5 text-[11px] text-subtle">{t('sync.gd.waitingHint')}</p>}
    </div>
  )

  const channelCard = (channel: SyncChannelStatusDto) => (
    <div key={channel.id} className="border-edge bg-input mb-2 rounded border px-3 py-2">
      <div className="flex items-center gap-2">
        <div className="text-content min-w-0 flex-1 truncate text-xs font-medium">
          {channel.backend === 'gdrive'
            ? `☁️ Google Drive${channel.gdriveEmail ? ` (${channel.gdriveEmail})` : ''}`
            : `📁 ${channel.folder}`}
        </div>
        <Button type="button" className="!px-2 !py-0.5 !text-[11px]" disabled={busy} onClick={() => syncNow(channel.id)}>
          {t('sync.chanSync')}
        </Button>
        <button
          type="button"
          className="text-subtle hover:text-danger shrink-0 text-[11px] underline"
          title={t('sync.chanOffTitle')}
          onClick={() => void disableChannel(channel.id)}
        >
          {t('sync.chanOff')}
        </button>
      </div>
      {channel.lastSyncAt && (
        <div className="text-subtle mt-1 text-[11px]">
          {t('sync.last', { time: new Date(channel.lastSyncAt).toLocaleString(), msg: channel.lastMessage ?? '' })}
        </div>
      )}
      {/* Kênh Drive mà token đã mất (thu hồi / hết hạn 7 ngày khi app còn ở Testing) →
          nói thẳng + đưa nút đăng nhập ngay đây, đừng đợi lượt sync đỏ mới lộ */}
      {channel.backend === 'gdrive' && gdrive !== null && !gdrive.connected && (
        <div className="border-warning/40 bg-warning/10 mt-2 rounded border px-2 py-1.5">
          <p className="text-warning mb-2 text-[11px]">{t('sync.gd.reconnect')}</p>
          {googleAccount}
        </div>
      )}
    </div>
  )

  /** Form bật một kênh — cũng là màn thiết lập đầu tiên khi chưa có kênh nào. */
  const setupForm = (
    <>
      {channels.length === 0 ? (
        <Field label={t('sync.backendLabel')}>
          <div className="flex gap-1.5">
            {(['folder', 'gdrive'] as const).map((choice) => (
              <button
                key={choice}
                type="button"
                onClick={() => {
                  setFormBackend(choice)
                  setError(null)
                  setMessage(null)
                  setForceAction(null)
                }}
                className={`flex-1 cursor-pointer rounded border px-2 py-1.5 text-xs ${
                  formBackend === choice
                    ? 'border-accent bg-accent-soft/40 text-content'
                    : 'border-edge-strong text-muted hover:bg-hover'
                }`}
              >
                {t(choice === 'folder' ? 'sync.backendFolder' : 'sync.backendGdrive')}
              </button>
            ))}
          </div>
        </Field>
      ) : (
        <div className="mb-2 flex items-center justify-between">
          <span className="text-muted text-xs font-medium">
            {t(formBackend === 'folder' ? 'sync.backendFolder' : 'sync.backendGdrive')}
          </span>
          <button type="button" className="text-subtle text-[11px] underline" onClick={() => setFormOpen(false)}>
            {t('common.cancel')}
          </button>
        </div>
      )}
      {formBackend === 'folder' ? (
        <Field label={t('sync.folder')}>
          <div className="flex gap-2">
            <TextInput value={folder} onChange={(e) => setFolder(e.target.value)} placeholder={t('sync.folderPh')} className="flex-1" />
            <Button type="button" onClick={() => void pickFolder()}>{t('sync.choose')}</Button>
          </div>
        </Field>
      ) : (
        <>
          <p className="mb-2 text-[11px] leading-relaxed text-muted">{t('sync.gd.desc')}</p>
          {googleAccount}
        </>
      )}
      <Field label={t('sync.passphrase')}>
        <TextInput
          type="password"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          placeholder={formBackend === 'gdrive' ? '•••••••••••• (≥12)' : '••••••••'}
        />
      </Field>
      {formBackend === 'gdrive' && <p className="mb-2 text-[11px] text-muted">{t('sync.gd.note')}</p>}
      <p className="mb-3 text-[11px] text-warning/90">{t('sync.warn')}</p>
    </>
  )

  const fileSection = (
    <div className="mb-3 rounded border border-edge bg-input px-3 py-2">
      <button
        type="button"
        className="w-full text-left text-xs text-accent hover:underline"
        onClick={() => setShowFile((v) => !v)}
      >
        {showFile ? '▾' : '▸'} {t('sync.fileTitle')}
      </button>
      {showFile && (
        <>
          <p className="mt-2 text-[11px] leading-relaxed text-muted">{t('sync.fileDesc')}</p>
          <Field label={t('sync.filePass')}>
            <TextInput
              type="password"
              value={filePass}
              onChange={(e) => setFilePass(e.target.value)}
              placeholder="••••••••"
            />
          </Field>
          <div className="flex gap-2">
            <Button
              type="button"
              disabled={busy}
              onClick={() => void run(() => window.infra.sync.exportFile(filePass), false, () => setFilePass(''))}
            >
              {t('sync.export')}
            </Button>
            <Button
              type="button"
              disabled={busy}
              onClick={() => void run(() => window.infra.sync.importFile(filePass), false, () => setFilePass(''))}
            >
              {t('sync.import')}
            </Button>
          </div>
        </>
      )}
    </div>
  )

  const showForm = channels.length === 0 || formOpen
  const missingBackends = (['folder', 'gdrive'] as const).filter((b) => !hasBackend(b))

  return (
    <Modal title={t('sync.title')} onClose={onClose}>
      <div className="w-[460px] max-w-full">
        {channels.length === 0 && <p className="mb-3 text-xs leading-relaxed text-muted">{t('sync.desc')}</p>}

        {channels.length > 0 && (
          <>
            <div className="text-success mb-2 text-xs">{t('sync.on')}</div>
            {channels.map(channelCard)}
            {/* Kênh còn thiếu bật thêm được ngay tại đây — hai kênh chạy SONG SONG, không phải
                tắt cái này mới bật được cái kia (đã có user kẹt đúng chỗ đó ở bản một-kênh) */}
            {!formOpen && missingBackends.length > 0 && (
              <div className="mb-3 flex items-center gap-1.5 text-[11px]">
                <span className="text-subtle">{t('sync.addChannel')}</span>
                {missingBackends.map((b) => (
                  <button
                    key={b}
                    type="button"
                    className="border-edge-strong text-muted hover:bg-hover cursor-pointer rounded border px-2 py-1"
                    onClick={() => {
                      setFormBackend(b)
                      setFormOpen(true)
                      setError(null)
                      setMessage(null)
                    }}
                  >
                    ＋ {t(b === 'folder' ? 'sync.backendFolder' : 'sync.backendGdrive')}
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {showForm && setupForm}

        {channels.length > 0 && (
          <Field label={t('sync.auto')}>
            <Select
              value={String(status?.autoMinutes ?? 0)}
              onChange={(e) => void setAuto(Number(e.target.value))}
            >
              {AUTO_CHOICES.map((m) => (
                <option key={m} value={m}>
                  {m === 0 ? t('sync.autoOff') : t('sync.autoEvery', { n: String(m) })}
                </option>
              ))}
            </Select>
          </Field>
        )}

        {fileSection}

        {error && <p className="mb-2 whitespace-pre-line text-xs text-danger">{error}</p>}
        {message && <p className="mb-2 whitespace-pre-line text-xs text-success">{message}</p>}

        <div className="flex justify-end gap-2">
          {forceAction && (
            <Button variant="danger" disabled={busy} onClick={() => void run(forceAction, true)}>
              {t('sync.force')}
            </Button>
          )}
          {showForm ? (
            <Button
              variant="primary"
              disabled={busy || (formBackend === 'gdrive' && !gdrive?.connected)}
              onClick={() => configure()}
            >
              {busy ? t('sync.setting') : formBackend === 'gdrive' ? t('sync.gd.enable') : t('sync.enable')}
            </Button>
          ) : (
            <Button variant="primary" disabled={busy} onClick={() => syncNow()}>
              {busy ? t('sync.syncing') : t('sync.now')}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  )
}
