declare module 'utif' {
  interface IFD {
    width: number
    height: number
    data: ArrayBuffer
    t270?: string | ArrayBuffer // ImageDescription
    t262?: number // PhotometricInterpretation
    t258?: number[] // BitsPerSample
    t277?: number // SamplesPerPixel
    t259?: number // Compression
    [key: string]: any
  }

  export function decode(buffer: ArrayBuffer | Buffer): IFD[]
  export function decodeImage(buffer: ArrayBuffer | Buffer, ifd: IFD): void
}