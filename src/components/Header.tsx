import { Sparkles } from 'lucide-react'

export function Header() {
  return (
    <header className="h-16 bg-black/40 backdrop-blur-md border-b border-white/10 flex items-center px-6">
      <div className="flex items-center space-x-3">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-nebula-teal to-nebula-magenta flex items-center justify-center">
          <Sparkles className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold gradient-text">Nebula</h1>
          <p className="text-xs text-gray-400">PSD Structure Inspector</p>
        </div>
      </div>
    </header>
  )
}