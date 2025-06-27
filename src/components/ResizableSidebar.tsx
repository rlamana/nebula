import { useState, useRef, useCallback } from 'react'
import { Sidebar } from './Sidebar'

interface ResizableSidebarProps {
  onFileSelect: (filePath: string) => void
  selectedFile?: string | null
  minWidth?: number
  maxWidth?: number
  defaultWidth?: number
}

export function ResizableSidebar({ 
  onFileSelect, 
  selectedFile,
  minWidth = 240, 
  maxWidth = 600, 
  defaultWidth = 320 
}: ResizableSidebarProps) {
  const [width, setWidth] = useState(defaultWidth)
  const [isResizing, setIsResizing] = useState(false)
  const sidebarRef = useRef<HTMLDivElement>(null)

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
    
    const startX = e.clientX
    const startWidth = width

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - startX
      const newWidth = Math.max(minWidth, Math.min(maxWidth, startWidth + deltaX))
      setWidth(newWidth)
    }

    const handleMouseUp = () => {
      setIsResizing(false)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
  }, [width, minWidth, maxWidth])

  return (
    <div className="flex">
      <div 
        ref={sidebarRef}
        style={{ width: `${width}px` }}
        className="relative bg-black/30 backdrop-blur-sm border-r border-white/10 flex-shrink-0 overflow-hidden"
      >
        <div className="w-full h-full">
          <Sidebar onFileSelect={onFileSelect} selectedFile={selectedFile} />
        </div>
        
        {/* Resize handle */}
        <div
          className={`
            absolute top-0 right-0 w-1 h-full cursor-col-resize z-10
            hover:bg-nebula-teal/50 transition-colors
            ${isResizing ? 'bg-nebula-teal' : 'bg-transparent'}
          `}
          onMouseDown={handleMouseDown}
        >
          {/* Visual indicator */}
          <div className="absolute right-0 top-1/2 transform -translate-y-1/2 w-1 h-8 bg-white/20 rounded-l"></div>
        </div>
      </div>
    </div>
  )
}