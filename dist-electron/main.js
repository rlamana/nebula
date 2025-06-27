import { app, BrowserWindow, ipcMain } from "electron";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { readdir, stat, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { initializeCanvas, readPsd } from "ag-psd";
import { createCanvas } from "canvas";
import UTIF from "utif";
import { homedir, platform } from "node:os";
import { exec } from "node:child_process";
import { promisify } from "node:util";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const isDev = process.env.IS_DEV === "true";
const execAsync = promisify(exec);
initializeCanvas(createCanvas);
console.log("Canvas initialized for ag-psd");
let mainWindow = null;
function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.focus();
    return;
  }
  const preloadPath = isDev ? join(process.cwd(), "dist-electron/preload.js") : join(__dirname, "preload.js");
  console.log("Loading preload script from:", preloadPath);
  console.log("Preload file exists:", existsSync(preloadPath));
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: "default",
    title: "Nebula - PSD & TIFF Inspector",
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false
      // Allow file:// protocol access
    }
  });
  mainWindow.on("ready-to-show", () => {
    mainWindow == null ? void 0 : mainWindow.show();
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
    app.quit();
  });
  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
  } else {
    mainWindow.loadFile(join(__dirname, "../dist/index.html"));
  }
}
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(() => {
    console.log("Electron app ready, creating window...");
    createWindow();
    app.on("activate", function() {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}
app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});
console.log("Setting up IPC handlers...");
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
const getFileType = (filePath) => {
  const ext = filePath.toLowerCase().split(".").pop();
  return ext === "tiff" || ext === "tif" ? "tiff" : "psd";
};
const parseTiff = (buffer) => {
  var _a;
  const ifds = UTIF.decode(buffer);
  if (!ifds || ifds.length === 0) {
    throw new Error("No image data found in TIFF file");
  }
  console.log(`Found ${ifds.length} layers/pages in TIFF file`);
  const firstIfd = ifds[0];
  const overallWidth = firstIfd.width;
  const overallHeight = firstIfd.height;
  const children = ifds.map((ifd, index) => {
    var _a2;
    try {
      UTIF.decodeImage(buffer, ifd);
      const width = ifd.width;
      const height = ifd.height;
      const canvas = createCanvas(width, height);
      const ctx = canvas.getContext("2d");
      const imageData = ctx.createImageData(width, height);
      const rgba = new Uint8Array(ifd.data);
      imageData.data.set(rgba);
      ctx.putImageData(imageData, 0, 0);
      const layerName = ifd.t270 ? (
        // ImageDescription tag
        typeof ifd.t270 === "string" ? ifd.t270 : `Layer ${index + 1}`
      ) : `Layer ${index + 1}`;
      const photometric = ifd.t262 || 2;
      const bitsPerSample = ((_a2 = ifd.t258) == null ? void 0 : _a2[0]) || 8;
      const samplesPerPixel = ifd.t277 || rgba.length / (width * height / 4);
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
        layerType: "raster",
        // Additional TIFF-specific metadata
        bitsPerSample,
        samplesPerPixel,
        photometric,
        compression: ifd.t259 || 1
        // Compression type
      };
    } catch (error) {
      console.error(`Error processing TIFF layer ${index + 1}:`, error.message);
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
        layerType: "raster",
        error: error.message
      };
    }
  }).filter((layer) => layer.width > 0 && layer.height > 0);
  return {
    width: overallWidth,
    height: overallHeight,
    channels: firstIfd.t277 || 3,
    // SamplesPerPixel
    bitsPerChannel: ((_a = firstIfd.t258) == null ? void 0 : _a[0]) || 8,
    colorMode: getColorMode(firstIfd.t262 || 2),
    // PhotometricInterpretation
    children
  };
};
const getColorMode = (photometric) => {
  switch (photometric) {
    case 0:
      return "WhiteIsZero";
    case 1:
      return "BlackIsZero";
    case 2:
      return "RGB";
    case 3:
      return "Palette";
    case 4:
      return "Transparency";
    case 5:
      return "CMYK";
    case 6:
      return "YCbCr";
    case 8:
      return "CIELab";
    case 9:
      return "ICCLab";
    case 10:
      return "ITULab";
    default:
      return "Unknown";
  }
};
ipcMain.handle("read-directory", async (_event, dirPath) => {
  console.log("Reading directory:", dirPath);
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    const result = [];
    for (const entry of entries) {
      try {
        const fullPath = join(dirPath, entry.name);
        const stats = await stat(fullPath);
        result.push({
          name: entry.name,
          path: fullPath,
          type: entry.isDirectory() ? "directory" : "file",
          size: stats.size,
          modified: stats.mtime
        });
      } catch (statError) {
        console.warn(`Skipping file ${entry.name}: ${statError.message}`);
        continue;
      }
    }
    return result;
  } catch (error) {
    console.error("Error reading directory:", error);
    throw error;
  }
});
ipcMain.handle("get-home-directory", async () => {
  return homedir();
});
async function getMountedVolumes() {
  var _a, _b, _c;
  const currentPlatform = platform();
  const volumes = [];
  console.log("Getting mounted volumes for platform:", currentPlatform);
  try {
    if (currentPlatform === "darwin") {
      try {
        const volumesDir = "/Volumes";
        console.log("Reading volumes directory:", volumesDir);
        const entries = await readdir(volumesDir, { withFileTypes: true });
        console.log("Found entries in /Volumes:", entries.map((e) => e.name));
        console.log("Entry details:", entries.map((e) => ({ name: e.name, isDirectory: e.isDirectory(), isSymbolicLink: e.isSymbolicLink() })));
        for (const entry of entries) {
          console.log("Processing entry:", entry.name, "isDirectory:", entry.isDirectory(), "isSymbolicLink:", entry.isSymbolicLink());
          if (entry.isDirectory() || entry.isSymbolicLink()) {
            const volumePath = join(volumesDir, entry.name);
            try {
              const statInfo = await stat(volumePath);
              console.log("Stat info for", entry.name, ":", { isDirectory: statInfo.isDirectory(), isSymbolicLink: statInfo.isSymbolicLink() });
              if (entry.name !== "Macintosh HD") {
                console.log("Adding volume:", entry.name, "at path:", volumePath);
                volumes.push({
                  name: entry.name,
                  path: volumePath,
                  type: "volume"
                });
              } else {
                console.log("Skipping system volume:", entry.name);
              }
            } catch (error) {
              console.log("Could not access volume:", entry.name, error);
              continue;
            }
          } else {
            console.log("Skipping non-directory entry:", entry.name);
          }
        }
      } catch (error) {
        console.warn("Could not read /Volumes directory:", error);
      }
    } else if (currentPlatform === "linux") {
      const mediaDirs = ["/media", "/mnt"];
      for (const mediaDir of mediaDirs) {
        try {
          const entries = await readdir(mediaDir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isDirectory()) {
              const volumePath = join(mediaDir, entry.name);
              try {
                await stat(volumePath);
                volumes.push({
                  name: entry.name,
                  path: volumePath,
                  type: "volume"
                });
              } catch {
                continue;
              }
            }
          }
        } catch {
          continue;
        }
      }
      try {
        const userMediaDir = `/media/${process.env.USER || "user"}`;
        const entries = await readdir(userMediaDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const volumePath = join(userMediaDir, entry.name);
            try {
              await stat(volumePath);
              if (!volumes.find((v) => v.path === volumePath)) {
                volumes.push({
                  name: entry.name,
                  path: volumePath,
                  type: "volume"
                });
              }
            } catch {
              continue;
            }
          }
        }
      } catch {
      }
    } else if (currentPlatform === "win32") {
      try {
        const { stdout } = await execAsync("wmic logicaldisk get size,freespace,caption,drivetype,volumename /format:csv");
        const lines = stdout.split("\n").filter((line) => line.trim() && !line.startsWith("Node"));
        for (const line of lines) {
          const parts = line.split(",");
          if (parts.length >= 6) {
            const caption = (_a = parts[1]) == null ? void 0 : _a.trim();
            const driveType = parseInt(((_b = parts[2]) == null ? void 0 : _b.trim()) || "0");
            const volumeName = (_c = parts[5]) == null ? void 0 : _c.trim();
            if (caption && (driveType === 2 || driveType === 5)) {
              volumes.push({
                name: volumeName || caption,
                path: caption,
                type: "volume"
              });
            }
          }
        }
      } catch (error) {
        console.warn("Could not get Windows volumes:", error);
      }
    }
  } catch (error) {
    console.error("Error getting mounted volumes:", error);
  }
  console.log("Returning volumes:", volumes);
  return volumes;
}
ipcMain.handle("get-mounted-volumes", async () => {
  console.log("IPC handler get-mounted-volumes called");
  const result = await getMountedVolumes();
  console.log("IPC handler returning:", result);
  return result;
});
app.whenReady().then(async () => {
  setTimeout(async () => {
    console.log("Testing volume detection on startup...");
    const testVolumes = await getMountedVolumes();
    console.log("Test volumes found:", testVolumes);
  }, 3e3);
});
ipcMain.handle("parse-psd", async (_event, filePath) => {
  var _a;
  console.log("Received parse-psd request for:", filePath);
  try {
    const buffer = await readFile(filePath);
    console.log("File read successfully, size:", buffer.length);
    const fileType = getFileType(filePath);
    let parsedData;
    if (fileType === "tiff") {
      console.log("Parsing TIFF file...");
      parsedData = parseTiff(buffer);
      console.log("TIFF parsed successfully");
    } else {
      console.log("Parsing PSD file...");
      parsedData = readPsd(buffer, {
        skipLayerImageData: false,
        // Include image data for thumbnails
        skipCompositeImageData: true,
        skipThumbnail: true,
        useImageData: true
        // Generate image data for thumbnails
      });
      console.log("PSD parsed successfully, layers found:", ((_a = parsedData.children) == null ? void 0 : _a.length) || 0);
    }
    const generateThumbnail = (layer) => {
      if (!layer.canvas && !layer.imageData) return null;
      try {
        const canvas = layer.canvas || createCanvas(layer.imageData.width, layer.imageData.height);
        if (layer.imageData && !layer.canvas) {
          const ctx = canvas.getContext("2d");
          const imageData = ctx.createImageData(layer.imageData.width, layer.imageData.height);
          imageData.data.set(layer.imageData.data);
          ctx.putImageData(imageData, 0, 0);
        }
        const maxSize = 48;
        const aspectRatio = canvas.width / canvas.height;
        let thumbWidth = maxSize;
        let thumbHeight = maxSize;
        if (aspectRatio > 1) {
          thumbHeight = maxSize / aspectRatio;
        } else {
          thumbWidth = maxSize * aspectRatio;
        }
        const thumbCanvas = createCanvas(thumbWidth, thumbHeight);
        const thumbCtx = thumbCanvas.getContext("2d");
        thumbCtx.drawImage(canvas, 0, 0, thumbWidth, thumbHeight);
        return thumbCanvas.toDataURL("image/png");
      } catch (error) {
        console.error("Error generating thumbnail for layer:", layer.name, error);
        return null;
      }
    };
    const enhanceLayerInfo = (layer) => {
      return {
        ...layer,
        layerType: getLayerType(layer),
        dimensions: layer.left !== void 0 && layer.top !== void 0 && layer.right !== void 0 && layer.bottom !== void 0 ? {
          left: layer.left,
          top: layer.top,
          right: layer.right,
          bottom: layer.bottom,
          width: layer.right - layer.left,
          height: layer.bottom - layer.top
        } : null,
        thumbnail: generateThumbnail(layer),
        children: layer.children ? layer.children.map(enhanceLayerInfo) : void 0
      };
    };
    const getLayerType = (layer) => {
      if (layer.children && layer.children.length > 0) return "group";
      if (layer.text) return "text";
      if (layer.vectorMask || layer.stroke || layer.fill) return "shape";
      if (layer.adjustment) return "adjustment";
      return "raster";
    };
    const result = {
      ...parsedData,
      children: parsedData.children ? parsedData.children.map(enhanceLayerInfo) : []
    };
    return result;
  } catch (error) {
    console.error("Error parsing file:", error);
    throw error;
  }
});
