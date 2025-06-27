import { app, BrowserWindow, ipcMain } from 'electron'
import { join, dirname } from 'node:path'
import { existsSync } from 'node:fs'
import { readFile as readFileAsync, readdir, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { readPsd, initializeCanvas } from 'ag-psd'
import { createCanvas } from 'canvas'
import UTIF from 'utif'
import { homedir } from 'node:os'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const isDev = process.env.IS_DEV === 'true'

// Initialize canvas for ag-psd
initializeCanvas(createCanvas as any)
console.log('Canvas initialized for ag-psd')

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  // Prevent multiple main windows
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.focus()
    return
  }
  const preloadPath = isDev ? join(process.cwd(), 'electron/preload.js') : join(__dirname, 'preload.js')
  console.log('Loading preload script from:', preloadPath)
  console.log('Preload file exists:', existsSync(preloadPath))
  
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'default',
    title: 'Nebula - PSD & TIFF Inspector',
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false, // Allow file:// protocol access
    },
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    // mainWindow.webContents.openDevTools() // Uncomment if you need dev tools
  } else {
    mainWindow.loadFile(join(__dirname, '../dist/index.html'))
  }
}

// Ensure single instance
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.whenReady().then(() => {
    console.log('Electron app ready, creating window...')
    createWindow()

    app.on('activate', function () {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

// Prevent creating additional windows
app.on('second-instance', () => {
  // Someone tried to run a second instance, focus our window instead
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

console.log('Setting up IPC handlers...')

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Helper function to determine file type
const getFileType = (filePath: string): 'psd' | 'tiff' => {
  const ext = filePath.toLowerCase().split('.').pop()
  return (ext === 'tiff' || ext === 'tif') ? 'tiff' : 'psd'
}

// Helper function to parse TIFF files
const parseTiff = (buffer: Buffer) => {
  const ifds = UTIF.decode(buffer)
  
  if (!ifds || ifds.length === 0) {
    throw new Error('No image data found in TIFF file')
  }
  
  console.log(`Found ${ifds.length} layers/pages in TIFF file`)
  
  // Get overall dimensions from the first IFD
  const firstIfd = ifds[0]
  const overallWidth = firstIfd.width
  const overallHeight = firstIfd.height
  
  // Process each IFD as a separate layer
  const children = ifds.map((ifd: any, index: number) => {
    try {
      // Decode each image
      UTIF.decodeImage(buffer, ifd)
      
      const width = ifd.width
      const height = ifd.height
      
      // Create canvas from TIFF data
      const canvas = createCanvas(width, height)
      const ctx = canvas.getContext('2d')
      const imageData = ctx.createImageData(width, height)
      
      // Convert TIFF data to ImageData
      const rgba = new Uint8Array(ifd.data)
      imageData.data.set(rgba)
      ctx.putImageData(imageData, 0, 0)
      
      // Get layer metadata
      const layerName = ifd.t270 ? // ImageDescription tag
        (typeof ifd.t270 === 'string' ? ifd.t270 : `Layer ${index + 1}`) :
        `Layer ${index + 1}`
      
      const photometric = ifd.t262 || 2 // PhotometricInterpretation, default to RGB
      const bitsPerSample = ifd.t258?.[0] || 8
      const samplesPerPixel = ifd.t277 || (rgba.length / (width * height / 4)) // estimate from data
      
      return {
        name: layerName,
        visible: true,
        opacity: 100,
        left: 0,
        top: 0,
        right: width,
        bottom: height,
        width,
        height,
        canvas,
        imageData: {
          width,
          height,
          data: rgba
        },
        layerType: 'raster',
        // Additional TIFF-specific metadata
        bitsPerSample,
        samplesPerPixel,
        photometric,
        compression: ifd.t259 || 1 // Compression type
      }
    } catch (error) {
      console.error(`Error processing TIFF layer ${index + 1}:`, (error as Error).message)
      // Return a placeholder layer if processing fails
      return {
        name: `Layer ${index + 1} (Error)`,
        visible: false,
        opacity: 100,
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
        width: 0,
        height: 0,
        layerType: 'raster',
        error: (error as Error).message
      }
    }
  }).filter((layer: any) => layer.width > 0 && layer.height > 0) // Filter out error layers
  
  return {
    width: overallWidth,
    height: overallHeight,
    channels: firstIfd.t277 || 3, // SamplesPerPixel
    bitsPerChannel: firstIfd.t258?.[0] || 8,
    colorMode: getColorMode(firstIfd.t262 || 2), // PhotometricInterpretation
    children
  }
}

// Helper function to get color mode name from TIFF photometric interpretation
const getColorMode = (photometric: number): string => {
  switch (photometric) {
    case 0: return 'WhiteIsZero'
    case 1: return 'BlackIsZero'
    case 2: return 'RGB'
    case 3: return 'Palette'
    case 4: return 'Transparency'
    case 5: return 'CMYK'
    case 6: return 'YCbCr'
    case 8: return 'CIELab'
    case 9: return 'ICCLab'
    case 10: return 'ITULab'
    default: return 'Unknown'
  }
}

// File system API handlers
ipcMain.handle('read-directory', async (_event, dirPath: string) => {
  console.log('Reading directory:', dirPath)
  try {
    const entries = await readdir(dirPath, { withFileTypes: true })
    const result = []
    
    for (const entry of entries) {
      try {
        const fullPath = join(dirPath, entry.name)
        const stats = await stat(fullPath)
        
        result.push({
          name: entry.name,
          path: fullPath,
          type: entry.isDirectory() ? 'directory' : 'file',
          size: stats.size,
          modified: stats.mtime
        })
      } catch (statError) {
        // Skip files that can't be stat'd (like broken symlinks, permission issues, etc.)
        console.warn(`Skipping file ${entry.name}: ${(statError as Error).message}`)
        continue
      }
    }
    
    return result
  } catch (error) {
    console.error('Error reading directory:', error)
    throw error
  }
})

ipcMain.handle('get-home-directory', async () => {
  return homedir()
})

ipcMain.handle('parse-psd', async (_event, filePath: string) => {
  console.log('Received parse-psd request for:', filePath)
  try {
    const buffer = await readFileAsync(filePath)
    console.log('File read successfully, size:', buffer.length)
    
    const fileType = getFileType(filePath)
    let parsedData
    
    if (fileType === 'tiff') {
      console.log('Parsing TIFF file...')
      parsedData = parseTiff(buffer)
      console.log('TIFF parsed successfully')
    } else {
      console.log('Parsing PSD file...')
      // Parse PSD with canvas support, including layer image data for thumbnails
      parsedData = readPsd(buffer, { 
        skipLayerImageData: false, // Include image data for thumbnails
        skipCompositeImageData: true,
        skipThumbnail: true,
        useImageData: true // Generate image data for thumbnails
      })
      console.log('PSD parsed successfully, layers found:', parsedData.children?.length || 0)
    }
    
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
      ...parsedData,
      children: parsedData.children ? parsedData.children.map(enhanceLayerInfo) : []
    }
    
    return result
  } catch (error) {
    console.error('Error parsing file:', error)
    throw error
  }
})