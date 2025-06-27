import { useState, useCallback } from 'react'
import { Upload, FileImage, Loader2 } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

interface FileDropZoneProps {
  onFileLoad: (filePath: string) => void
  isLoading: boolean
}

export function FileDropZone({ onFileLoad, isLoading }: FileDropZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false)

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    
    const files = Array.from(e.dataTransfer.files)
    const psdFile = files.find(file => 
      file.name.toLowerCase().endsWith('.psd') || 
      file.name.toLowerCase().endsWith('.tiff') ||
      file.name.toLowerCase().endsWith('.tif')
    )
    
    if (psdFile) {
      // In Electron, files have a path property
      const filePath = (psdFile as any).path
      if (filePath) {
        onFileLoad(filePath)
      } else {
        console.error('File path not available:', psdFile)
        alert('Unable to access file path. Please try again.')
      }
    }
  }, [onFileLoad])

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      // In Electron, files have a path property
      const filePath = (file as any).path
      if (filePath) {
        onFileLoad(filePath)
      } else {
        console.error('File path not available:', file)
        alert('Unable to access file path. Please try again.')
      }
    }
  }, [onFileLoad])

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3 }}
        className="w-full max-w-lg"
      >
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`
            relative border-2 border-dashed rounded-2xl p-12 text-center transition-all duration-300
            ${isDragOver 
              ? 'border-nebula-teal bg-nebula-teal/10 scale-105' 
              : 'border-white/20 hover:border-white/30 hover:bg-white/5'
            }
            ${isLoading ? 'pointer-events-none opacity-70' : 'hover-lift'}
          `}
        >
          <input
            type="file"
            accept=".psd,.tiff,.tif"
            onChange={handleFileInput}
            className="absolute inset-0 opacity-0 cursor-pointer"
            disabled={isLoading}
          />
          
          <div className="flex flex-col items-center space-y-6">
            <div className="relative">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-nebula-teal to-nebula-magenta flex items-center justify-center">
                {isLoading ? (
                  <Loader2 className="w-8 h-8 text-white animate-spin" />
                ) : (
                  <FileImage className="w-8 h-8 text-white" />
                )}
              </div>
              
              {!isLoading && (
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
                  className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-nebula-yellow/20 border border-nebula-yellow/50 flex items-center justify-center"
                >
                  <Upload className="w-3 h-3 text-nebula-yellow" />
                </motion.div>
              )}
            </div>
            
            <div className="space-y-2">
              <h3 className="text-xl font-semibold">
                {isLoading ? 'Processing file...' : 'Drop your PSD or TIFF file here'}
              </h3>
              <p className="text-gray-400 text-sm">
                {isLoading 
                  ? 'Parsing layers and extracting structure' 
                  : 'Supports .psd and .tiff files up to 500MB'
                }
              </p>
            </div>
            
            {!isLoading && (
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className="px-6 py-3 bg-gradient-to-r from-nebula-teal to-nebula-magenta rounded-lg font-medium text-white shadow-lg hover:shadow-nebula-teal/25 transition-shadow"
              >
                Choose File
              </motion.button>
            )}
          </div>
          
          {isDragOver && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="absolute inset-0 bg-nebula-teal/5 rounded-2xl border-2 border-nebula-teal"
            />
          )}
        </div>
        
        <div className="mt-6 text-center text-xs text-gray-500">
          <p>Supported formats: Photoshop (.psd), TIFF (.tiff, .tif)</p>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}