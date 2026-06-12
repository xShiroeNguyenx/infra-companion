import { useState } from 'react'
import type { DnsResultDto, PingResultDto, PortScanEntryDto } from '@infra/shared'
import { Button, Modal, TextInput } from './ui'
import { useT } from '../i18n'

type Tab = 'ping' | 'dns' | 'scan'

/** Network toolbox (F07): ping / DNS lookup / port scan — Termius không có. */
export function NetToolboxModal({ onClose }: { onClose: () => void }) {
  const t = useT()
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
    <Modal title={t('net.title')} onClose={onClose}>
      <div className="w-[560px] max-w-full">
        <div className="mb-3 flex gap-2">
          <TextInput
            autoFocus
            value={host}
            onChange={(e) => setHost(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void run(tab)
            }}
            placeholder={t('net.hostPh')}
            className="flex-1"
          />
        </div>
        <div className="mb-3 flex gap-2">
          <Button variant={tab === 'ping' ? 'primary' : 'default'} disabled={busy || !host.trim()} onClick={() => void run('ping')}>
            {t('net.ping')}
          </Button>
          <Button variant={tab === 'dns' ? 'primary' : 'default'} disabled={busy || !host.trim()} onClick={() => void run('dns')}>
            {t('net.dns')}
          </Button>
          <Button variant={tab === 'scan' ? 'primary' : 'default'} disabled={busy || !host.trim()} onClick={() => void run('scan')}>
            {t('net.scan')}
          </Button>
          {busy && <span className="self-center text-xs text-warning">{t('net.running')}</span>}
        </div>

        <div className="min-h-32 rounded border border-edge bg-input p-3">
          {tab === 'ping' && ping && (
            <div>
              <div className="mb-2 text-xs">
                <span className={ping.alive ? 'text-success' : 'text-danger'}>
                  {ping.alive ? t('net.alive') : t('net.dead')}
                </span>
                {ping.avgMs !== null && <span className="ml-2 text-muted">{t('net.avg', { ms: ping.avgMs })}</span>}
              </div>
              <pre className="max-h-56 overflow-auto text-[11px] whitespace-pre-wrap text-muted">{ping.output}</pre>
            </div>
          )}

          {tab === 'dns' && dns && (
            <div className="space-y-2 text-xs">
              {dns.error && <p className="text-danger">{dns.error}</p>}
              <DnsRow label="A (IPv4)" values={dns.a} />
              <DnsRow label="AAAA (IPv6)" values={dns.aaaa} />
              <DnsRow label="Reverse (PTR)" values={dns.reverse} />
            </div>
          )}

          {tab === 'scan' && scan && (
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              {scan.map((entry) => (
                <div key={entry.port} className="flex items-center gap-2">
                  <span className={`size-1.5 rounded-full ${entry.open ? 'bg-success' : 'bg-edge-strong'}`} />
                  <span className={entry.open ? 'text-content' : 'text-subtle'}>
                    {entry.port} {entry.service}
                  </span>
                  {entry.open && <span className="text-success">{t('net.open')}</span>}
                </div>
              ))}
            </div>
          )}

          {((tab === 'ping' && !ping) || (tab === 'dns' && !dns) || (tab === 'scan' && !scan)) && !busy && (
            <p className="py-8 text-center text-xs text-subtle">{t('net.hint')}</p>
          )}
        </div>
      </div>
    </Modal>
  )
}

function DnsRow({ label, values }: { label: string; values: string[] }) {
  return (
    <div>
      <span className="text-subtle">{label}: </span>
      {values.length > 0 ? (
        <span className="font-mono text-content">{values.join(', ')}</span>
      ) : (
        <span className="text-subtle">—</span>
      )}
    </div>
  )
}
