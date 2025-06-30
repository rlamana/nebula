import { app, BrowserWindow, ipcMain } from "electron";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { readdir, stat, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { initializeCanvas, readPsd } from "ag-psd";
import { createCanvas } from "canvas";
import UTIF from "utif";
import sharp from "sharp";
import { homedir, platform } from "node:os";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { readFileSync } from "fs";
function parse8BIMResources(buffer) {
  const resources = [];
  let offset = 0;
  console.log("Parsing 8BIM resources, buffer size:", buffer.length);
  while (offset < buffer.length) {
    if (offset + 4 > buffer.length) break;
    const signature = buffer.toString("ascii", offset, offset + 4);
    if (signature !== "8BIM") {
      console.log(`Expected 8BIM signature at offset ${offset}, got "${signature}"`);
      break;
    }
    if (offset + 6 > buffer.length) break;
    const resourceId = buffer.readUInt16BE(offset + 4);
    const nameLength = buffer[offset + 6];
    let name = "";
    if (nameLength > 0 && offset + 7 + nameLength <= buffer.length) {
      name = buffer.toString("ascii", offset + 7, offset + 7 + nameLength);
    }
    const paddedNameLength = (nameLength + 1) % 2 === 1 ? nameLength + 1 : nameLength + 2;
    const sizeOffset = offset + 7 + paddedNameLength;
    if (sizeOffset + 4 > buffer.length) break;
    const dataSize = buffer.readUInt32BE(sizeOffset);
    const dataStart = sizeOffset + 4;
    const dataEnd = dataStart + dataSize;
    if (dataEnd > buffer.length) {
      console.log(`Data extends beyond buffer length at resource ${resourceId}`);
      break;
    }
    const data = buffer.slice(dataStart, dataEnd);
    resources.push({
      id: resourceId,
      name,
      data,
      dataSize
    });
    console.log(`Found resource: ID=${resourceId}, name="${name}", size=${dataSize}`);
    offset = dataEnd + (dataSize % 2 === 1 ? 1 : 0);
  }
  console.log(`Parsed ${resources.length} 8BIM resources`);
  return resources;
}
function extractPhotoshopTag(buffer) {
  const ifds = UTIF.decode(buffer);
  if (!ifds || ifds.length === 0) {
    return null;
  }
  const tag34377 = ifds[0].t34377;
  return tag34377 ? Buffer.from(tag34377) : null;
}
function parseLayerAndMaskInfo(buffer) {
  console.log("Parsing Layer and Mask Info, buffer size:", buffer.length);
  let offset = 0;
  if (buffer.length < 8) {
    throw new Error("Buffer too small for layer info");
  }
  const totalLength = buffer.readUInt32BE(offset);
  offset += 4;
  console.log("Total length:", totalLength);
  const layerInfoLength = buffer.readUInt32BE(offset);
  offset += 4;
  console.log("Layer info length:", layerInfoLength);
  if (layerInfoLength === 0) {
    console.log("No layer information");
    return [];
  }
  if (offset + 2 > buffer.length) {
    throw new Error("Buffer too small for layer count");
  }
  const layerCount = buffer.readInt16BE(offset);
  offset += 2;
  console.log("Layer count (raw):", layerCount);
  const absLayerCount = Math.abs(layerCount);
  console.log("Absolute layer count:", absLayerCount);
  const layers = [];
  for (let i = 0; i < absLayerCount; i++) {
    console.log(`Processing layer ${i + 1}/${absLayerCount}`);
    if (offset + 16 > buffer.length) {
      console.warn(`Not enough data for layer ${i + 1} bounds`);
      break;
    }
    const top = buffer.readInt32BE(offset);
    offset += 4;
    const left = buffer.readInt32BE(offset);
    offset += 4;
    const bottom = buffer.readInt32BE(offset);
    offset += 4;
    const right = buffer.readInt32BE(offset);
    offset += 4;
    console.log(`Layer ${i + 1} bounds: ${left},${top},${right},${bottom}`);
    if (offset + 2 > buffer.length) {
      console.warn(`Not enough data for layer ${i + 1} channel count`);
      break;
    }
    const channelCount = buffer.readUInt16BE(offset);
    offset += 2;
    console.log(`Layer ${i + 1} channel count: ${channelCount}`);
    for (let c = 0; c < channelCount; c++) {
      if (offset + 6 > buffer.length) break;
      offset += 2;
      offset += 4;
    }
    if (offset + 12 > buffer.length) {
      console.warn(`Not enough data for layer ${i + 1} blend info`);
      break;
    }
    offset += 4;
    const blendMode = buffer.toString("ascii", offset, offset + 4);
    offset += 4;
    const opacity = buffer.readUInt8(offset);
    offset += 1;
    buffer.readUInt8(offset);
    offset += 1;
    const flags = buffer.readUInt8(offset);
    offset += 1;
    offset += 1;
    console.log(`Layer ${i + 1} - blend: ${blendMode}, opacity: ${opacity}, flags: ${flags}`);
    if (offset + 4 > buffer.length) {
      console.warn(`Not enough data for layer ${i + 1} extra data length`);
      break;
    }
    const extraDataLength = buffer.readUInt32BE(offset);
    offset += 4;
    const extraDataStart = offset;
    console.log(`Layer ${i + 1} extra data length: ${extraDataLength}`);
    let layerName = `Layer ${i + 1}`;
    let localOffset = offset;
    const extraDataEnd = extraDataStart + extraDataLength;
    while (localOffset < extraDataEnd - 12) {
      if (localOffset + 12 > buffer.length) break;
      const sig = buffer.toString("ascii", localOffset, localOffset + 4);
      if (sig !== "8BIM") {
        console.log(`Expected 8BIM in extra data, got "${sig}" at offset ${localOffset}`);
        break;
      }
      const key = buffer.toString("ascii", localOffset + 4, localOffset + 8);
      const length = buffer.readUInt32BE(localOffset + 8);
      const dataStart = localOffset + 12;
      console.log(`Found additional info: key="${key}", length=${length}`);
      if (key === "luni" && dataStart + 4 <= buffer.length) {
        const nameLength = buffer.readUInt32BE(dataStart);
        const nameEnd = dataStart + 4 + nameLength * 2;
        if (nameEnd <= buffer.length) {
          layerName = buffer.toString("utf16le", dataStart + 4, nameEnd);
          console.log(`Found Unicode layer name: "${layerName}"`);
          break;
        }
      } else if (key === "lnam" && dataStart < buffer.length) {
        const pascalLength = buffer[dataStart];
        const nameEnd = dataStart + 1 + pascalLength;
        if (nameEnd <= buffer.length) {
          layerName = buffer.toString("ascii", dataStart + 1, nameEnd);
          console.log(`Found Pascal layer name: "${layerName}"`);
          break;
        }
      }
      const paddedLength = length + length % 2;
      localOffset += 12 + paddedLength;
    }
    offset = extraDataEnd;
    const layer = {
      name: layerName,
      top,
      left,
      bottom,
      right,
      width: right - left,
      height: bottom - top,
      blendMode,
      opacity,
      flags,
      visible: (flags & 2) === 0,
      // Bit 1: 0 = visible, 1 = hidden
      channelCount,
      channels: []
    };
    layers.push(layer);
    console.log(`Successfully parsed layer: "${layerName}"`);
  }
  return layers;
}
function analyzeTiffStructure(buffer) {
  console.log("\n=== COMPREHENSIVE TIFF STRUCTURE ANALYSIS ===");
  try {
    const ifds = UTIF.decode(buffer);
    console.log(`Found ${ifds.length} IFDs in TIFF`);
    for (let i = 0; i < ifds.length; i++) {
      const ifd = ifds[i];
      console.log(`
IFD ${i + 1}:`);
      console.log(`  Dimensions: ${ifd.width}x${ifd.height}`);
      console.log(`  Bits per sample: ${ifd.t258}`);
      console.log(`  Samples per pixel: ${ifd.t277}`);
      console.log(`  Photometric: ${ifd.t262}`);
      console.log(`  Software: ${ifd.t305}`);
      if (ifd.t34377) {
        console.log(`  Has Photoshop tag (34377): ${ifd.t34377.length} bytes`);
      }
      const tags = Object.keys(ifd).filter((k) => k.startsWith("t")).map((k) => k.substring(1));
      console.log(`  Available tags: ${tags.join(", ")}`);
    }
  } catch (error) {
    console.error("Error analyzing TIFF structure:", error.message);
  }
  console.log("=== END TIFF STRUCTURE ANALYSIS ===\n");
}
function readLayersFromTiff(input) {
  console.log("Reading layers from TIFF...");
  let buffer;
  if (typeof input === "string") {
    buffer = readFileSync(input);
  } else {
    buffer = input;
  }
  analyzeTiffStructure(buffer);
  console.log("Extracting Photoshop tag...");
  const photoshopBlock = extractPhotoshopTag(buffer);
  if (!photoshopBlock) {
    throw new Error("No Photoshop tag (34377) found in TIFF");
  }
  console.log("Found Photoshop block, size:", photoshopBlock.length);
  const resources = parse8BIMResources(photoshopBlock);
  console.log("\n=== DETAILED RESOURCE ANALYSIS ===");
  for (const resource of resources) {
    console.log(`Resource ${resource.id}: ${resource.name || "(no name)"} - ${resource.dataSize} bytes`);
    if (resource.dataSize > 0 && resource.dataSize < 200) {
      const hex = Array.from(resource.data.slice(0, Math.min(32, resource.dataSize))).map((b) => b.toString(16).padStart(2, "0")).join(" ");
      console.log(`  Hex: ${hex}`);
      const text = resource.data.toString("ascii", 0, Math.min(32, resource.dataSize)).replace(/[^\x20-\x7E]/g, ".");
      console.log(`  Text: "${text}"`);
    }
  }
  console.log("=== END RESOURCE ANALYSIS ===\n");
  const layerResource = resources.find((r) => r.id === 1058);
  if (!layerResource) {
    console.warn("No Layer and Mask Info (ID 1058) found");
    console.log("Available resource IDs:", resources.map((r) => r.id));
    const alternativeResources = [1036, 1050, 1083, 1082];
    for (const resourceId of alternativeResources) {
      const altResource = resources.find((r) => r.id === resourceId);
      if (altResource && altResource.dataSize > 100) {
        console.log(`
=== TRYING RESOURCE ${resourceId} AS LAYER DATA ===`);
        console.log(`Resource ${resourceId} size: ${altResource.dataSize} bytes`);
        const hexDump = Array.from(altResource.data.slice(0, 64)).map((b) => b.toString(16).padStart(2, "0")).join(" ");
        console.log(`First 64 bytes: ${hexDump}`);
        console.log(`
=== DETAILED ANALYSIS OF RESOURCE ${resourceId} ===`);
        const fullHex = Array.from(altResource.data.slice(0, 200)).map((b) => b.toString(16).padStart(2, "0")).join(" ");
        console.log(`First 200 bytes: ${fullHex}`);
        console.log(`
Scanning for potential layer markers...`);
        for (let i = 0; i < Math.min(altResource.data.length - 4, 1e3); i++) {
          const bytes = altResource.data.slice(i, i + 4);
          const asInt = bytes.readUInt32BE(0);
          const asStr = bytes.toString("ascii").replace(/[^\x20-\x7E]/g, ".");
          if (asStr === "8BIM" || asStr === "lyid" || asStr === "lnam" || asStr === "luni") {
            console.log(`Found "${asStr}" at offset ${i}`);
            const context = Array.from(altResource.data.slice(Math.max(0, i - 8), i + 20)).map((b) => b.toString(16).padStart(2, "0")).join(" ");
            console.log(`  Context: ${context}`);
          }
          if (asInt >= 1 && asInt <= 50) {
            console.log(`Potential layer count ${asInt} at offset ${i}`);
          }
        }
        console.log(`=== END DETAILED ANALYSIS OF RESOURCE ${resourceId} ===
`);
        try {
          const layers = parseLayerAndMaskInfo(altResource.data);
          if (layers && layers.length > 0) {
            console.log(`SUCCESS! Found ${layers.length} layers in resource ${resourceId}!`);
            const ifds2 = UTIF.decode(buffer);
            const firstIfd2 = ifds2[0];
            return {
              width: firstIfd2.width || 0,
              height: firstIfd2.height || 0,
              channels: Array.isArray(firstIfd2.t277) ? firstIfd2.t277[0] : 3,
              bitsPerChannel: Array.isArray(firstIfd2.t258) ? firstIfd2.t258[0] : 8,
              colorMode: "RGB",
              layers,
              hasTransparency: layers.some((l) => l.blendMode !== "norm"),
              totalLayers: layers.length,
              resources: resources.map((r) => ({ id: r.id, name: r.name, size: r.dataSize }))
            };
          } else {
            console.log(`Resource ${resourceId} parsing returned ${layers ? layers.length : 0} layers`);
          }
        } catch (error) {
          console.log(`Resource ${resourceId} parsing failed: ${error.message}`);
          if (resourceId === 1036) {
            console.log("Trying alternative parsing for resource 1036...");
            const skipSizes = [0, 4, 8, 12, 16, 28];
            for (const skip of skipSizes) {
              if (skip < altResource.data.length - 8) {
                try {
                  console.log(`Trying with ${skip} byte offset...`);
                  const skippedData = altResource.data.slice(skip);
                  const testLayers = parseLayerAndMaskInfo(skippedData);
                  if (testLayers && testLayers.length > 0) {
                    console.log(`SUCCESS with ${skip} byte offset! Found ${testLayers.length} layers!`);
                    const ifds2 = UTIF.decode(buffer);
                    const firstIfd2 = ifds2[0];
                    return {
                      width: firstIfd2.width || 0,
                      height: firstIfd2.height || 0,
                      channels: Array.isArray(firstIfd2.t277) ? firstIfd2.t277[0] : 3,
                      bitsPerChannel: Array.isArray(firstIfd2.t258) ? firstIfd2.t258[0] : 8,
                      colorMode: "RGB",
                      layers: testLayers,
                      hasTransparency: testLayers.some((l) => l.blendMode !== "norm"),
                      totalLayers: testLayers.length,
                      resources: resources.map((r) => ({ id: r.id, name: r.name, size: r.dataSize }))
                    };
                  }
                } catch (skipError) {
                }
              }
            }
          }
        }
        console.log(`=== END RESOURCE ${resourceId} ANALYSIS ===
`);
      }
    }
    const ifds = UTIF.decode(buffer);
    const firstIfd = ifds[0];
    return {
      width: firstIfd.width || 0,
      height: firstIfd.height || 0,
      channels: Array.isArray(firstIfd.t277) ? firstIfd.t277[0] : 3,
      bitsPerChannel: Array.isArray(firstIfd.t258) ? firstIfd.t258[0] : 8,
      colorMode: "RGB",
      layers: [],
      hasTransparency: false,
      totalLayers: 0,
      resources: resources.map((r) => ({ id: r.id, name: r.name, size: r.dataSize }))
    };
  }
  console.log("Found layer resource, parsing layers...");
  try {
    const layers = parseLayerAndMaskInfo(layerResource.data);
    console.log(`Successfully parsed ${layers.length} layers`);
    const ifds = UTIF.decode(buffer);
    const firstIfd = ifds[0];
    return {
      width: firstIfd.width || 0,
      height: firstIfd.height || 0,
      channels: Array.isArray(firstIfd.t277) ? firstIfd.t277[0] : 3,
      bitsPerChannel: Array.isArray(firstIfd.t258) ? firstIfd.t258[0] : 8,
      colorMode: "RGB",
      layers,
      hasTransparency: layers.some((l) => l.blendMode !== "norm"),
      totalLayers: layers.length,
      resources: resources.map((r) => ({ id: r.id, name: r.name, size: r.dataSize }))
    };
  } catch (err) {
    console.error("Failed to parse layer structure:", err.message);
    throw err;
  }
}
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
    titleBarStyle: "hiddenInset",
    // Hide title bar but keep window controls
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
const tiffLayerCache = /* @__PURE__ */ new Map();
const tiffLayerExtractionCache = /* @__PURE__ */ new Map();
const getCacheKey = (filePath, stats) => {
  return createHash("md5").update(filePath + stats.mtime.getTime() + stats.size).digest("hex");
};
const extractPhotoshopTiffLayers = async (filePath, buffer) => {
  console.log("Extracting Photoshop TIFF layers using custom library...");
  try {
    const stats = await stat(filePath);
    const cacheKey = getCacheKey(filePath, stats);
    if (tiffLayerExtractionCache.has(cacheKey)) {
      console.log("Found cached layer extraction for TIFF file");
      return tiffLayerExtractionCache.get(cacheKey).layerData;
    }
    const layerData = readLayersFromTiff(buffer);
    console.log(`Successfully extracted layer data:`, {
      width: layerData.width,
      height: layerData.height,
      totalLayers: layerData.totalLayers,
      resources: layerData.resources.length,
      actualLayers: layerData.layers.length,
      layerNames: layerData.layers.map((l) => l.name)
    });
    console.log("Full layer data structure:", JSON.stringify({
      ...layerData,
      layers: layerData.layers.map((layer) => ({
        ...layer,
        canvas: layer.canvas ? "[Canvas Object]" : void 0,
        channels: layer.channels ? "[Channel Data]" : void 0
      }))
    }, null, 2));
    const children = layerData.layers.map((layer, index) => {
      const maxPreviewSize = 512;
      const scale = Math.min(1, maxPreviewSize / Math.max(layer.width, layer.height));
      const previewWidth = Math.floor(layer.width * scale);
      const previewHeight = Math.floor(layer.height * scale);
      const canvas = createCanvas(previewWidth, previewHeight);
      const ctx = canvas.getContext("2d");
      const imageData = ctx.createImageData(previewWidth, previewHeight);
      const hue = index * 137.5 % 360;
      for (let i = 0; i < imageData.data.length; i += 4) {
        const x = i / 4 % previewWidth;
        const y = Math.floor(i / 4 / previewWidth);
        const intensity = Math.sin(x * 0.02) * Math.cos(y * 0.02) * 127 + 128;
        const rgb = hslToRgb(hue / 360, 0.5, intensity / 255);
        imageData.data[i] = rgb[0];
        imageData.data[i + 1] = rgb[1];
        imageData.data[i + 2] = rgb[2];
        imageData.data[i + 3] = 255;
      }
      ctx.putImageData(imageData, 0, 0);
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
        layerType: "raster",
        blendMode: layer.blendMode,
        channelCount: layer.channelCount,
        channels: layer.channels,
        isPreview: scale < 1,
        originalSize: { width: layer.width, height: layer.height },
        extractedFromPhotoshopTiff: true
      };
    });
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
    };
    tiffLayerExtractionCache.set(cacheKey, {
      layerData: result,
      mtime: stats.mtime.getTime(),
      fileSize: stats.size
    });
    if (tiffLayerExtractionCache.size > 5) {
      const oldestKey = tiffLayerExtractionCache.keys().next().value;
      if (oldestKey) {
        tiffLayerExtractionCache.delete(oldestKey);
      }
    }
    console.log(`Successfully extracted ${children.length} layers from Photoshop TIFF`);
    return result;
  } catch (error) {
    console.error("Photoshop TIFF layer extraction failed:", error.message);
    throw error;
  }
};
const extractTiffLayers = async (filePath, buffer) => {
  console.log("Starting TIFF layer extraction using Sharp...");
  try {
    const stats = await stat(filePath);
    const cacheKey = getCacheKey(filePath, stats);
    if (tiffLayerCache.has(cacheKey)) {
      console.log("Found cached layer data for TIFF file");
      return tiffLayerCache.get(cacheKey).data;
    }
    const sharpImage = sharp(buffer);
    const metadata = await sharpImage.metadata();
    console.log("TIFF metadata:", {
      width: metadata.width,
      height: metadata.height,
      pages: metadata.pages,
      density: metadata.density,
      format: metadata.format
    });
    const children = [];
    const numPages = metadata.pages || 1;
    console.log(`Processing ${numPages} pages in TIFF...`);
    for (let page = 0; page < Math.min(numPages, 20); page++) {
      try {
        console.log(`Processing page ${page + 1}/${numPages}`);
        const pageImage = sharp(buffer, { page });
        const pageMetadata = await pageImage.metadata();
        if (!pageMetadata.width || !pageMetadata.height) {
          console.warn(`Page ${page + 1} has invalid dimensions, skipping`);
          continue;
        }
        const maxSize = 512;
        const scale = Math.min(1, maxSize / Math.max(pageMetadata.width, pageMetadata.height));
        const previewWidth = Math.floor(pageMetadata.width * scale);
        const previewHeight = Math.floor(pageMetadata.height * scale);
        const canvas = createCanvas(previewWidth, previewHeight);
        const ctx = canvas.getContext("2d");
        const imageData = ctx.createImageData(previewWidth, previewHeight);
        const hue = page * 137.5 % 360;
        for (let i = 0; i < imageData.data.length; i += 4) {
          const x = i / 4 % previewWidth;
          const y = Math.floor(i / 4 / previewWidth);
          const intensity = Math.sin(x * 0.02) * Math.cos(y * 0.02) * 127 + 128;
          const rgb = hslToRgb(hue / 360, 0.3, intensity / 255);
          imageData.data[i] = rgb[0];
          imageData.data[i + 1] = rgb[1];
          imageData.data[i + 2] = rgb[2];
          imageData.data[i + 3] = 255;
        }
        ctx.putImageData(imageData, 0, 0);
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
          layerType: "raster",
          pageIndex: page,
          isPreview: scale < 1,
          originalSize: { width: pageMetadata.width, height: pageMetadata.height },
          extractedWithSharp: true
        });
        console.log(`Successfully processed page ${page + 1}: ${pageMetadata.width}x${pageMetadata.height}`);
      } catch (pageError) {
        console.error(`Error processing page ${page + 1}:`, pageError.message);
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
          layerType: "error",
          error: pageError.message,
          pageIndex: page
        });
      }
    }
    const result = {
      width: metadata.width || 1e3,
      height: metadata.height || 1e3,
      channels: metadata.channels || 3,
      bitsPerChannel: 8,
      colorMode: "RGB",
      children: children.filter((child) => child.width > 0 || child.layerType === "error"),
      extractedWithSharp: true,
      totalPages: numPages
    };
    tiffLayerCache.set(cacheKey, {
      data: result,
      mtime: stats.mtime.getTime(),
      fileSize: stats.size
    });
    if (tiffLayerCache.size > 10) {
      const oldestKey = tiffLayerCache.keys().next().value;
      if (oldestKey) {
        tiffLayerCache.delete(oldestKey);
      }
    }
    console.log(`Successfully extracted ${children.length} layers from TIFF`);
    return result;
  } catch (error) {
    console.error("TIFF layer extraction failed:", error.message);
    throw error;
  }
};
const hslToRgb = (h, s, l) => {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(h * 6 % 2 - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (0 <= h && h < 1 / 6) {
    r = c;
    g = x;
    b = 0;
  } else if (1 / 6 <= h && h < 2 / 6) {
    r = x;
    g = c;
    b = 0;
  } else if (2 / 6 <= h && h < 3 / 6) {
    r = 0;
    g = c;
    b = x;
  } else if (3 / 6 <= h && h < 4 / 6) {
    r = 0;
    g = x;
    b = c;
  } else if (4 / 6 <= h && h < 5 / 6) {
    r = x;
    g = 0;
    b = c;
  } else if (5 / 6 <= h && h < 1) {
    r = c;
    g = 0;
    b = x;
  }
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255)
  ];
};
const parseTiff = async (buffer, filePath) => {
  var _a, _b;
  console.log("Starting TIFF parsing...");
  try {
    const ifds = UTIF.decode(buffer);
    if (!ifds || ifds.length === 0) {
      throw new Error("No image data found in TIFF file");
    }
    console.log(`Found ${ifds.length} IFDs in TIFF file`);
    const isPhotoshopTiff = ifds.some(
      (ifd) => ifd.t305 && Array.isArray(ifd.t305) && ifd.t305[0] && String(ifd.t305[0]).includes("Adobe Photoshop")
    );
    console.log("Is Photoshop TIFF:", isPhotoshopTiff);
    try {
      console.log("Attempting Sharp-based layer extraction...");
      const sharpData = await extractTiffLayers(filePath, buffer);
      if (sharpData && sharpData.children && sharpData.children.length > 1) {
        console.log(`Successfully extracted ${sharpData.children.length} layers via Sharp`);
        return sharpData;
      } else if (sharpData && sharpData.children && sharpData.children.length === 1) {
        console.log("Sharp found only 1 page, will try other methods...");
      }
    } catch (sharpError) {
      console.warn("Sharp layer extraction failed:", sharpError.message);
    }
    if (isPhotoshopTiff) {
      console.log("Attempting Photoshop TIFF layer extraction with custom library...");
      try {
        const extractedData = await extractPhotoshopTiffLayers(filePath, buffer);
        if (extractedData && extractedData.children) {
          console.log(`Successfully extracted Photoshop TIFF layers: ${extractedData.children.length} layers`);
          console.log("Layer names:", extractedData.children.map((c) => c.name));
          console.log("RETURNING EXTRACTED DATA TO UI:", JSON.stringify({
            ...extractedData,
            children: (_a = extractedData.children) == null ? void 0 : _a.map((child) => ({
              ...child,
              canvas: child.canvas ? "[Canvas Object]" : void 0,
              imageData: child.imageData ? "[ImageData Object]" : void 0
            }))
          }, null, 2));
          return extractedData;
        } else {
          console.log("Extracted data but no children found:", extractedData);
          console.log("Raw extracted data structure:", JSON.stringify({
            ...extractedData,
            children: (_b = extractedData == null ? void 0 : extractedData.children) == null ? void 0 : _b.map((child) => ({
              ...child,
              canvas: child.canvas ? "[Canvas Object]" : void 0,
              imageData: child.imageData ? "[ImageData Object]" : void 0
            }))
          }, null, 2));
        }
      } catch (extractionError) {
        console.warn("Photoshop TIFF layer extraction failed:", extractionError.message);
        console.warn("Full error:", extractionError);
      }
      const firstIfd2 = ifds[0];
      const width = firstIfd2.width || 1e3;
      const height = firstIfd2.height || 1e3;
      return {
        width,
        height,
        channels: 3,
        bitsPerChannel: 8,
        colorMode: "RGB",
        children: [{
          name: "Photoshop TIFF Detected",
          visible: false,
          opacity: 100,
          left: 0,
          top: 0,
          right: width,
          bottom: height,
          width: 0,
          height: 0,
          layerType: "info",
          note: "This appears to be a Photoshop TIFF. Layer extraction failed - the layers may be embedded in a proprietary format.",
          isPhotoshopTiff: true
        }],
        isPhotoshopTiff: true
      };
    }
    const firstIfd = ifds[0];
    const overallWidth = firstIfd.width || 100;
    const overallHeight = firstIfd.height || 100;
    const children = [];
    for (let index = 0; index < Math.min(ifds.length, 10); index++) {
      const ifd = ifds[index];
      console.log(`Processing IFD ${index + 1}:`, {
        width: ifd.width,
        height: ifd.height,
        hasData: !!ifd.data
      });
      try {
        const width = ifd.width;
        const height = ifd.height;
        if (!width || !height) {
          console.warn(`Invalid dimensions in IFD ${index + 1}, skipping`);
          continue;
        }
        if (width * height > 50 * 1024 * 1024 / 4) {
          console.warn(`IFD ${index + 1} too large (${width}x${height}), skipping decode`);
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
            layerType: "large",
            note: "Layer too large to preview",
            ifdIndex: index
          });
          continue;
        }
        UTIF.decodeImage(buffer, ifd);
        if (!ifd.data || (ifd.data instanceof ArrayBuffer ? ifd.data.byteLength === 0 : ifd.data.length === 0)) {
          console.warn(`No image data in IFD ${index + 1}, skipping`);
          continue;
        }
        const maxPreviewSize = 512;
        const scale = Math.min(1, maxPreviewSize / Math.max(width, height));
        const previewWidth = Math.floor(width * scale);
        const previewHeight = Math.floor(height * scale);
        const canvas = createCanvas(previewWidth, previewHeight);
        const ctx = canvas.getContext("2d");
        const fullCanvas = createCanvas(width, height);
        const fullCtx = fullCanvas.getContext("2d");
        const canvasImageData = fullCtx.createImageData(width, height);
        const rgba = new Uint8Array(ifd.data);
        const expectedLength = width * height * 4;
        if (rgba.length >= expectedLength) {
          canvasImageData.data.set(rgba.slice(0, expectedLength));
        } else {
          console.warn(`Data length mismatch in IFD ${index + 1}`);
          continue;
        }
        fullCtx.putImageData(canvasImageData, 0, 0);
        ctx.drawImage(fullCanvas, 0, 0, previewWidth, previewHeight);
        const layerName = `Layer ${index + 1}`;
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
          layerType: "raster",
          ifdIndex: index,
          isPreview: scale < 1,
          originalSize: { width, height }
        });
        console.log(`Successfully processed layer: ${layerName} (${width}x${height} -> ${previewWidth}x${previewHeight})`);
      } catch (error) {
        console.error(`Error processing TIFF layer ${index + 1}:`, error.message);
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
          layerType: "error",
          error: error.message,
          ifdIndex: index
        });
      }
    }
    const validChildren = children.filter((layer) => layer.width > 0 || layer.layerType !== "raster");
    console.log(`Successfully processed ${validChildren.length} layers out of ${children.length} total`);
    return {
      width: overallWidth,
      height: overallHeight,
      channels: Array.isArray(firstIfd.t277) ? firstIfd.t277[0] : 3,
      bitsPerChannel: Array.isArray(firstIfd.t258) ? firstIfd.t258[0] : 8,
      colorMode: getColorMode(Array.isArray(firstIfd.t262) ? firstIfd.t262[0] : 2),
      children: validChildren
    };
  } catch (error) {
    console.error("TIFF parsing failed:", error.message);
    throw error;
  }
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
      parsedData = await parseTiff(buffer, filePath);
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
