import { useState, useEffect } from 'react'
import { FileDropZone } from './components/FileDropZone'
import { LayerTree } from './components/LayerTree'
import { Header } from './components/Header'
import { Sidebar } from './components/Sidebar'
import type { ParsedPSD } from './types/psd'

function App() {
  const [parsedFile, setParsedFile] = useState<ParsedPSD | null>(null)
  const [selectedLayer, setSelectedLayer] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [apiReady, setApiReady] = useState(false)

  useEffect(() => {
    // Check if electronAPI is available immediately
    const checkAPI = () => {
      console.log('Checking for electronAPI...', !!window.electronAPI)
      if (window.electronAPI) {
        console.log('Electron API is available')
        setApiReady(true)
        return true
      }
      return false
    }

    // Check immediately
    if (checkAPI()) return

    // If not available, wait for DOM ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        setTimeout(checkAPI, 100)
      })
    } else {
      // DOM is already ready, try a few more times
      let attempts = 0
      const maxAttempts = 50
      const interval = setInterval(() => {
        attempts++
        if (checkAPI() || attempts >= maxAttempts) {
          clearInterval(interval)
          if (attempts >= maxAttempts && !window.electronAPI) {
            console.error('Failed to load Electron API after', maxAttempts, 'attempts')
          }
        }
      }, 100)
    }
  }, [])

  const handleFileLoad = async (filePath: string) => {
    setIsLoading(true)
    try {
      if (!window.electronAPI) {
        throw new Error('Electron API not available. Please restart the application.')
      }
      const result = await window.electronAPI.parsePSD(filePath)
      setParsedFile(result)
    } catch (error) {
      console.error('Failed to parse file:', error)
      alert('Failed to parse file: ' + (error as Error).message)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="h-screen bg-nebula-dark text-white overflow-hidden">
      <Header />
      
      <div className="flex h-[calc(100vh-4rem)]">
        <Sidebar />
        
        <main className="flex-1 flex">
          {!parsedFile ? (
            <div className="flex-1 flex items-center justify-center p-8">
              {!apiReady ? (
                <div className="text-center">
                  <div className="animate-spin w-8 h-8 border-2 border-nebula-teal border-t-transparent rounded-full mx-auto mb-4"></div>
                  <p>Initializing Electron API...</p>
                </div>
              ) : (
                <FileDropZone onFileLoad={handleFileLoad} isLoading={isLoading} />
              )}
            </div>
          ) : (
            <>
              <div className="w-80 border-r border-white/10 bg-black/20">
                <LayerTree 
                  layers={parsedFile.children || []}
                  selectedLayer={selectedLayer}
                  onSelectLayer={setSelectedLayer}
                />
              </div>
              
              <div className="flex-1 bg-black/5 p-4">
                <div className="glass-card h-full p-6">
                  <h2 className="text-xl font-semibold mb-4 gradient-text">
                    {parsedFile.name || 'Untitled'}
                  </h2>
                  <div className="text-sm text-gray-400">
                    <p>Dimensions: {parsedFile.width} × {parsedFile.height}px</p>
                    <p>Color Mode: {parsedFile.colorMode}</p>
                    <p>Layers: {parsedFile.children?.length || 0}</p>
                  </div>
                </div>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  )
}

export default App