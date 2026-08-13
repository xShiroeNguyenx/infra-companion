import { useEffect, useMemo, useRef, useState } from 'react'
import type { UpdateCheckResultDto } from '@infra/shared'
// Logo thật của app (cùng `master` với icon.ico/icns — xem scripts/generate-icons.mjs).
// `?inline` ép thành data URI: bản đóng gói nạp renderer qua `file://`, mà CSP là
// `img-src 'self' data:` — asset thành URL file:// thì `'self'` không chắc khớp và ảnh sẽ
// im lặng không hiện, lỗi chỉ lộ ở bản đã cài chứ không thấy khi `pnpm dev`.
import iconUrl from '../../../../build/icon-128.png?inline'
import { ShortcutRow } from '../features/dashboard/DashboardView'
import { MiniMarkdown } from '../lib/miniMarkdown'
import { APP_SHORTCUTS, terminalShortcuts, type ShortcutEntry } from '../lib/shortcutList'
import { useSettingsStore } from '../stores/settings'
import { useT } from '../i18n'
import { Button, ModalOrPanel } from './ui'
import { OpenInTabButton } from './OpenInTabButton'

/**
 * Trung tâm Trợ giúp — About + tra cứu + đường ra khi có sự cố.
 *
 * Bốn thẻ vì bốn câu hỏi khác nhau: *đang chạy bản nào* (Giới thiệu), *phím gì* (Phím tắt),
 * *bản này có gì mới* (Có gì mới), *hỏng thì lấy gì gửi đi* (Gỡ rối).
 *
 * Mở được cả dạng popup lẫn tab (`embedded`) như các công cụ khác.
 */

const REPO_URL = 'https://github.com/xShiroeNguyenx/infra-companion'
const SITE_URL = 'https://xshiroenguyenx.github.io/infra-companion/'
const GUIDE_URL = `${REPO_URL}/blob/main/docs/USER-GUIDE.md`
const CHANGELOG_URL = `${REPO_URL}/blob/main/CHANGELOG.md`
const ISSUES_URL = `${REPO_URL}/issues`
const LICENSE_URL = `${REPO_URL}/blob/main/LICENSE`

const LOCALES = { vi: 'vi-VN', en: 'en-US', ja: 'ja-JP' } as const

export type HelpTab = 'about' | 'shortcuts' | 'whatsNew' | 'trouble'
const TABS: readonly HelpTab[] = ['about', 'shortcuts', 'whatsNew', 'trouble']

/**
 * Thông tin môi trường để dán vào issue.
 *
 * ⚠️ CHỈ thông tin về phần mềm. Không host, không IP, không user, không tên máy, không đường dẫn
 * — repo là public và text này sinh ra để đăng công khai.
 */
function systemInfo(): string {
  const v = window.infra.versions
  const commit = __GIT_COMMIT__ ? ` (${__GIT_COMMIT__})` : ''
  return [
    `Infra Companion ${__APP_VERSION__}${commit}`,
    `Build: ${__BUILD_DATE__}`,
    `Electron ${v.electron} · Node ${v.node} · Chromium ${v.chrome}`,
    `OS: ${v.platform} ${v.osRelease} (${v.arch})`
  ].join('\n')
}

/** Link ra ngoài: target="_blank" là BẮT BUỘC — main chỉ mở browser cho window-open, còn điều
 *  hướng thẳng thì bị `will-navigate` chặn và link sẽ không làm gì cả. */
function ExtLink({ href, children }: { href: string; children: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="text-accent hover:underline">
      {children}
    </a>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3 py-0.5">
      <span className="text-subtle w-32 shrink-0 text-[11px]">{label}</span>
      <span className="text-content min-w-0 font-mono text-[11px] break-all">{value}</span>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-4">
      <h3 className="text-subtle mb-2 text-[10px] font-semibold tracking-wider uppercase">{title}</h3>
      {children}
    </section>
  )
}

