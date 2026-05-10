/**
 * Ambient type declarations for Tampermonkey's GM API.
 * Only the methods granted in the userscript header are declared here.
 * @see https://www.tampermonkey.net/documentation.php
 */
declare const GM: {
  getValue(key: string, defaultValue?: string): Promise<string | undefined>
  setValue(key: string, value: string): Promise<void>
  info: {
    script: {
      name: string
      version: string
      description: string
      author: string
    }
  }
}
