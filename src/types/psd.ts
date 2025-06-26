export interface LayerInfo {
  name?: string
  blendMode?: string
  opacity?: number
  visible?: boolean
  clipping?: boolean
  blendClippedElements?: boolean
  transparencyProtected?: boolean
  hidden?: boolean
  adjustment?: boolean
  textLayer?: boolean
  vectorLayer?: boolean
  shapeLayer?: boolean
  fillLayer?: boolean
  layerType?: string
  left?: number
  top?: number
  right?: number
  bottom?: number
  width?: number
  height?: number
  canvas?: HTMLCanvasElement
  imageData?: ImageData
  thumbnail?: string | null
  children?: LayerInfo[]
}

export interface ParsedPSD {
  name?: string
  width: number
  height: number
  channels?: number
  bitsPerChannel?: number
  colorMode?: number | string
  resolution?: number
  children?: LayerInfo[]
  canvas?: HTMLCanvasElement
  imageData?: ImageData
}