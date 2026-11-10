declare module 'svg-to-pdfkit' {
  interface SvgToPdfOptions {
    width?: number;
    height?: number;
    preserveAspectRatio?: string;
    useCSS?: boolean;
    assumePt?: boolean;
    fontCallback?: (family: string, bold: boolean, italic: boolean, fontOptions: unknown) => string;
    imageCallback?: (link: string) => string;
    documentCallback?: (file: string) => unknown;
    warningCallback?: (message: string) => void;
  }
  export default function SVGtoPDF(doc: PDFKit.PDFDocument, svg: string, x?: number, y?: number, options?: SvgToPdfOptions): void;
}
