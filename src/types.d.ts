declare module 'markdown-it' {
  const MarkdownIt: any
  export default MarkdownIt
}

declare module 'mammoth/mammoth.browser.js' {
  type MammothImage = {
    contentType: string
    readAsArrayBuffer(): Promise<ArrayBuffer>
  }
  const mammoth: {
    convertToHtml(
      input: { arrayBuffer: ArrayBuffer },
      options?: { convertImage?: (image: MammothImage, messages: any[]) => Promise<any[]> },
    ): Promise<{ value: string; messages: any[] }>
    images: {
      imgElement(
        converter: (image: MammothImage, messages: any[]) => Promise<Record<string, string>>,
      ): (image: MammothImage, messages: any[]) => Promise<any[]>
    }
  }
  export default mammoth
}

declare module 'xlsx' {
  export const utils: {
    sheet_to_json(sheet: any, opts?: any): any[][]
    book_new(): any
    aoa_to_sheet(aoa: any[][]): any
    book_append_sheet(wb: any, ws: any, name: string): void
  }
  export function read(data: ArrayBuffer, opts?: any): any
  export function write(wb: any, opts: any): any
}
