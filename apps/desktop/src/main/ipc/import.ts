import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { dialog, ipcMain } from 'electron'
import { importSshConfig } from '@infra/core'
import { IPC, type SshConfigImportResult } from '@infra/shared'
import { getVault, touchActivity } from './vault'

export function registerImportIpc(): void {
  ipcMain.handle(IPC.IMPORT_SSH_CONFIG, async (): Promise<SshConfigImportResult | null> => {
    touchActivity()
    const defaultPath = path.join(os.homedir(), '.ssh', 'config')
    const result = await dialog.showOpenDialog({
      title: 'Chọn file ssh_config',
      defaultPath,
      properties: ['openFile', 'showHiddenFiles']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const content = await fsp.readFile(result.filePaths[0]!, 'utf8')
    return importSshConfig(getVault(), content)
  })
}
