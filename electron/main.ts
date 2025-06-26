import { app, BrowserWindow, ipcMain } from 'electron'
import { join, dirname } from 'node:path'
import { readFile, existsSync } from 'node:fs'
import { readFile as readFileAsync } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { readPsd, initializeCanvas } from 'ag-psd'
import { createCanvas } from 'canvas'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const isDev = process.env.IS_DEV === 'true'

// Initialize canvas for ag-psd
initializeCanvas(createCanvas)
console.log('Canvas initialized for ag-psd')

function createWindow(): void {
  const preloadPath = isDev ? join(process.cwd(), 'electron/preload.js') : join(__dirname, 'preload.js')
  console.log('Loading preload script from:', preloadPath)
  console.log('Preload file exists:', existsSync(preloadPath))
  
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false, // Allow file:// protocol access
    },
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(() => {
  console.log('Electron app ready, creating window...')
  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

console.log('Setting up IPC handlers...')

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

ipcMain.handle('parse-psd', async (event, filePath: string) => {
  console.log('Received parse-psd request for:', filePath)
  try {
    const buffer = await readFileAsync(filePath)
    console.log('File read successfully, size:', buffer.length)
    
    // Parse PSD with canvas support, including layer image data for thumbnails
    const psd = readPsd(buffer, { 
      skipLayerImageData: false, // Include image data for thumbnails
      skipCompositeImageData: true,
      skipThumbnail: true,
      useImageData: true // Generate image data for thumbnails
    })
    console.log('PSD parsed successfully, layers found:', psd.children?.length || 0)
    
    // Generate thumbnail from layer canvas/imageData
    const generateThumbnail = (layer: any): string | null => {
      if (!layer.canvas && !layer.imageData) return null
      
      try {
        const canvas = layer.canvas || createCanvas(layer.imageData.width, layer.imageData.height)
        if (layer.imageData && !layer.canvas) {
          const ctx = canvas.getContext('2d')
          const imageData = ctx.createImageData(layer.imageData.width, layer.imageData.height)
          imageData.data.set(layer.imageData.data)
          ctx.putImageData(imageData, 0, 0)
        }
        
        // Create thumbnail canvas (max 48x48)
        const maxSize = 48
        const aspectRatio = canvas.width / canvas.height
        let thumbWidth = maxSize
        let thumbHeight = maxSize
        
        if (aspectRatio > 1) {
          thumbHeight = maxSize / aspectRatio
        } else {
          thumbWidth = maxSize * aspectRatio
        }
        
        const thumbCanvas = createCanvas(thumbWidth, thumbHeight)
        const thumbCtx = thumbCanvas.getContext('2d')
        thumbCtx.drawImage(canvas, 0, 0, thumbWidth, thumbHeight)
        
        return thumbCanvas.toDataURL('image/png')
      } catch (error) {
        console.error('Error generating thumbnail for layer:', layer.name, error)
        return null
      }
    }

    // Enhance layer information
    const enhanceLayerInfo = (layer: any): any => {
      return {
        ...layer,
        layerType: getLayerType(layer),
        dimensions: layer.left !== undefined && layer.top !== undefined && 
                   layer.right !== undefined && layer.bottom !== undefined ? {
          left: layer.left,
          top: layer.top,
          right: layer.right,
          bottom: layer.bottom,
          width: layer.right - layer.left,
          height: layer.bottom - layer.top
        } : null,
        thumbnail: generateThumbnail(layer),
        children: layer.children ? layer.children.map(enhanceLayerInfo) : undefined
      }
    }
    
    const getLayerType = (layer: any): string => {
      if (layer.children && layer.children.length > 0) return 'group'
      if (layer.text) return 'text'
      if (layer.vectorMask || layer.stroke || layer.fill) return 'shape'
      if (layer.adjustment) return 'adjustment'
      return 'raster'
    }
    
    const result = {
      ...psd,
      children: psd.children ? psd.children.map(enhanceLayerInfo) : []
    }
    
    return result
  } catch (error) {
    console.error('Error parsing PSD:', error)
    throw error
  }
})