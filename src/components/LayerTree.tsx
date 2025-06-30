import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { 
  ChevronDown, 
  ChevronRight, 
  Eye, 
  EyeOff, 
  Image, 
  Type, 
  Layers, 
  Folder,
  Square
} from 'lucide-react'
import type { LayerInfo } from '../types/psd'

interface LayerTreeProps {
  layers: LayerInfo[]
  selectedLayer: string | null
  onSelectLayer: (layerId: string | null) => void
}

interface LayerItemProps {
  layer: LayerInfo
  depth: number
  selectedLayer: string | null
  onSelectLayer: (layerId: string | null) => void
}

function LayerItem({ layer, depth, selectedLayer, onSelectLayer }: LayerItemProps) {
  const [isExpanded, setIsExpanded] = useState(true)
  const hasChildren = layer.children && layer.children.length > 0
  const layerId = layer.name || 'unnamed'
  const isSelected = selectedLayer === layerId

  const getLayerIcon = () => {
    if (hasChildren) return <Folder className="w-4 h-4" />
    if (layer.textLayer) return <Type className="w-4 h-4" />
    if (layer.shapeLayer) return <Square className="w-4 h-4" />
    if (layer.adjustment) return <Layers className="w-4 h-4" />
    return <Image className="w-4 h-4" />
  }

  const getLayerType = () => {
    if (hasChildren) return 'Group'
    if (layer.textLayer) return 'Text'
    if (layer.shapeLayer) return 'Shape'
    if (layer.adjustment) return 'Adjustment'
    return 'Raster'
  }

  return (
    <div className="select-none">
      <motion.div
        initial={{ opacity: 0, x: -10 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.2, delay: depth * 0.05 }}
        className={`
          flex items-center py-3 px-3 rounded-lg cursor-pointer transition-all duration-200
          hover:bg-white/5 group
          ${isSelected ? 'bg-nebula-teal/20 border border-nebula-teal/30' : ''}
        `}
        style={{ marginLeft: `${depth * 16}px` }}
        onClick={() => onSelectLayer(isSelected ? null : layerId)}
      >
        {hasChildren && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              setIsExpanded(!isExpanded)
            }}
            className="mr-1 p-1 rounded hover:bg-white/10 transition-colors"
          >
            {isExpanded ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
          </button>
        )}
        
        {!hasChildren && <div className="w-5" />}
        
        <div className="flex items-center flex-1 min-w-0 space-x-3">
          {layer.thumbnail ? (
            <div className="flex-shrink-0 w-12 h-12 rounded overflow-hidden border border-white/20">
              <img 
                src={layer.thumbnail} 
                alt={`${layer.name} thumbnail`}
                className="w-full h-full object-cover"
              />
            </div>
          ) : (
            <div className={`
              flex-shrink-0 w-12 h-12 rounded border border-white/20 flex items-center justify-center
              ${layer.visible ? 'text-white bg-white/5' : 'text-gray-500 bg-gray-500/10'}
            `}>
              {getLayerIcon()}
            </div>
          )}
          
          <div className="flex-1 min-w-0">
            <p className={`
              text-sm font-medium truncate
              ${layer.visible ? 'text-white' : 'text-gray-500'}
            `}>
              {layer.name || 'Unnamed Layer'}
            </p>
            <p className="text-xs text-gray-400">
              {getLayerType()}
              {layer.opacity !== undefined && layer.opacity < 100 && (
                <span className="ml-1">• {Math.round(layer.opacity)}%</span>
              )}
            </p>
          </div>
          
          <div className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
            {layer.visible ? (
              <Eye className="w-4 h-4 text-gray-400" />
            ) : (
              <EyeOff className="w-4 h-4 text-gray-500" />
            )}
          </div>
        </div>
      </motion.div>

      <AnimatePresence>
        {hasChildren && isExpanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
          >
            {layer.children!.map((childLayer, index) => (
              <LayerItem
                key={`${childLayer.name}-${index}`}
                layer={childLayer}
                depth={depth + 1}
                selectedLayer={selectedLayer}
                onSelectLayer={onSelectLayer}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export function LayerTree({ layers, selectedLayer, onSelectLayer }: LayerTreeProps) {
  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="p-4 border-b border-white/10 flex-shrink-0">
        <h2 className="text-lg font-semibold text-white mb-1">Layers</h2>
        <p className="text-xs text-gray-400">{layers.length} layers</p>
      </div>
      
      <div className="flex-1 overflow-y-auto p-2 space-y-1 min-h-0">
        {layers.map((layer, index) => (
          <LayerItem
            key={`${layer.name}-${index}`}
            layer={layer}
            depth={0}
            selectedLayer={selectedLayer}
            onSelectLayer={onSelectLayer}
          />
        ))}
      </div>
    </div>
  )
}