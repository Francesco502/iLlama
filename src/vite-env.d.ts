/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FINISH_REASON_DOC_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
