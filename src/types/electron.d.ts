export interface IElectronAPI {
  parsePSD: (filePath: string) => Promise<any>
}

declare global {
  interface Window {
    electronAPI: IElectronAPI
  }
}