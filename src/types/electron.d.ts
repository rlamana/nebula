export interface IElectronAPI {
  parsePSD: (filePath: string) => Promise<any>
  readDirectory: (dirPath: string) => Promise<{
    name: string
    path: string
    type: 'file' | 'directory'
    size: number
    modified: Date
  }[]>
  getHomeDirectory: () => Promise<string>
}

declare global {
  interface Window {
    electronAPI: IElectronAPI
  }
}