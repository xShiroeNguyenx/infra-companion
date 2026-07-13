import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useT } from '../i18n'

/**
 * Render một SUBSET markdown an toàn cho panel plugin → cây React element
 * (KHÔNG dùng dangerouslySetInnerHTML, KHÔNG thêm dependency).
 * Hỗ trợ: heading #/##/###, **đậm**, *nghiêng*, `code`, code block ```, danh sách "- ", link http(s).
 * Code block có nút 📋 copy (hiện khi hover) — tiện copy nguyên đoạn config/lệnh AI gợi ý.
 * Link chỉ nhận http/https (an toàn) — Electron mở bằng trình duyệt ngoài.
 * Link `cmd:` = nút hành động gọi ngược về plugin sở hữu panel: [nhãn](cmd:command.id?arg)
 * — chỉ hoạt động khi caller truyền onCommand (PluginPanelModal); nơi khác render text thường.
 */

type OnCommand = (commandId: string, arg?: string) => void

/** Khối code ``` kèm nút copy nổi góc trên-phải (hiện khi hover, đổi thành "Đã sao chép ✓" 1.5s). */
function CodeBlock({ code }: { code: string }) {
  const t = useT()
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )
  const copy = (): void => {
    void navigator.clipboard.writeText(code)
    setCopied(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div className="group relative my-1">
      <pre className="overflow-x-auto rounded bg-hover p-2 font-mono text-[11px] text-content">
        <code>{code}</code>
      </pre>
      <button
        type="button"
        className={`absolute top-1 right-1 rounded border px-1.5 py-0.5 text-[10px] leading-none transition-opacity ${
          copied
            ? 'border-accent text-accent opacity-100'
            : 'border-edge-strong bg-elevated/90 text-subtle hover:text-content opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
        }`}
        aria-label={t('md.copy')}
        title={copied ? t('md.copied') : t('md.copy')}
        onClick={copy}
      >
        {copied ? t('md.copied') : '📋'}
      </button>
    </div>
  )
}

const INLINE_RE = /\[([^\]]+)\]\(((?:https?:\/\/|cmd:)[^\s)]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`/g

function renderRich(text: string, keyPrefix: string, onCommand?: OnCommand): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let i = 0
  let m: RegExpExecArray | null
  INLINE_RE.lastIndex = 0
  while ((m = INLINE_RE.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const key = `${keyPrefix}-${i++}`
    if (m[1] && m[2]) {
      const label = m[1]
      const url = m[2]
      if (url.startsWith('cmd:')) {
        const rest = url.slice(4)
        const q = rest.indexOf('?')
        const commandId = q >= 0 ? rest.slice(0, q) : rest
        const arg = q >= 0 ? decodeURIComponent(rest.slice(q + 1)) : undefined
        out.push(
          onCommand ? (
            <button
              key={key}
              type="button"
              className="border-edge-strong bg-hover text-accent hover:border-accent inline-block cursor-pointer rounded border px-1.5 py-0.5 text-[11px] leading-none"
              onClick={() => onCommand(commandId, arg)}
            >
              {label}
            </button>
          ) : (
            label
          )
        )
      } else {
        out.push(
          <a key={key} href={url} target="_blank" rel="noreferrer" className="text-accent underline">
            {label}
          </a>
        )
      }
    } else if (m[3]) {
      out.push(<strong key={key}>{m[3]}</strong>)
    } else if (m[4]) {
      out.push(<em key={key}>{m[4]}</em>)
    } else if (m[5]) {
      out.push(
        <code key={key} className="rounded bg-hover px-1 py-0.5 font-mono text-[0.85em]">
          {m[5]}
        </code>
      )
    }
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

function renderBlocks(md: string, onCommand?: OnCommand): ReactNode[] {
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let i = 0
  let bi = 0
  while (i < lines.length) {
    const line = lines[i]!

    if (line.trimStart().startsWith('```')) {
      const code: string[] = []
      i++
      while (i < lines.length && !lines[i]!.trimStart().startsWith('```')) {
        code.push(lines[i]!)
        i++
      }
      i++ // bỏ fence đóng
      blocks.push(<CodeBlock key={bi++} code={code.join('\n')} />)
      continue
    }

    const h = /^(#{1,3})\s+(.*)$/.exec(line)
    if (h) {
      const level = h[1]!.length
      const cls = level === 1 ? 'text-base font-semibold' : level === 2 ? 'text-sm font-semibold' : 'text-sm font-medium'
      blocks.push(
        <div key={bi} className={`mt-2 mb-1 text-content ${cls}`}>
          {renderRich(h[2]!, `h${bi++}`, onCommand)}
        </div>
      )
      i++
      continue
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: ReactNode[] = []
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i]!)) {
        const item = lines[i]!.replace(/^\s*[-*]\s+/, '')
        items.push(<li key={items.length}>{renderRich(item, `li${bi}-${items.length}`, onCommand)}</li>)
        i++
      }
      blocks.push(
        <ul key={bi++} className="my-1 list-disc pl-5 text-sm text-content">
          {items}
        </ul>
      )
      continue
    }

    if (line.trim() === '') {
      i++
      continue
    }

    const para: string[] = []
    while (
      i < lines.length &&
      lines[i]!.trim() !== '' &&
      !lines[i]!.trimStart().startsWith('```') &&
      !/^(#{1,3})\s+/.test(lines[i]!) &&
      !/^\s*[-*]\s+/.test(lines[i]!)
    ) {
      para.push(lines[i]!)
      i++
    }
    blocks.push(
      <p key={bi} className="my-1 text-sm leading-relaxed text-content">
        {renderRich(para.join(' '), `p${bi++}`, onCommand)}
      </p>
    )
  }
  return blocks
}

export function MiniMarkdown({ source, onCommand }: { source: string; onCommand?: OnCommand }) {
  return <div className="break-words">{renderBlocks(source, onCommand)}</div>
}
