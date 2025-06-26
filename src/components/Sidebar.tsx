import { Files, Settings, Info } from 'lucide-react'

export function Sidebar() {
  return (
    <aside className="w-16 bg-black/30 backdrop-blur-sm border-r border-white/10 flex flex-col items-center py-4 space-y-4">
      <button className="w-10 h-10 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors neon-glow">
        <Files className="w-5 h-5" />
      </button>
      
      <button className="w-10 h-10 rounded-lg hover:bg-white/10 flex items-center justify-center transition-colors">
        <Info className="w-5 h-5" />
      </button>
      
      <div className="flex-1" />
      
      <button className="w-10 h-10 rounded-lg hover:bg-white/10 flex items-center justify-center transition-colors">
        <Settings className="w-5 h-5" />
      </button>
    </aside>
  )
}