import { useState, useEffect } from 'react'
import { FileDropZone } from './components/FileDropZone'
import { LayerTree } from './components/LayerTree'
import { ResizableSidebar } from './components/ResizableSidebar'
import type { ParsedPSD } from './types/psd'

function App() {
  const [parsedFile, setParsedFile] = useState<ParsedPSD | null>(null)
  const [selectedLayer, setSelectedLayer] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
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
    setSelectedFile(filePath)
    try {
      if (!window.electronAPI) {
        throw new Error('Electron API not available. Please restart the application.')
      }
      const result = await window.electronAPI.parsePSD(filePath)
      setParsedFile(result)
    } catch (error) {
      console.error('Failed to parse file:', error)
      alert('Failed to parse file: ' + (error as Error).message)
      setSelectedFile(null)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="h-screen bg-nebula-dark text-white overflow-hidden flex">
      {/* Sidebar with full height and window button margin */}
      <div className="flex flex-col">
        <ResizableSidebar onFileSelect={handleFileLoad} selectedFile={selectedFile} />
      </div>
      
      {/* Main content area */}
      <main className="flex-1 flex flex-col">
        {/* Draggable titlebar area for main content */}
        <div 
          className="h-8 bg-transparent flex items-center px-4 drag-region flex-shrink-0"
          style={{ WebkitAppRegion: 'drag' } as any}
        >
          {/* Empty draggable area for window movement */}
        </div>
        
        {/* Main content */}
        <div className="flex-1 flex no-drag">
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
              <div className="flex-1 bg-black/20">
                <LayerTree 
                  layers={parsedFile.children || []}
                  selectedLayer={selectedLayer}
                  onSelectLayer={setSelectedLayer}
                />
              </div>
              
              <div className="w-60 border-l border-white/10 bg-black/10 p-4">
                <div className="glass-card h-full p-4">
                  <h3 className="text-lg font-semibold mb-3 gradient-text truncate" title={parsedFile.name || (selectedFile ? selectedFile.split('/').pop() || 'Untitled' : 'Untitled')}>
                    {parsedFile.name || (selectedFile ? selectedFile.split('/').pop() || 'Untitled' : 'Untitled')}
                  </h3>
                  <div className="space-y-2 text-sm text-gray-300">
                    <div>
                      <span className="text-gray-400">Dimensions:</span>
                      <br />
                      <span className="text-white">{parsedFile.width} × {parsedFile.height}px</span>
                    </div>
                    <div>
                      <span className="text-gray-400">Color Mode:</span>
                      <br />
                      <span className="text-white">{parsedFile.colorMode}</span>
                    </div>
                    <div>
                      <span className="text-gray-400">Layers:</span>
                      <br />
                      <span className="text-white">{parsedFile.children?.length || 0}</span>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  )
}

export default App