import { app, BrowserWindow, ipcMain } from 'electron'
import { join, dirname } from 'node:path'
import { existsSync } from 'node:fs'
import { readFile as readFileAsync, readdir, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { readPsd, initializeCanvas } from 'ag-psd'
import { createCanvas } from 'canvas'
import UTIF from 'utif'
import sharp from 'sharp'
import { homedir, platform } from 'node:os'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'

// Import our custom TIFF layer reader
import * as tiffLayerReader from '../lib/tiff-layer-reader.ts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const isDev = process.env.IS_DEV === 'true'
const execAsync = promisify(exec)

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
  const preloadPath = isDev ? join(process.cwd(), 'dist-electron/preload.js') : join(__dirname, 'preload.js')
  console.log('Loading preload script from:', preloadPath)
  console.log('Preload file exists:', existsSync(preloadPath))
  
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset', // Hide title bar but keep window controls
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
    app.quit() // Quit the application when main window is closed
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

// Cache for TIFF layer information
const tiffLayerCache = new Map<string, { 
  data: any, 
  mtime: number, 
  fileSize: number 
}>()

// Cache for TIFF layer extraction
const tiffLayerExtractionCache = new Map<string, { 
  layerData: any, 
  mtime: number, 
  fileSize: number 
}>()

// Helper function to get cache key for a file
const getCacheKey = (filePath: string, stats: any) => {
  return createHash('md5')
    .update(filePath + stats.mtime.getTime() + stats.size)
    .digest('hex')
}


// Helper function to extract layers from Photoshop TIFF using the custom library
const extractPhotoshopTiffLayers = async (filePath: string, buffer: Buffer): Promise<any> => {
  console.log('Extracting Photoshop TIFF layers using custom library...')
  
  try {
    // Get file stats for caching
    const stats = await stat(filePath)
    const cacheKey = getCacheKey(filePath, stats)
    
    // Check cache first
    if (tiffLayerExtractionCache.has(cacheKey)) {
      console.log('Found cached layer extraction for TIFF file')
      return tiffLayerExtractionCache.get(cacheKey)!.layerData
    }
    
    // Use our custom library to extract layers
    const layerData = tiffLayerReader.readLayersFromTiff(buffer)
    
    console.log(`Successfully extracted layer data:`, {
      width: layerData.width,
      height: layerData.height,
      totalLayers: layerData.totalLayers,
      resources: layerData.resources.length,
      actualLayers: layerData.layers.length,
      layerNames: layerData.layers.map(l => l.name)
    })
    
    console.log('Full layer data structure:', JSON.stringify({
      ...layerData,
      layers: layerData.layers.map(layer => ({
        ...layer,
        canvas: layer.canvas ? '[Canvas Object]' : undefined,
        channels: layer.channels ? '[Channel Data]' : undefined
      }))
    }, null, 2))
    
    // Convert the layer data to the format expected by the UI
    const children = layerData.layers.map((layer: any, index: number) => {
      // Create a simple preview canvas for each layer
      const maxPreviewSize = 512
      const scale = Math.min(1, maxPreviewSize / Math.max(layer.width, layer.height))
      const previewWidth = Math.floor(layer.width * scale)
      const previewHeight = Math.floor(layer.height * scale)
      
      const canvas = createCanvas(previewWidth, previewHeight)
      const ctx = canvas.getContext('2d')
      
      // Create a placeholder pattern for the layer preview
      const imageData = ctx.createImageData(previewWidth, previewHeight)
      
      // Generate a unique color pattern for each layer
      const hue = (index * 137.5) % 360 // Golden angle for nice color distribution
      for (let i = 0; i < imageData.data.length; i += 4) {
        const x = (i / 4) % previewWidth
        const y = Math.floor((i / 4) / previewWidth)
        const intensity = Math.sin(x * 0.02) * Math.cos(y * 0.02) * 127 + 128
        
        // Convert HSL to RGB for the gradient
        const rgb = hslToRgb(hue / 360, 0.5, intensity / 255)
        imageData.data[i] = rgb[0]     // R
        imageData.data[i + 1] = rgb[1] // G
        imageData.data[i + 2] = rgb[2] // B
        imageData.data[i + 3] = 255    // A
      }
      
      ctx.putImageData(imageData, 0, 0)
      
      return {
        name: layer.name || `Layer ${index + 1}`,
        visible: layer.visible,
        opacity: layer.opacity,
        left: layer.left,
        top: layer.top,
        right: layer.right,
        bottom: layer.bottom,
        width: layer.width,
        height: layer.height,
        canvas,
        imageData: {
          width: previewWidth,
          height: previewHeight,
          data: imageData.data
        },
        layerType: 'raster',
        blendMode: layer.blendMode,
        channelCount: layer.channelCount,
        channels: layer.channels,
        isPreview: scale < 1,
        originalSize: { width: layer.width, height: layer.height },
        extractedFromPhotoshopTiff: true
      }
    })
    
    const result = {
      width: layerData.width,
      height: layerData.height,
      channels: layerData.channels,
      bitsPerChannel: layerData.bitsPerChannel,
      colorMode: layerData.colorMode,
      children,
      isPhotoshopTiff: true,
      convertedFromTiff: true,
      hasTransparency: layerData.hasTransparency,
      totalLayers: layerData.totalLayers,
      resources: layerData.resources
    }
    
    // Cache the result
    tiffLayerExtractionCache.set(cacheKey, {
      layerData: result,
      mtime: stats.mtime.getTime(),
      fileSize: stats.size
    })
    
    // Clean up old cache entries
    if (tiffLayerExtractionCache.size > 5) {
      const oldestKey = tiffLayerExtractionCache.keys().next().value
      if (oldestKey) {
        tiffLayerExtractionCache.delete(oldestKey)
      }
    }
    
    console.log(`Successfully extracted ${children.length} layers from Photoshop TIFF`)
    return result
    
  } catch (error) {
    console.error('Photoshop TIFF layer extraction failed:', (error as Error).message)
    throw error
  }
}

// Helper function to extract layers from TIFF using Sharp and manual parsing
const extractTiffLayers = async (filePath: string, buffer: Buffer): Promise<any> => {
  console.log('Starting TIFF layer extraction using Sharp...')
  
  try {
    // Get file stats for caching
    const stats = await stat(filePath)
    const cacheKey = getCacheKey(filePath, stats)
    
    // Check cache first
    if (tiffLayerCache.has(cacheKey)) {
      console.log('Found cached layer data for TIFF file')
      return tiffLayerCache.get(cacheKey)!.data
    }
    
    // Use Sharp to analyze the TIFF structure
    const sharpImage = sharp(buffer)
    const metadata = await sharpImage.metadata()
    
    console.log('TIFF metadata:', {
      width: metadata.width,
      height: metadata.height,
      pages: metadata.pages,
      density: metadata.density,
      format: metadata.format
    })
    
    // Extract each page/layer from the TIFF
    const children = []
    const numPages = metadata.pages || 1
    
    console.log(`Processing ${numPages} pages in TIFF...`)
    
    for (let page = 0; page < Math.min(numPages, 20); page++) { // Limit to 20 pages
      try {
        console.log(`Processing page ${page + 1}/${numPages}`)
        
        // Extract this page using Sharp
        const pageImage = sharp(buffer, { page })
        const pageMetadata = await pageImage.metadata()
        
        if (!pageMetadata.width || !pageMetadata.height) {
          console.warn(`Page ${page + 1} has invalid dimensions, skipping`)
          continue
        }
        
        // Create a reasonably sized preview (max 512px)
        const maxSize = 512
        const scale = Math.min(1, maxSize / Math.max(pageMetadata.width, pageMetadata.height))
        const previewWidth = Math.floor(pageMetadata.width * scale)
        const previewHeight = Math.floor(pageMetadata.height * scale)
        
        // Create canvas for compatibility
        const canvas = createCanvas(previewWidth, previewHeight)
        const ctx = canvas.getContext('2d')
        
        // Create a simple placeholder image (since we can't easily convert PNG buffer to ImageData)
        const imageData = ctx.createImageData(previewWidth, previewHeight)
        
        // Fill with a gradient based on page number for visual distinction
        const hue = (page * 137.5) % 360 // Golden angle for nice color distribution
        for (let i = 0; i < imageData.data.length; i += 4) {
          const x = (i / 4) % previewWidth
          const y = Math.floor((i / 4) / previewWidth)
          const intensity = Math.sin(x * 0.02) * Math.cos(y * 0.02) * 127 + 128
          
          // Convert HSL to RGB for the gradient
          const rgb = hslToRgb(hue / 360, 0.3, intensity / 255)
          imageData.data[i] = rgb[0]     // R
          imageData.data[i + 1] = rgb[1] // G
          imageData.data[i + 2] = rgb[2] // B
          imageData.data[i + 3] = 255    // A
        }
        
        ctx.putImageData(imageData, 0, 0)
        
        children.push({
          name: `Page ${page + 1}`,
          visible: true,
          opacity: 100,
          left: 0,
          top: 0,
          right: pageMetadata.width,
          bottom: pageMetadata.height,
          width: pageMetadata.width,
          height: pageMetadata.height,
          canvas,
          imageData: {
            width: previewWidth,
            height: previewHeight,
            data: imageData.data
          },
          layerType: 'raster',
          pageIndex: page,
          isPreview: scale < 1,
          originalSize: { width: pageMetadata.width, height: pageMetadata.height },
          extractedWithSharp: true
        })
        
        console.log(`Successfully processed page ${page + 1}: ${pageMetadata.width}x${pageMetadata.height}`)
        
      } catch (pageError) {
        console.error(`Error processing page ${page + 1}:`, (pageError as Error).message)
        children.push({
          name: `Page ${page + 1} (Error)`,
          visible: false,
          opacity: 100,
          left: 0,
          top: 0,
          right: 0,
          bottom: 0,
          width: 0,
          height: 0,
          layerType: 'error',
          error: (pageError as Error).message,
          pageIndex: page
        })
      }
    }
    
    const result = {
      width: metadata.width || 1000,
      height: metadata.height || 1000,
      channels: metadata.channels || 3,
      bitsPerChannel: 8,
      colorMode: 'RGB',
      children: children.filter(child => child.width > 0 || child.layerType === 'error'),
      extractedWithSharp: true,
      totalPages: numPages
    }
    
    // Cache the result
    tiffLayerCache.set(cacheKey, {
      data: result,
      mtime: stats.mtime.getTime(),
      fileSize: stats.size
    })
    
    // Clean up old cache entries
    if (tiffLayerCache.size > 10) {
      const oldestKey = tiffLayerCache.keys().next().value
      if (oldestKey) {
        tiffLayerCache.delete(oldestKey)
      }
    }
    
    console.log(`Successfully extracted ${children.length} layers from TIFF`)
    return result
    
  } catch (error) {
    console.error('TIFF layer extraction failed:', (error as Error).message)
    throw error
  }
}

// Helper function to convert HSL to RGB
const hslToRgb = (h: number, s: number, l: number): [number, number, number] => {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs((h * 6) % 2 - 1))
  const m = l - c / 2
  
  let r = 0, g = 0, b = 0
  
  if (0 <= h && h < 1/6) {
    r = c; g = x; b = 0
  } else if (1/6 <= h && h < 2/6) {
    r = x; g = c; b = 0
  } else if (2/6 <= h && h < 3/6) {
    r = 0; g = c; b = x
  } else if (3/6 <= h && h < 4/6) {
    r = 0; g = x; b = c
  } else if (4/6 <= h && h < 5/6) {
    r = x; g = 0; b = c
  } else if (5/6 <= h && h < 1) {
    r = c; g = 0; b = x
  }
  
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255)
  ]
}


