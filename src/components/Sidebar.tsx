import { FileTree } from './FileTree'

interface SidebarProps {
  onFileSelect: (filePath: string) => void
  selectedFile?: string | null
}

export function Sidebar({ onFileSelect, selectedFile }: SidebarProps) {
  return (
    <aside className="w-full h-full overflow-hidden">
      <FileTree onFileSelect={onFileSelect} selectedFile={selectedFile} />
    </aside>
  )
}