import { ipcMain } from 'electron'
import { detectShells } from '@infra/core'
import {
  IPC,
  type GroupInput,
  type HostInput,
  type KeyImportInput,
  type ShellProfile,
  type SnippetInput
} from '@infra/shared'
import { getVault, touchActivity } from './vault'

let shellsPromise: Promise<ShellProfile[]> | null = null

export function loadShells(): Promise<ShellProfile[]> {
  return (shellsPromise ??= detectShells())
}

/** CRUD hosts/groups/keys/history — mọi handler đều reset đồng hồ auto-lock. */
export function registerDataIpc(): void {
  ipcMain.handle(IPC.SHELLS_LIST, () => loadShells())

  ipcMain.handle(IPC.GROUPS_LIST, () => {
    touchActivity()
    return getVault().listGroups()
  })
  ipcMain.handle(IPC.GROUPS_SAVE, (_e, input: GroupInput) => {
    touchActivity()
    return getVault().saveGroup(input)
  })
  ipcMain.handle(IPC.GROUPS_DELETE, (_e, id: string) => {
    touchActivity()
    getVault().deleteGroup(id)
  })

  ipcMain.handle(IPC.HOSTS_LIST, () => {
    touchActivity()
    return getVault().listHosts()
  })
  ipcMain.handle(IPC.HOSTS_SAVE, (_e, input: HostInput) => {
    touchActivity()
    return getVault().saveHost(input)
  })
  ipcMain.handle(IPC.HOSTS_DELETE, (_e, id: string) => {
    touchActivity()
    getVault().deleteHost(id)
  })

  ipcMain.handle(IPC.KEYS_LIST, () => {
    touchActivity()
    return getVault().listKeys()
  })
  ipcMain.handle(IPC.KEYS_GENERATE, (_e, label: string) => {
    touchActivity()
    return getVault().generateKey(label)
  })
  ipcMain.handle(IPC.KEYS_IMPORT, (_e, input: KeyImportInput) => {
    touchActivity()
    return getVault().importKey(input)
  })
  ipcMain.handle(IPC.KEYS_DELETE, (_e, id: string) => {
    touchActivity()
    getVault().deleteKey(id)
  })

  ipcMain.handle(IPC.HISTORY_LIST, (_e, limit?: number) => {
    touchActivity()
    return getVault().listHistory(limit)
  })

  ipcMain.handle(IPC.SNIPPETS_LIST, () => {
    touchActivity()
    return getVault().listSnippets()
  })
  ipcMain.handle(IPC.SNIPPETS_SAVE, (_e, input: SnippetInput) => {
    touchActivity()
    return getVault().saveSnippet(input)
  })
  ipcMain.handle(IPC.SNIPPETS_DELETE, (_e, id: string) => {
    touchActivity()
    getVault().deleteSnippet(id)
  })
}
