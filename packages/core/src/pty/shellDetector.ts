import { existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import * as os from 'node:os'
import * as path from 'node:path'
import type { ShellProfile } from '@infra/shared'

const execFileAsync = promisify(execFile)

/** Phát hiện các shell có sẵn trên máy. Shell đầu tiên trong danh sách là mặc định. */
export async function detectShells(): Promise<ShellProfile[]> {
  if (process.platform === 'win32') return detectWindowsShells()
  return detectUnixShells()
}

async function detectWindowsShells(): Promise<ShellProfile[]> {
  const shells: ShellProfile[] = []
  const systemRoot = process.env['SystemRoot'] ?? 'C:\\Windows'
  const programFiles = process.env['ProgramFiles'] ?? 'C:\\Program Files'
  const programFilesX86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'
  const localAppData = process.env['LOCALAPPDATA'] ?? ''

  const pwshPath = path.join(programFiles, 'PowerShell', '7', 'pwsh.exe')
  if (existsSync(pwshPath)) {
    shells.push({ id: 'pwsh', label: 'PowerShell 7', shellPath: pwshPath, args: ['-NoLogo'], icon: 'powershell' })
  }

  const powershellPath = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  if (existsSync(powershellPath)) {
    shells.push({
      id: 'powershell',
      label: 'Windows PowerShell',
      shellPath: powershellPath,
      args: ['-NoLogo'],
      icon: 'powershell'
    })
  }

  const cmdPath = path.join(systemRoot, 'System32', 'cmd.exe')
  if (existsSync(cmdPath)) {
    shells.push({ id: 'cmd', label: 'Command Prompt', shellPath: cmdPath, icon: 'cmd' })
  }

  const gitBashCandidates = [
    path.join(programFiles, 'Git', 'bin', 'bash.exe'),
    path.join(programFilesX86, 'Git', 'bin', 'bash.exe'),
    localAppData ? path.join(localAppData, 'Programs', 'Git', 'bin', 'bash.exe') : ''
  ].filter(Boolean)
  const gitBash = gitBashCandidates.find((p) => existsSync(p))
  if (gitBash) {
    shells.push({ id: 'git-bash', label: 'Git Bash', shellPath: gitBash, args: ['--login', '-i'], icon: 'bash' })
  }

  for (const distro of await listWslDistros()) {
    shells.push({
      id: `wsl:${distro}`,
      label: `WSL — ${distro}`,
      shellPath: path.join(systemRoot, 'System32', 'wsl.exe'),
      args: ['-d', distro],
      icon: 'wsl'
    })
  }

  return shells
}

/** `wsl.exe -l -q` xuất UTF-16LE — phải decode đúng, lọc ký tự null thừa. */
async function listWslDistros(): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('wsl.exe', ['-l', '-q'], {
      encoding: 'utf16le',
      timeout: 5_000,
      windowsHide: true
    })
    return stdout
      .split(/\r?\n/)
      .map((line) => line.replace(/\0/g, '').trim())
      .filter((line) => line.length > 0 && !line.startsWith('docker-desktop'))
  } catch {
    return []
  }
}

async function detectUnixShells(): Promise<ShellProfile[]> {
  const shells: ShellProfile[] = []
  const userShell = process.env['SHELL']
  if (userShell && existsSync(userShell)) {
    shells.push({
      id: 'default',
      label: `Default (${path.basename(userShell)})`,
      shellPath: userShell,
      icon: iconForShell(userShell)
    })
  }
  const candidates = ['/bin/zsh', '/usr/bin/zsh', '/bin/bash', '/usr/bin/bash', '/usr/bin/fish', '/opt/homebrew/bin/fish']
  for (const candidate of candidates) {
    if (candidate === userShell || !existsSync(candidate)) continue
    const name = path.basename(candidate)
    if (shells.some((s) => path.basename(s.shellPath) === name)) continue
    shells.push({ id: name, label: name, shellPath: candidate, icon: iconForShell(candidate) })
  }
  if (shells.length === 0) {
    shells.push({ id: 'sh', label: 'sh', shellPath: '/bin/sh', icon: 'shell' })
  }
  return shells
}

function iconForShell(shellPath: string): ShellProfile['icon'] {
  const name = path.basename(shellPath)
  if (name.includes('zsh')) return 'zsh'
  if (name.includes('fish')) return 'fish'
  if (name.includes('bash')) return 'bash'
  return 'shell'
}

export function defaultCwd(): string {
  return os.homedir()
}
