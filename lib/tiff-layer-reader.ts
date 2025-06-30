/**
 * TIFF Layer Reader - Extract Photoshop layer information from layered TIFF files
 * Based on the proven approach for parsing Adobe's 8BIM format and PSD layer structure
 */

import UTIF from 'utif';
import { readFileSync } from 'fs';

interface Layer {
  name: string;
  top: number;
  left: number;
  bottom: number;
  right: number;
  width: number;
  height: number;
  blendMode: string;
  opacity: number;
  flags: number;
  visible: boolean;
  channelCount?: number;
  channels?: Array<{ id: number; length: number }>;
  canvas?: any;
}

interface TiffLayerData {
  width: number;
  height: number;
  channels: number;
  bitsPerChannel: number;
  colorMode: string;
  layers: Layer[];
  hasTransparency: boolean;
  totalLayers: number;
  resources: Array<{ id: number; name: string; size: number }>;
}

function parse8BIMResources(buffer: Buffer) {
  const resources = [];
  let offset = 0;

  console.log('Parsing 8BIM resources, buffer size:', buffer.length);

  while (offset < buffer.length) {
    if (offset + 4 > buffer.length) break;
    
    const signature = buffer.toString('ascii', offset, offset + 4);
    if (signature !== '8BIM') {
      console.log(`Expected 8BIM signature at offset ${offset}, got "${signature}"`);
      break;
    }

    if (offset + 6 > buffer.length) break;
    const resourceId = buffer.readUInt16BE(offset + 4);
    const nameLength = buffer[offset + 6];
    
    let name = '';
    if (nameLength > 0 && offset + 7 + nameLength <= buffer.length) {
      name = buffer.toString('ascii', offset + 7, offset + 7 + nameLength);
    }
    
    // Correct padding calculation as per PSD spec
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

    // Move to next resource with proper padding
    offset = dataEnd + (dataSize % 2 === 1 ? 1 : 0);
  }

  console.log(`Parsed ${resources.length} 8BIM resources`);
  return resources;
}

function extractPhotoshopTag(buffer: Buffer): Buffer | null {
  const ifds = UTIF.decode(buffer);
  if (!ifds || ifds.length === 0) {
    return null;
  }
  
  const tag34377 = ifds[0].t34377;
  return tag34377 ? Buffer.from(tag34377) : null;
}


