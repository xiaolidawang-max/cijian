import { Capacitor, registerPlugin } from '@capacitor/core'

interface BackupFilePlugin {
  saveFile(options: { filename: string; contents: string }): Promise<{ saved: boolean }>
}

const BackupFile = registerPlugin<BackupFilePlugin>('BackupFile')
export type BackupFileResult = 'saved' | 'downloaded' | 'cancelled'

/** Android opens its system Save dialog; a browser keeps its normal download. */
export async function saveStudyBackupFile(filename: string, contents: string): Promise<BackupFileResult> {
  if (!filename.trim() || filename.length > 120 || !filename.toLowerCase().endsWith('.json') || /[\u0000-\u001f\u007f\\/:*?"<>|]/.test(filename)) {
    throw new Error('备份文件名无效。')
  }
  const blob = new Blob([contents], { type: 'application/json;charset=utf-8' })
  if (!contents || blob.size > 2_000_000) throw new Error('备份内容为空或超过 2 MB。')
  if (Capacitor.getPlatform() === 'android') {
    const result = await BackupFile.saveFile({ filename, contents })
    return result.saved ? 'saved' : 'cancelled'
  }

  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  try {
    link.click()
    return 'downloaded'
  } finally {
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}
