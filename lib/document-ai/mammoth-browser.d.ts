/**
 * Build-ul de browser al lui mammoth e un bundle browserify (CommonJS) fără tipuri
 * proprii. Declarăm doar suprafața folosită de numărarea de pagini din client, în
 * ambele forme în care un bundler poate expune un modul CJS.
 */
declare module "mammoth/mammoth.browser" {
  export type RezultatTextBrut = { value: string; messages: unknown[] }

  export function extractRawText(input: { arrayBuffer: ArrayBuffer }): Promise<RezultatTextBrut>

  const mammoth: {
    extractRawText(input: { arrayBuffer: ArrayBuffer }): Promise<RezultatTextBrut>
  }
  export default mammoth
}