function parseLayerAndMaskInfo(buffer: Buffer): Layer[] {
  console.log('Parsing Layer and Mask Info, buffer size:', buffer.length);
  
  let offset = 0;

  if (buffer.length < 8) {
    throw new Error('Buffer too small for layer info');
  }

  const totalLength = buffer.readUInt32BE(offset);
  offset += 4;
  console.log('Total length:', totalLength);

  const layerInfoLength = buffer.readUInt32BE(offset);
  offset += 4;
  console.log('Layer info length:', layerInfoLength);

  if (layerInfoLength === 0) {
    console.log('No layer information');
    return [];
  }

  // const endOfLayerInfo = offset + layerInfoLength;

  if (offset + 2 > buffer.length) {
    throw new Error('Buffer too small for layer count');
  }

  const layerCount = buffer.readInt16BE(offset);
  offset += 2;
  console.log('Layer count (raw):', layerCount);

  const absLayerCount = Math.abs(layerCount);
  console.log('Absolute layer count:', absLayerCount);
  
  const layers: Layer[] = [];

  for (let i = 0; i < absLayerCount; i++) {
    console.log(`Processing layer ${i + 1}/${absLayerCount}`);
    
    if (offset + 16 > buffer.length) {
      console.warn(`Not enough data for layer ${i + 1} bounds`);
      break;
    }

    const top = buffer.readInt32BE(offset); offset += 4;
    const left = buffer.readInt32BE(offset); offset += 4;
    const bottom = buffer.readInt32BE(offset); offset += 4;
    const right = buffer.readInt32BE(offset); offset += 4;

    console.log(`Layer ${i + 1} bounds: ${left},${top},${right},${bottom}`);

    if (offset + 2 > buffer.length) {
      console.warn(`Not enough data for layer ${i + 1} channel count`);
      break;
    }

    const channelCount = buffer.readUInt16BE(offset); offset += 2;
    console.log(`Layer ${i + 1} channel count: ${channelCount}`);
    
    // Skip channel info
    for (let c = 0; c < channelCount; c++) {
      if (offset + 6 > buffer.length) break;
      offset += 2; // channel ID
      offset += 4; // channel data length
    }

    if (offset + 12 > buffer.length) {
      console.warn(`Not enough data for layer ${i + 1} blend info`);
      break;
    }

    // Skip blend mode signature ('8BIM')
    offset += 4;
    const blendMode = buffer.toString('ascii', offset, offset + 4); offset += 4;
    const opacity = buffer.readUInt8(offset); offset += 1;
    buffer.readUInt8(offset); offset += 1; // clipping
    const flags = buffer.readUInt8(offset); offset += 1;
    offset += 1; // filler

    console.log(`Layer ${i + 1} - blend: ${blendMode}, opacity: ${opacity}, flags: ${flags}`);

    if (offset + 4 > buffer.length) {
      console.warn(`Not enough data for layer ${i + 1} extra data length`);
      break;
    }

    const extraDataLength = buffer.readUInt32BE(offset); offset += 4;
    const extraDataStart = offset;
    console.log(`Layer ${i + 1} extra data length: ${extraDataLength}`);

    let layerName = `Layer ${i + 1}`;

    // Search for layer name in Additional Layer Information
    let localOffset = offset;
    const extraDataEnd = extraDataStart + extraDataLength;
    
    while (localOffset < extraDataEnd - 12) {
      if (localOffset + 12 > buffer.length) break;
      
      const sig = buffer.toString('ascii', localOffset, localOffset + 4);
      if (sig !== '8BIM') {
        console.log(`Expected 8BIM in extra data, got "${sig}" at offset ${localOffset}`);
        break;
      }

      const key = buffer.toString('ascii', localOffset + 4, localOffset + 8);
      const length = buffer.readUInt32BE(localOffset + 8);
      const dataStart = localOffset + 12;

      console.log(`Found additional info: key="${key}", length=${length}`);

      if (key === 'luni' && dataStart + 4 <= buffer.length) {
        // Unicode layer name
        const nameLength = buffer.readUInt32BE(dataStart);
        const nameEnd = dataStart + 4 + nameLength * 2;
        if (nameEnd <= buffer.length) {
          layerName = buffer.toString('utf16le', dataStart + 4, nameEnd);
          console.log(`Found Unicode layer name: "${layerName}"`);
          break;
        }
      } else if (key === 'lnam' && dataStart < buffer.length) {
        // Pascal string layer name (fallback)
        const pascalLength = buffer[dataStart];
        const nameEnd = dataStart + 1 + pascalLength;
        if (nameEnd <= buffer.length) {
          layerName = buffer.toString('ascii', dataStart + 1, nameEnd);
          console.log(`Found Pascal layer name: "${layerName}"`);
          break;
        }
      }

      const paddedLength = length + (length % 2);
      localOffset += 12 + paddedLength;
    }

    offset = extraDataEnd;

    const layer: Layer = {
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
      visible: (flags & 0x02) === 0, // Bit 1: 0 = visible, 1 = hidden
      channelCount,
      channels: []
    };

    layers.push(layer);
    console.log(`Successfully parsed layer: "${layerName}"`);
  }

  return layers;
}

function analyzeTiffStructure(buffer: Buffer): void {
  console.log('\n=== COMPREHENSIVE TIFF STRUCTURE ANALYSIS ===');
  
  try {
    const ifds = UTIF.decode(buffer);
    console.log(`Found ${ifds.length} IFDs in TIFF`);
    
    for (let i = 0; i < ifds.length; i++) {
      const ifd = ifds[i];
      console.log(`\nIFD ${i + 1}:`);
      console.log(`  Dimensions: ${ifd.width}x${ifd.height}`);
      console.log(`  Bits per sample: ${ifd.t258}`);
      console.log(`  Samples per pixel: ${ifd.t277}`);
      console.log(`  Photometric: ${ifd.t262}`);
      console.log(`  Software: ${ifd.t305}`);
      
      // Look for Photoshop-specific tags
      if (ifd.t34377) {
        console.log(`  Has Photoshop tag (34377): ${ifd.t34377.length} bytes`);
      }
      
      // List all available tags
      const tags = Object.keys(ifd).filter(k => k.startsWith('t')).map(k => k.substring(1));
      console.log(`  Available tags: ${tags.join(', ')}`);
    }
  } catch (error) {
    console.error('Error analyzing TIFF structure:', (error as Error).message);
  }
  
  console.log('=== END TIFF STRUCTURE ANALYSIS ===\n');
}