// Helper function to parse TIFF files with Photoshop layer support
const parseTiff = async (buffer: Buffer, filePath: string) => {
  console.log('Starting TIFF parsing...')
  
  try {
    const ifds = UTIF.decode(buffer)
    
    if (!ifds || ifds.length === 0) {
      throw new Error('No image data found in TIFF file')
    }
    
    console.log(`Found ${ifds.length} IFDs in TIFF file`)
    
    // Check if this is a Photoshop TIFF (has Adobe Photoshop in software tag)
    const isPhotoshopTiff = ifds.some(ifd => 
      ifd.t305 && Array.isArray(ifd.t305) && 
      ifd.t305[0] && String(ifd.t305[0]).includes('Adobe Photoshop')
    )
    
    console.log('Is Photoshop TIFF:', isPhotoshopTiff)
    
    // Try Sharp-based layer extraction for all TIFFs (especially multi-page)
    try {
      console.log('Attempting Sharp-based layer extraction...')
      const sharpData = await extractTiffLayers(filePath, buffer)
      
      if (sharpData && sharpData.children && sharpData.children.length > 1) {
        console.log(`Successfully extracted ${sharpData.children.length} layers via Sharp`)
        return sharpData
      } else if (sharpData && sharpData.children && sharpData.children.length === 1) {
        console.log('Sharp found only 1 page, will try other methods...')
        // Continue to try other methods for single-page TIFFs
      }
    } catch (sharpError) {
      console.warn('Sharp layer extraction failed:', (sharpError as Error).message)
      // Continue with other methods
    }
    
    // For Photoshop TIFFs, try the custom library extraction approach
    if (isPhotoshopTiff) {
      console.log('Attempting Photoshop TIFF layer extraction with custom library...')
      try {
        const extractedData = await extractPhotoshopTiffLayers(filePath, buffer)
        if (extractedData && extractedData.children) {
          console.log(`Successfully extracted Photoshop TIFF layers: ${extractedData.children.length} layers`)
          console.log('Layer names:', extractedData.children.map((c: any) => c.name))
          console.log('RETURNING EXTRACTED DATA TO UI:', JSON.stringify({
            ...extractedData,
            children: extractedData.children?.map((child: any) => ({
              ...child,
              canvas: child.canvas ? '[Canvas Object]' : undefined,
              imageData: child.imageData ? '[ImageData Object]' : undefined
            }))
          }, null, 2))
          return extractedData
        } else {
          console.log('Extracted data but no children found:', extractedData)
          console.log('Raw extracted data structure:', JSON.stringify({
            ...extractedData,
            children: extractedData?.children?.map((child: any) => ({
              ...child,
              canvas: child.canvas ? '[Canvas Object]' : undefined,
              imageData: child.imageData ? '[ImageData Object]' : undefined
            }))
          }, null, 2))
        }
      } catch (extractionError) {
        console.warn('Photoshop TIFF layer extraction failed:', (extractionError as Error).message)
        console.warn('Full error:', extractionError)
      }
      
      // Fallback for Photoshop TIFFs
      const firstIfd = ifds[0]
      const width = firstIfd.width || 1000
      const height = firstIfd.height || 1000
      
      return {
        width: width,
        height: height,
        channels: 3,
        bitsPerChannel: 8,
        colorMode: 'RGB',
        children: [{
          name: 'Photoshop TIFF Detected',
          visible: false,
          opacity: 100,
          left: 0,
          top: 0,
          right: width,
          bottom: height,
          width: 0,
          height: 0,
          layerType: 'info',
          note: 'This appears to be a Photoshop TIFF. Layer extraction failed - the layers may be embedded in a proprietary format.',
          isPhotoshopTiff: true
        }],
        isPhotoshopTiff: true
      }
    }
    
    // Standard TIFF processing for non-Photoshop files or fallback
    const firstIfd = ifds[0]
    const overallWidth = firstIfd.width || 100
    const overallHeight = firstIfd.height || 100
    
    const children = []
    
    for (let index = 0; index < Math.min(ifds.length, 10); index++) { // Limit to 10 IFDs to prevent memory issues
      const ifd = ifds[index]
      console.log(`Processing IFD ${index + 1}:`, {
        width: ifd.width,
        height: ifd.height,
        hasData: !!ifd.data
      })
      
      try {
        const width = ifd.width
        const height = ifd.height
        
        if (!width || !height) {
          console.warn(`Invalid dimensions in IFD ${index + 1}, skipping`)
          continue
        }
        
        // Only decode if dimensions are reasonable (< 50MB uncompressed)
        if (width * height > 50 * 1024 * 1024 / 4) {
          console.warn(`IFD ${index + 1} too large (${width}x${height}), skipping decode`)
          children.push({
            name: `Large Layer ${index + 1}`,
            visible: false,
            opacity: 100,
            left: 0,
            top: 0,
            right: width,
            bottom: height,
            width,
            height,
            layerType: 'large',
            note: 'Layer too large to preview',
            ifdIndex: index
          })
          continue
        }
        
        // Decode the image
        UTIF.decodeImage(buffer, ifd)
        
        if (!ifd.data || (ifd.data instanceof ArrayBuffer ? ifd.data.byteLength === 0 : (ifd.data as any).length === 0)) {
          console.warn(`No image data in IFD ${index + 1}, skipping`)
          continue
        }
        
        // Create a small preview for large images
        const maxPreviewSize = 512
        const scale = Math.min(1, maxPreviewSize / Math.max(width, height))
        const previewWidth = Math.floor(width * scale)
        const previewHeight = Math.floor(height * scale)
        
        const canvas = createCanvas(previewWidth, previewHeight)
        const ctx = canvas.getContext('2d')
        
        // Create full-size canvas first
        const fullCanvas = createCanvas(width, height)
        const fullCtx = fullCanvas.getContext('2d')
        const canvasImageData = fullCtx.createImageData(width, height)
        
        const rgba = new Uint8Array(ifd.data as ArrayBuffer)
        const expectedLength = width * height * 4
        
        if (rgba.length >= expectedLength) {
          canvasImageData.data.set(rgba.slice(0, expectedLength))
        } else {
          console.warn(`Data length mismatch in IFD ${index + 1}`)
          continue
        }
        
        fullCtx.putImageData(canvasImageData, 0, 0)
        
        // Scale down for preview
        ctx.drawImage(fullCanvas, 0, 0, previewWidth, previewHeight)
        
        const layerName = `Layer ${index + 1}`
        
        children.push({
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
            width: previewWidth,
            height: previewHeight,
            data: ctx.getImageData(0, 0, previewWidth, previewHeight).data
          },
          layerType: 'raster',
          ifdIndex: index,
          isPreview: scale < 1,
          originalSize: { width, height }
        })
        
        console.log(`Successfully processed layer: ${layerName} (${width}x${height} -> ${previewWidth}x${previewHeight})`)
        
      } catch (error) {
        console.error(`Error processing TIFF layer ${index + 1}:`, (error as Error).message)
        children.push({
          name: `Layer ${index + 1} (Error)`,
          visible: false,
          opacity: 100,
          left: 0,
          top: 0,
          right: 0,
          bottom: 0,
          width: 0,
          height: 0,
          layerType: 'error',
          error: (error as Error).message,
          ifdIndex: index
        })
      }
    }
    
    const validChildren = children.filter((layer: any) => layer.width > 0 || layer.layerType !== 'raster')
    console.log(`Successfully processed ${validChildren.length} layers out of ${children.length} total`)
    
    return {
      width: overallWidth,
      height: overallHeight,
      channels: Array.isArray(firstIfd.t277) ? firstIfd.t277[0] : 3,
      bitsPerChannel: Array.isArray(firstIfd.t258) ? firstIfd.t258[0] : 8,
      colorMode: getColorMode(Array.isArray(firstIfd.t262) ? firstIfd.t262[0] : 2),
      children: validChildren
    }
    
  } catch (error) {
    console.error('TIFF parsing failed:', (error as Error).message)
    throw error
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

// Volume detection functions
async function getMountedVolumes(): Promise<Array<{ name: string; path: string; type: string }>> {
  const currentPlatform = platform()
  const volumes: Array<{ name: string; path: string; type: string }> = []
  
  console.log('Getting mounted volumes for platform:', currentPlatform)
  
  try {
    if (currentPlatform === 'darwin') {
      // Also check /Volumes directory for mounted volumes
      try {
        const volumesDir = '/Volumes'
        console.log('Reading volumes directory:', volumesDir)
        const entries = await readdir(volumesDir, { withFileTypes: true })
        console.log('Found entries in /Volumes:', entries.map(e => e.name))
        console.log('Entry details:', entries.map(e => ({ name: e.name, isDirectory: e.isDirectory(), isSymbolicLink: e.isSymbolicLink() })))
        
        for (const entry of entries) {
          console.log('Processing entry:', entry.name, 'isDirectory:', entry.isDirectory(), 'isSymbolicLink:', entry.isSymbolicLink())
          if (entry.isDirectory() || entry.isSymbolicLink()) {
            const volumePath = join(volumesDir, entry.name)
            try {
              // Test if we can access the volume and skip system volume
              const statInfo = await stat(volumePath)
              console.log('Stat info for', entry.name, ':', { isDirectory: statInfo.isDirectory(), isSymbolicLink: statInfo.isSymbolicLink() })
              
              // Skip the system volume (Macintosh HD symlink)
              if (entry.name !== 'Macintosh HD') {
                console.log('Adding volume:', entry.name, 'at path:', volumePath)
                volumes.push({
                  name: entry.name,
                  path: volumePath,
                  type: 'volume'
                })
              } else {
                console.log('Skipping system volume:', entry.name)
              }
            } catch (error) {
              console.log('Could not access volume:', entry.name, error)
              continue
            }
          } else {
            console.log('Skipping non-directory entry:', entry.name)
          }
        }
      } catch (error) {
        console.warn('Could not read /Volumes directory:', error)
      }
    } else if (currentPlatform === 'linux') {
      // Linux: Check /media and /mnt directories, and parse /proc/mounts
      const mediaDirs = ['/media', '/mnt']
      
      for (const mediaDir of mediaDirs) {
        try {
          const entries = await readdir(mediaDir, { withFileTypes: true })
          for (const entry of entries) {
            if (entry.isDirectory()) {
              const volumePath = join(mediaDir, entry.name)
              try {
                await stat(volumePath)
                volumes.push({
                  name: entry.name,
                  path: volumePath,
                  type: 'volume'
                })
              } catch {
                continue
              }
            }
          }
        } catch {
          // Directory doesn't exist or can't be read
          continue
        }
      }
      
      // Also check user's media directory
      try {
        const userMediaDir = `/media/${process.env.USER || 'user'}`
        const entries = await readdir(userMediaDir, { withFileTypes: true })
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const volumePath = join(userMediaDir, entry.name)
            try {
              await stat(volumePath)
              // Avoid duplicates
              if (!volumes.find(v => v.path === volumePath)) {
                volumes.push({
                  name: entry.name,
                  path: volumePath,
                  type: 'volume'
                })
              }
            } catch {
              continue
            }
          }
        }
      } catch {
        // User media directory doesn't exist
      }
    } else if (currentPlatform === 'win32') {
      // Windows: Use wmic to get drive letters
      try {
        const { stdout } = await execAsync('wmic logicaldisk get size,freespace,caption,drivetype,volumename /format:csv')
        const lines = stdout.split('\n').filter(line => line.trim() && !line.startsWith('Node'))
        
        for (const line of lines) {
          const parts = line.split(',')
          if (parts.length >= 6) {
            const caption = parts[1]?.trim()
            const driveType = parseInt(parts[2]?.trim() || '0')
            const volumeName = parts[5]?.trim()
            
            // DriveType 2 = Removable, 3 = Fixed, 5 = CD-ROM
            if (caption && (driveType === 2 || driveType === 5)) {
              volumes.push({
                name: volumeName || caption,
                path: caption,
                type: 'volume'
              })
            }
          }
        }
      } catch (error) {
        console.warn('Could not get Windows volumes:', error)
      }
    }
  } catch (error) {
    console.error('Error getting mounted volumes:', error)
  }
  
  console.log('Returning volumes:', volumes)
  return volumes
}

ipcMain.handle('get-mounted-volumes', async () => {
  console.log('IPC handler get-mounted-volumes called')
  const result = await getMountedVolumes()
  console.log('IPC handler returning:', result)
  return result
})

// Test volume detection on startup
app.whenReady().then(async () => {
  setTimeout(async () => {
    console.log('Testing volume detection on startup...')
    const testVolumes = await getMountedVolumes()
    console.log('Test volumes found:', testVolumes)
  }, 3000)
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
      parsedData = await parseTiff(buffer, filePath)
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