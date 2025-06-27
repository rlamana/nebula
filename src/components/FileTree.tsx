import { useState, useEffect, useCallback } from 'react'
import { ChevronRight, Folder, FolderOpen, FileImage } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

interface FileNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileNode[]
  isExpanded?: boolean
}

interface FileTreeProps {
  onFileSelect: (filePath: string) => void
  rootPath?: string
  selectedFile?: string | null
}

export function FileTree({ onFileSelect, rootPath, selectedFile }: FileTreeProps) {
  const [fileTree, setFileTree] = useState<FileNode[]>([])
  const [loading, setLoading] = useState(true)

  const loadDirectoryContents = useCallback(async (dirPath: string): Promise<FileNode[]> => {
    if (!window.electronAPI?.readDirectory) {
      console.error('Electron API not available')
      return []
    }

    try {
      const entries = await window.electronAPI.readDirectory(dirPath)
      
      return entries
        .filter((entry: any) => {
          // Hide hidden files/folders that start with '.'
          if (entry.name.startsWith('.')) {
            return false
          }
          
          // Show directories and PSD/TIFF files
          const isDirectory = entry.type === 'directory'
          const isPsdTiff = entry.type === 'file' && /\.(psd|tiff?|TIFF?)$/i.test(entry.name)
          return isDirectory || isPsdTiff
        })
        .sort((a: any, b: any) => {
          // Directories first, then files
          if (a.type !== b.type) {
            return a.type === 'directory' ? -1 : 1
          }
          return a.name.localeCompare(b.name)
        })
        .map((entry: any) => ({
          name: entry.name,
          path: entry.path,
          type: entry.type,
          children: entry.type === 'directory' ? [] : undefined,
          isExpanded: false
        }))
    } catch (error) {
      console.error('Failed to read directory:', error)
      return []
    }
  }, [])

  const initializeFileTree = useCallback(async () => {
    setLoading(true)
    try {
      const initialPath = rootPath || await window.electronAPI?.getHomeDirectory?.()
      if (initialPath) {
        const contents = await loadDirectoryContents(initialPath)
        setFileTree(contents)
      }
    } catch (error) {
      console.error('Failed to initialize file tree:', error)
    } finally {
      setLoading(false)
    }
  }, [rootPath, loadDirectoryContents])

  useEffect(() => {
    initializeFileTree()
  }, [initializeFileTree])

  const toggleDirectory = useCallback(async (path: string) => {
    const updateNode = (nodes: FileNode[]): FileNode[] => {
      return nodes.map(node => {
        if (node.path === path && node.type === 'directory') {
          if (!node.isExpanded && (!node.children || node.children.length === 0)) {
            // Load children when expanding for the first time
            loadDirectoryContents(path).then(children => {
              setFileTree(currentTree => 
                updateNodeChildren(currentTree, path, children)
              )
            })
          }
          return { ...node, isExpanded: !node.isExpanded }
        }
        if (node.children) {
          return { ...node, children: updateNode(node.children) }
        }
        return node
      })
    }

    setFileTree(updateNode)
  }, [loadDirectoryContents])

  const updateNodeChildren = (nodes: FileNode[], targetPath: string, children: FileNode[]): FileNode[] => {
    return nodes.map(node => {
      if (node.path === targetPath) {
        return { ...node, children, isExpanded: true }
      }
      if (node.children) {
        return { ...node, children: updateNodeChildren(node.children, targetPath, children) }
      }
      return node
    })
  }

  const handleFileClick = useCallback((filePath: string) => {
    onFileSelect(filePath)
  }, [onFileSelect])

  const renderFileNode = (node: FileNode, depth: number = 0) => {
    const isDirectory = node.type === 'directory'
    const isExpanded = node.isExpanded || false
    const hasChildren = node.children && node.children.length > 0
    const isSelected = !isDirectory && selectedFile === node.path

    return (
      <div key={node.path} className="select-none">
        <motion.div
          whileHover={{ backgroundColor: 'rgba(255, 255, 255, 0.05)' }}
          className={`
            flex items-center py-1 px-2 cursor-pointer rounded transition-colors whitespace-nowrap
            ${isSelected 
              ? 'bg-nebula-teal/20 border border-nebula-teal/50' 
              : isDirectory 
                ? 'hover:bg-white/5' 
                : 'hover:bg-nebula-teal/10'
            }
          `}
          style={{ 
            paddingLeft: `${8 + depth * 16}px`
          }}
          onClick={() => {
            if (isDirectory) {
              toggleDirectory(node.path)
            } else {
              handleFileClick(node.path)
            }
          }}
        >
          {isDirectory && (
            <motion.div
              animate={{ rotate: isExpanded ? 90 : 0 }}
              transition={{ duration: 0.2 }}
              className="mr-1 flex-shrink-0"
            >
              <ChevronRight className="w-4 h-4 text-gray-400" />
            </motion.div>
          )}
          
          <div className="mr-2 flex-shrink-0">
            {isDirectory ? (
              isExpanded ? (
                <FolderOpen className="w-4 h-4 text-nebula-yellow" />
              ) : (
                <Folder className="w-4 h-4 text-nebula-yellow" />
              )
            ) : (
              <FileImage className="w-4 h-4 text-nebula-teal" />
            )}
          </div>
          
          <span 
            className="text-sm text-gray-200 whitespace-nowrap" 
            title={node.name}
          >
            {node.name}
          </span>
        </motion.div>

        <AnimatePresence>
          {isDirectory && isExpanded && hasChildren && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              {node.children?.map(child => renderFileNode(child, depth + 1))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="p-4 text-center">
        <div className="animate-spin w-6 h-6 border-2 border-nebula-teal border-t-transparent rounded-full mx-auto mb-2"></div>
        <p className="text-sm text-gray-400">Loading file tree...</p>
      </div>
    )
  }

  return (
    <div className="h-full w-full overflow-auto">
      <div className="p-2">
        <h3 className="text-sm font-semibold text-gray-300 mb-2 px-2 whitespace-nowrap">Files</h3>
        <div className="space-y-1">
          {fileTree.map(node => renderFileNode(node))}
        </div>
      </div>
    </div>
  )
}