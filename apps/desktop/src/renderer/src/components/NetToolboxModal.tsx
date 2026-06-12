import { useState } from 'react'
import type { DnsResultDto, PingResultDto, PortScanEntryDto } from '@infra/shared'
import { Button, Modal, TextInput } from './ui'

type Tab = 'ping' | 'dns' | 'scan'

/** Network toolbox (F07): ping / DNS lookup / port scan — Termius không có. */
export function NetToolboxModal({ onClose }: { onClose: () => void }) {
  const [host, setHost] = useState('')
  const [tab, setTab] = useState<Tab>('ping')
  const [busy, setBusy] = useState(false)
  const [ping, setPing] = useState<PingResultDto | null>(null)
  const [dns, setDns] = useState<DnsResultDto | null>(null)
  const [scan, setScan] = useState<PortScanEntryDto[] | null>(null)

  const run = async (which: Tab): Promise<void> => {
    const target = host.trim()
    if (!target || busy) return
    setTab(which)
    setBusy(true)
    try {
      if (which === 'ping') setPing(await window.infra.net.ping(target))
      else if (which === 'dns') setDns(await window.infra.net.dns(target))
      else setScan(await window.infra.net.scan(target))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Network Toolbox" onClose={onClose}>
      <div className="w-[560px] max-w-full">
        <div className="mb-3 flex gap-2">
          <TextInput
            autoFocus
            value={host}
            onChange={(e) => setHost(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void run(tab)
            }}
            placeholder="host hoặc IP, vd: 1.1.1.1 / example.com"
            className="flex-1"
          />
        </div>
        <div className="mb-3 flex gap-2">
          <Button variant={tab === 'ping' ? 'primary' : 'default'} disabled={busy || !host.trim()} onClick={() => void run('ping')}>
            Ping
          </Button>
          <Button variant={tab === 'dns' ? 'primary' : 'default'} disabled={busy || !host.trim()} onClick={() => void run('dns')}>
            DNS lookup
          </Button>
          <Button variant={tab === 'scan' ? 'primary' : 'default'} disabled={busy || !host.trim()} onClick={() => void run('scan')}>
            Quét port phổ biến
          </Button>
          {busy && <span className="self-center text-xs text-amber-400">đang chạy…</span>}
        </div>

        <div className="min-h-32 rounded border border-zinc-800 bg-zinc-950 p-3">
          {tab === 'ping' && ping && (
            <div>
              <div className="mb-2 text-xs">
                <span className={ping.alive ? 'text-emerald-400' : 'text-red-400'}>
                  {ping.alive ? '● Sống' : '○ Không phản hồi'}
                </span>
                {ping.avgMs !== null && <span className="ml-2 text-zinc-400">trung bình {ping.avgMs} ms</span>}
              </div>
              <pre className="max-h-56 overflow-auto text-[11px] whitespace-pre-wrap text-zinc-400">{ping.output}</pre>
            </div>
          )}

          {tab === 'dns' && dns && (
            <div className="space-y-2 text-xs">
              {dns.error && <p className="text-red-400">{dns.error}</p>}
              <DnsRow label="A (IPv4)" values={dns.a} />
              <DnsRow label="AAAA (IPv6)" values={dns.aaaa} />
              <DnsRow label="Reverse (PTR)" values={dns.reverse} />
            </div>
          )}

          {tab === 'scan' && scan && (
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              {scan.map((entry) => (
                <div key={entry.port} className="flex items-center gap-2">
                  <span className={`size-1.5 rounded-full ${entry.open ? 'bg-emerald-500' : 'bg-zinc-700'}`} />
                  <span className={entry.open ? 'text-zinc-200' : 'text-zinc-600'}>
                    {entry.port} {entry.service}
                  </span>
                  {entry.open && <span className="text-emerald-400">mở</span>}
                </div>
              ))}
            </div>
          )}

          {((tab === 'ping' && !ping) || (tab === 'dns' && !dns) || (tab === 'scan' && !scan)) && !busy && (
            <p className="py-8 text-center text-xs text-zinc-600">Nhập host rồi chọn công cụ ở trên.</p>
          )}
        </div>
      </div>
    </Modal>
  )
}

function DnsRow({ label, values }: { label: string; values: string[] }) {
  return (
    <div>
      <span className="text-zinc-500">{label}: </span>
      {values.length > 0 ? (
        <span className="font-mono text-zinc-200">{values.join(', ')}</span>
      ) : (
        <span className="text-zinc-600">—</span>
      )}
    </div>
  )
}
