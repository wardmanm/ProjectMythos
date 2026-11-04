// The config module's public API (ARCH-020): machine config, the data directory, and
// secrets. It imports no other module (ARCH-021).
export { defaultDataDir, type DataDirEnv } from './data-dir';
export {
  MACHINE_CONFIG_FILE,
  openConfig,
  type ConfigFs,
  type ConfigState,
  type ConfigStore,
  type OpenConfigOptions,
} from './machine-config';
export { mergeSecrets, redact, resolveSecret } from './secrets';