function readLayersFromTiff(input: string | Buffer): TiffLayerData {
  console.log('Reading layers from TIFF...');

  let buffer: Buffer;
  if (typeof input === 'string') {
    buffer = readFileSync(input);
  } else {
    buffer = input;
  }

  // First, analyze the overall TIFF structure
  analyzeTiffStructure(buffer);

  console.log('Extracting Photoshop tag...');
  const photoshopBlock = extractPhotoshopTag(buffer);

  if (!photoshopBlock) {
    throw new Error('No Photoshop tag (34377) found in TIFF');
  }

  console.log('Found Photoshop block, size:', photoshopBlock.length);

  const resources = parse8BIMResources(photoshopBlock);
  
  // Let's examine ALL resources in detail
  console.log('\n=== DETAILED RESOURCE ANALYSIS ===');
  for (const resource of resources) {
    console.log(`Resource ${resource.id}: ${resource.name || '(no name)'} - ${resource.dataSize} bytes`);
    if (resource.dataSize > 0 && resource.dataSize < 200) {
      // Show hex dump for small resources
      const hex = Array.from(resource.data.slice(0, Math.min(32, resource.dataSize)))
        .map(b => b.toString(16).padStart(2, '0')).join(' ');
      console.log(`  Hex: ${hex}`);
      
      // Try to show as text
      const text = resource.data.toString('ascii', 0, Math.min(32, resource.dataSize))
        .replace(/[^\x20-\x7E]/g, '.');
      console.log(`  Text: "${text}"`);
    }
  }
  console.log('=== END RESOURCE ANALYSIS ===\n');
  
  const layerResource = resources.find(r => r.id === 1058);

  if (!layerResource) {
    console.warn('No Layer and Mask Info (ID 1058) found');
    console.log('Available resource IDs:', resources.map(r => r.id));
    
    // Try alternative resources that might contain layer data
    const alternativeResources = [1036, 1050, 1083, 1082];
    
    for (const resourceId of alternativeResources) {
      const altResource = resources.find(r => r.id === resourceId);
      if (altResource && altResource.dataSize > 100) {
        console.log(`\n=== TRYING RESOURCE ${resourceId} AS LAYER DATA ===`);
        console.log(`Resource ${resourceId} size: ${altResource.dataSize} bytes`);
        
        // Show hex dump of the beginning
        const hexDump = Array.from(altResource.data.slice(0, 64))
          .map(b => b.toString(16).padStart(2, '0'))
          .join(' ');
        console.log(`First 64 bytes: ${hexDump}`);
        
        // Let's analyze the resource data more thoroughly
        console.log(`\n=== DETAILED ANALYSIS OF RESOURCE ${resourceId} ===`);
        
        // Show more hex data for analysis
        const fullHex = Array.from(altResource.data.slice(0, 200))
          .map(b => b.toString(16).padStart(2, '0'))
          .join(' ');
        console.log(`First 200 bytes: ${fullHex}`);
        
        // Try to find patterns that might indicate layer information
        console.log(`\nScanning for potential layer markers...`);
        for (let i = 0; i < Math.min(altResource.data.length - 4, 1000); i++) {
          const bytes = altResource.data.slice(i, i + 4);
          const asInt = bytes.readUInt32BE(0);
          const asStr = bytes.toString('ascii').replace(/[^\x20-\x7E]/g, '.');
          
          // Look for common layer-related patterns
          if (asStr === '8BIM' || asStr === 'lyid' || asStr === 'lnam' || asStr === 'luni') {
            console.log(`Found "${asStr}" at offset ${i}`);
            
            // Show surrounding context
            const context = Array.from(altResource.data.slice(Math.max(0, i-8), i+20))
              .map(b => b.toString(16).padStart(2, '0'))
              .join(' ');
            console.log(`  Context: ${context}`);
          }
          
          // Look for reasonable layer counts (1-50)
          if (asInt >= 1 && asInt <= 50) {
            console.log(`Potential layer count ${asInt} at offset ${i}`);
          }
        }
        
        console.log(`=== END DETAILED ANALYSIS OF RESOURCE ${resourceId} ===\n`)
        
        try {
          // Try parsing as layer data directly
          const layers = parseLayerAndMaskInfo(altResource.data);
          if (layers && layers.length > 0) {
            console.log(`SUCCESS! Found ${layers.length} layers in resource ${resourceId}!`);
            
            const ifds = UTIF.decode(buffer);
            const firstIfd = ifds[0];
            
            return {
              width: firstIfd.width || 0,
              height: firstIfd.height || 0,
              channels: Array.isArray(firstIfd.t277) ? firstIfd.t277[0] : 3,
              bitsPerChannel: Array.isArray(firstIfd.t258) ? firstIfd.t258[0] : 8,
              colorMode: 'RGB',
              layers,
              hasTransparency: layers.some(l => l.blendMode !== 'norm'),
              totalLayers: layers.length,
              resources: resources.map(r => ({ id: r.id, name: r.name, size: r.dataSize }))
            };
          } else {
            console.log(`Resource ${resourceId} parsing returned ${layers ? layers.length : 0} layers`);
          }
        } catch (error) {
          console.log(`Resource ${resourceId} parsing failed: ${(error as Error).message}`);
          
          // For resource 1036, try alternative parsing approaches
          if (resourceId === 1036) {
            console.log('Trying alternative parsing for resource 1036...');
            
            // Try skipping different amounts of header data
            const skipSizes = [0, 4, 8, 12, 16, 28];
            for (const skip of skipSizes) {
              if (skip < altResource.data.length - 8) {
                try {
                  console.log(`Trying with ${skip} byte offset...`);
                  const skippedData = altResource.data.slice(skip);
                  const testLayers = parseLayerAndMaskInfo(skippedData);
                  if (testLayers && testLayers.length > 0) {
                    console.log(`SUCCESS with ${skip} byte offset! Found ${testLayers.length} layers!`);
                    
                    const ifds = UTIF.decode(buffer);
                    const firstIfd = ifds[0];
                    
                    return {
                      width: firstIfd.width || 0,
                      height: firstIfd.height || 0,
                      channels: Array.isArray(firstIfd.t277) ? firstIfd.t277[0] : 3,
                      bitsPerChannel: Array.isArray(firstIfd.t258) ? firstIfd.t258[0] : 8,
                      colorMode: 'RGB',
                      layers: testLayers,
                      hasTransparency: testLayers.some(l => l.blendMode !== 'norm'),
                      totalLayers: testLayers.length,
                      resources: resources.map(r => ({ id: r.id, name: r.name, size: r.dataSize }))
                    };
                  }
                } catch (skipError) {
                  // Continue trying other offsets
                }
              }
            }
          }
        }
        console.log(`=== END RESOURCE ${resourceId} ANALYSIS ===\n`);
      }
    }
    
    // Return structure with available resources info
    const ifds = UTIF.decode(buffer);
    const firstIfd = ifds[0];
    
    return {
      width: firstIfd.width || 0,
      height: firstIfd.height || 0,
      channels: Array.isArray(firstIfd.t277) ? firstIfd.t277[0] : 3,
      bitsPerChannel: Array.isArray(firstIfd.t258) ? firstIfd.t258[0] : 8,
      colorMode: 'RGB',
      layers: [],
      hasTransparency: false,
      totalLayers: 0,
      resources: resources.map(r => ({ id: r.id, name: r.name, size: r.dataSize }))
    };
  }

  console.log('Found layer resource, parsing layers...');

  try {
    const layers = parseLayerAndMaskInfo(layerResource.data);
    console.log(`Successfully parsed ${layers.length} layers`);
    
    // Get image dimensions from TIFF
    const ifds = UTIF.decode(buffer);
    const firstIfd = ifds[0];
    
    return {
      width: firstIfd.width || 0,
      height: firstIfd.height || 0,
      channels: Array.isArray(firstIfd.t277) ? firstIfd.t277[0] : 3,
      bitsPerChannel: Array.isArray(firstIfd.t258) ? firstIfd.t258[0] : 8,
      colorMode: 'RGB',
      layers,
      hasTransparency: layers.some(l => l.blendMode !== 'norm'),
      totalLayers: layers.length,
      resources: resources.map(r => ({ id: r.id, name: r.name, size: r.dataSize }))
    };
  } catch (err) {
    console.error('Failed to parse layer structure:', (err as Error).message);
    throw err;
  }
}

export {
  readLayersFromTiff,
  parse8BIMResources,
  parseLayerAndMaskInfo
};