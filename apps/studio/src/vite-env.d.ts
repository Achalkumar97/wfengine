/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_WFENGINE_API: string | undefined;
  readonly VITE_WFENGINE_API_KEY: string | undefined;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