function ShortcutTable({ items, t }: { items: ShortcutEntry[]; t: ReturnType<typeof useT> }) {
  return (
    <div className="border-edge divide-edge divide-y rounded border">
      {items.map((sc) => (
        <ShortcutRow key={sc.key} label={t(sc.key)} keys={sc.combo} />
      ))}
    </div>
  )
}

export function HelpModal({
  onClose,
  embedded,
  initialTab = 'about'
}: {
  onClose?: () => void
  embedded?: boolean
  initialTab?: HelpTab
}) {
  const t = useT()
  const locale = LOCALES[useSettingsStore((s) => s.language)]
  const termShortcuts = useSettingsStore((s) => s.shortcuts)
  const [tab, setTab] = useState<HelpTab>(initialTab)
  const [checking, setChecking] = useState(false)
  const [checkResult, setCheckResult] = useState<UpdateCheckResultDto | null>(null)
  const [copied, setCopied] = useState(false)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Mở lại bằng Ctrl+/ trong khi cửa sổ đang mở ở thẻ khác → vẫn phải nhảy sang thẻ được yêu cầu
  useEffect(() => setTab(initialTab), [initialTab])

  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current)
    },
    []
  )

  const v = window.infra.versions
  const buildDate = useMemo(() => {
    const d = new Date(__BUILD_DATE__)
    return Number.isNaN(d.getTime()) ? __BUILD_DATE__ : d.toLocaleString(locale)
  }, [locale])

  const copyInfo = (): void => {
    void navigator.clipboard.writeText(systemInfo())
    setCopied(true)
    if (copyTimer.current) clearTimeout(copyTimer.current)
    copyTimer.current = setTimeout(() => setCopied(false), 1500)
  }

  const check = async (): Promise<void> => {
    setChecking(true)
    setCheckResult(null)
    try {
      setCheckResult(await window.infra.update.check())
    } catch (err) {
      // invoke ném khi main chết/chưa đăng ký handler — vẫn phải nói ra, đừng để nút quay mãi
      setCheckResult({ status: 'error', message: err instanceof Error ? err.message : String(err) })
    } finally {
      setChecking(false)
    }
  }

  const checkMessage = (r: UpdateCheckResultDto): string => {
    if (r.status === 'dev') return t('help.updDev')
    if (r.status === 'available') return t('help.updAvailable', { version: r.version })
    if (r.status === 'latest') return t('help.updLatest', { version: r.version })
    return t('help.updError', { message: r.message })
  }

  return (
    <ModalOrPanel
      embedded={embedded}
      title={`❓ ${t('help.title')}`}
      onClose={onClose}
      headerExtra={embedded ? undefined : <OpenInTabButton kind="help" onDone={onClose} />}
    >
      <div className="w-[680px] max-w-full">
        <div className="border-edge-strong mb-3 flex w-fit overflow-hidden rounded border text-xs">
          {TABS.map((k) => (
            <button
              key={k}
              type="button"
              className={`px-3 py-1 ${tab === k ? 'bg-accent-soft/60 text-accent-fg' : 'text-muted hover:bg-hover'}`}
              onClick={() => setTab(k)}
            >
              {t(`help.tab.${k}` as const)}
            </button>
          ))}
        </div>

        {tab === 'about' && (
          <>
            <div className="mb-4 flex items-center gap-4">
              {/* Không bo góc: logo là hình lục giác trên nền trong suốt, bo góc chỉ cắt vào chỗ trống */}
              <img src={iconUrl} alt="" className="h-16 w-16 shrink-0" />
              <div className="min-w-0">
                <p className="text-content text-lg font-semibold">Infra Companion</p>
                <p className="text-muted text-sm">
                  {t('help.version', { version: __APP_VERSION__ })}
                  {v.arch === 'x64' || v.arch === 'arm64' ? ' (64-bit)' : ''}
                </p>
                <p className="text-subtle text-[11px]">{t('help.tagline')}</p>
              </div>
            </div>

            <Section title={t('help.buildInfo')}>
              <Row label={t('help.builtAt')} value={__GIT_COMMIT__ ? `${buildDate} · ${__GIT_COMMIT__}` : buildDate} />
              <Row label="Electron" value={`${v.electron} · Chromium ${v.chrome} · Node ${v.node}`} />
              <Row label={t('help.os')} value={`${v.platform} ${v.osRelease} (${v.arch})`} />
              <Row label={t('help.publisher')} value={__PUBLISHER__} />
            </Section>

            <Section title={t('help.links')}>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                <ExtLink href={REPO_URL}>{t('help.linkRepo')}</ExtLink>
                <ExtLink href={SITE_URL}>{t('help.linkSite')}</ExtLink>
                <ExtLink href={GUIDE_URL}>{t('help.linkGuide')}</ExtLink>
                <ExtLink href={LICENSE_URL}>MIT License · © 2026 NguyenKhanh</ExtLink>
              </div>
            </Section>

            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary" disabled={checking} onClick={() => void check()}>
                {checking ? t('help.checking') : t('help.checkUpdate')}
              </Button>
              <Button onClick={copyInfo}>{copied ? t('help.copied') : t('help.copyInfo')}</Button>
              {checkResult?.status === 'available' && (
                <Button onClick={() => void window.infra.update.download()}>{t('update.download')}</Button>
              )}
            </div>
            {checkResult && (
              <p
                className={`mt-2 text-xs ${checkResult.status === 'error' ? 'text-danger' : 'text-muted'}`}
              >
                {checkMessage(checkResult)}
              </p>
            )}
            <p className="text-subtle mt-2 text-[10px]">{t('help.copyInfoHint')}</p>
          </>
        )}

        {tab === 'shortcuts' && (
          <>
            <Section title={t('help.scApp')}>
              <ShortcutTable items={[...APP_SHORTCUTS]} t={t} />
            </Section>
            <Section title={t('help.scTerminal')}>
              <ShortcutTable items={terminalShortcuts(termShortcuts)} t={t} />
              <p className="text-subtle mt-1.5 text-[10px]">{t('help.scTerminalHint')}</p>
            </Section>
            <p className="text-subtle text-[10px]">{t('dashboard.sc.mouseTip')}</p>
          </>
        )}

        {tab === 'whatsNew' && (
          <>
            <p className="text-subtle mb-2 text-[11px]">{t('help.whatsNewFor', { version: __APP_VERSION__ })}</p>
            {__RELEASE_NOTES__ ? (
              <div className="border-edge max-h-[50vh] overflow-y-auto rounded border px-3 py-2">
                <MiniMarkdown source={__RELEASE_NOTES__} />
              </div>
            ) : (
              <p className="text-muted text-sm">{t('help.noReleaseNotes')}</p>
            )}
            <p className="mt-2 text-xs">
              <ExtLink href={CHANGELOG_URL}>{t('help.fullChangelog')}</ExtLink>
            </p>
          </>
        )}

        {tab === 'trouble' && (
          <>
            <Section title={t('help.folders')}>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => window.infra.help.openUserData()}>{t('help.openUserData')}</Button>
                <Button onClick={() => window.infra.terminal.openLogFolder()}>{t('menu.openLogs')}</Button>
                <Button onClick={() => window.infra.recordings.openFolder()}>{t('help.openRecordings')}</Button>
              </div>
              <p className="text-subtle mt-1.5 text-[10px] leading-relaxed">{t('help.logWarning')}</p>
            </Section>

            <Section title={t('help.reportBug')}>
              <p className="text-muted mb-2 text-xs leading-relaxed">{t('help.reportHint')}</p>
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <ExtLink href={ISSUES_URL}>{t('help.openIssues')}</ExtLink>
                <Button onClick={copyInfo}>{copied ? t('help.copied') : t('help.copyInfo')}</Button>
              </div>
            </Section>
          </>
        )}
      </div>
    </ModalOrPanel>
  )
}
