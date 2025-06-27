import { useState, useEffect, useCallback } from 'react'
import { ChevronRight, Folder, FolderOpen, FileImage, Home, HardDrive, Usb } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

interface FileNode {
  name: string
  path: string
  type: 'file' | 'directory' | 'root' | 'volume'
  children?: FileNode[]
  isExpanded?: boolean
  icon?: 'home' | 'computer' | 'volume'
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

  const loadMountedVolumes = useCallback(async (): Promise<FileNode[]> => {
    console.log('loadMountedVolumes called')
    console.log('window.electronAPI:', !!window.electronAPI)
    console.log('Available API methods:', window.electronAPI ? Object.keys(window.electronAPI) : 'none')
    
    if (!window.electronAPI?.getMountedVolumes) {
      console.log('getMountedVolumes API not available')
      return []
    }
    
    try {
      console.log('Calling getMountedVolumes...')
      const volumes = await window.electronAPI.getMountedVolumes()
      console.log('Received volumes:', volumes)
      return volumes.map((volume: { name: string; path: string; type: string }) => ({
        name: volume.name,
        path: volume.path,
        type: 'volume' as const,
        icon: 'volume' as const,
        children: [],
        isExpanded: false
      }))
    } catch (error) {
      console.error('Failed to load mounted volumes:', error)
      return []
    }
  }, [])

  const initializeFileTree = useCallback(async () => {
    setLoading(true)
    try {
      console.log('Initializing file tree...')
      const homeDir = await window.electronAPI?.getHomeDirectory?.()
      console.log('Home directory:', homeDir)
      
      const volumes = await loadMountedVolumes()
      console.log('Initial volumes loaded:', volumes)
      
      // Debug: Show volume count
      if (volumes.length > 0) {
        console.log('VOLUMES DETECTED!', volumes)
      }
      
      // Create root structure with Home, Computer, and mounted volumes
      const rootStructure: FileNode[] = [
        {
          name: 'Home',
          path: homeDir || '/Users',
          type: 'root',
          icon: 'home',
          children: [],
          isExpanded: true // Start with Home expanded
        },
        {
          name: 'Computer',
          path: '/',
          type: 'root',
          icon: 'computer',
          children: [],
          isExpanded: false
        },
        ...volumes
      ]
      
      console.log('Root structure created:', rootStructure.map(n => ({ name: n.name, type: n.type, path: n.path })))
      
      // Load initial Home directory contents
      if (homeDir) {
        const homeContents = await loadDirectoryContents(homeDir)
        rootStructure[0].children = homeContents
      }
      
      setFileTree(rootStructure)
      console.log('File tree initialized with', rootStructure.length, 'root nodes')
    } catch (error) {
      console.error('Failed to initialize file tree:', error)
    } finally {
      setLoading(false)
    }
  }, [rootPath, loadDirectoryContents, loadMountedVolumes])

  useEffect(() => {
    initializeFileTree()
    
    // Start polling for volume changes every 5 seconds
    const interval = setInterval(async () => {
      try {
        console.log('Polling for volume changes...')
        const currentVolumes = await loadMountedVolumes()
        const currentVolumesPaths = new Set(currentVolumes.map(v => v.path))
        
        setFileTree(currentTree => {
          const existingVolumes = currentTree.filter(node => node.type === 'volume')
          const existingVolumesPaths = new Set(existingVolumes.map(v => v.path))
          
          // Check if volumes have changed
          const volumesChanged = currentVolumesPaths.size !== existingVolumesPaths.size ||
            [...currentVolumesPaths].some(path => !existingVolumesPaths.has(path)) ||
            [...existingVolumesPaths].some(path => !currentVolumesPaths.has(path))
          
          console.log('Volumes changed:', volumesChanged, 'Current:', currentVolumesPaths.size, 'Existing:', existingVolumesPaths.size)
          
          if (volumesChanged) {
            console.log('Updating file tree with new volumes:', currentVolumes)
            // Keep non-volume nodes and add current volumes
            const nonVolumeNodes = currentTree.filter(node => node.type !== 'volume')
            return [...nonVolumeNodes, ...currentVolumes]
          }
          
          return currentTree
        })
      } catch (error) {
        console.error('Error polling for volume changes:', error)
      }
    }, 5000)
    
    return () => {
      if (interval) {
        clearInterval(interval)
      }
    }
  }, [initializeFileTree, loadMountedVolumes])

  const toggleDirectory = useCallback(async (path: string) => {
    const updateNode = (nodes: FileNode[]): FileNode[] => {
      return nodes.map(node => {
        if (node.path === path && (node.type === 'directory' || node.type === 'root' || node.type === 'volume')) {
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

    // For root and volume nodes, immediately toggle and load if needed
    const targetNode = fileTree.find(node => node.path === path && (node.type === 'root' || node.type === 'volume'))
    if (targetNode && !targetNode.isExpanded && (!targetNode.children || targetNode.children.length === 0)) {
      // Load children for root/volume node when expanding
      const children = await loadDirectoryContents(path)
      setFileTree(currentTree => 
        updateNodeChildren(currentTree, path, children)
      )
      return
    }

    setFileTree(updateNode)
  }, [loadDirectoryContents, fileTree])

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
    const isDirectory = node.type === 'directory' || node.type === 'root' || node.type === 'volume'
    const isExpanded = node.isExpanded || false
    const hasChildren = node.children && node.children.length > 0
    const isSelected = node.type === 'file' && selectedFile === node.path
    const isRootNode = node.type === 'root' || node.type === 'volume'

    const getIcon = () => {
      if (node.type === 'root') {
        return node.icon === 'home' ? (
          <Home className="w-4 h-4 text-nebula-blue" />
        ) : (
          <HardDrive className="w-4 h-4 text-nebula-purple" />
        )
      }
      
      if (node.type === 'volume') {
        return <Usb className="w-4 h-4 text-nebula-magenta" />
      }
      
      if (node.type === 'directory') {
        return isExpanded ? (
          <FolderOpen className="w-4 h-4 text-nebula-yellow" />
        ) : (
          <Folder className="w-4 h-4 text-nebula-yellow" />
        )
      }
      
      return <FileImage className="w-4 h-4 text-nebula-teal" />
    }

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
            ${isRootNode ? 'font-medium' : ''}
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
            {getIcon()}
          </div>
          
          <span 
            className={`text-sm whitespace-nowrap ${isRootNode ? 'text-white' : 'text-gray-200'}`}
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