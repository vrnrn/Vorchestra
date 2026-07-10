import type { VorchestraBridge } from '../../shared/contracts';

declare global {
  interface Window {
    vorchestra: VorchestraBridge;
  }
}

export {};
