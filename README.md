# Nebula

A modern desktop application for inspecting the structure of Photoshop (PSD) and TIFF files.

## Features

- **Drag & Drop Interface**: Simply drag PSD or TIFF files into the application
- **Layer Hierarchy Visualization**: View the complete layer structure in an expandable tree
- **Layer Information**: See layer names, types, visibility, opacity, and dimensions
- **Modern UI**: Built with a sleek dark mode interface featuring glassmorphism and gradient accents
- **Real-time Interactions**: Smooth animations and responsive design

## Tech Stack

- **Electron**: Desktop application framework
- **React**: UI library
- **TypeScript**: Type safety
- **Vite**: Fast build tool
- **Tailwind CSS**: Styling framework
- **shadcn/ui**: UI components
- **Framer Motion**: Animations
- **ag-psd**: PSD parsing library

## Development

### Prerequisites

- Node.js (v18 or higher)
- npm

### Installation

```bash
npm install
```

### Development Mode

```bash
npm run electron:dev
```

This will start both the Vite development server and Electron in development mode with hot reload.

### Building for Production

```bash
npm run build
```

### Platform-specific Builds

```bash
# Windows
npm run electron:pack:win

# macOS
npm run electron:pack:mac

# Linux
npm run electron:pack:linux
```

## Supported File Formats

- **PSD**: Photoshop Document files (.psd)
- **TIFF**: Tagged Image File Format (.tiff, .tif)

## Layer Types Detected

- **Group/Folder**: Layer groups containing other layers
- **Text**: Text layers with typography information
- **Shape**: Vector shape layers
- **Adjustment**: Adjustment layers (brightness, contrast, etc.)
- **Raster**: Standard bitmap/image layers

## Architecture

The application uses a secure Electron architecture with:

- **Main Process**: Handles file system operations and PSD parsing
- **Renderer Process**: React-based UI with strict context isolation
- **IPC Communication**: Secure communication between processes using contextBridge

## UI Design

Inspired by modern design systems like Notion and Linear, featuring:

- **Dark Mode Foundation**: Muted dark background (#0E1117)
- **Vibrant Accents**: Neon teal, soft magenta, and cyber yellow gradients
- **Glassmorphism**: Translucent overlays and backdrop blur effects
- **Smooth Animations**: Spring-based transitions and hover effects
- **Typography**: Modern fonts (Geist, Space Grotesk) with clean hierarchy

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

MIT License - see LICENSE file for details