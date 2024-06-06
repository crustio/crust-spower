export interface ChainConfig {
  account: string;
  endPoint: string;
  backup: string;
  password: string;
  workReportsProcessorInterval: number;
  workReportsProcesserBatchSize: number;
  filesV2SyncBatchSize: number;
  filesV2IndexAllKeyBatchSize: number;
  filesV2IndexChangedSyncInterval: number;
  spowerReadyPeriod: number;
  spowerCalculateBatchSize: number;
}

export interface TelemetryConfig {
  endPoint: string;
}

export interface SPowerConfig {
  chain: ChainConfig;
  telemetry: TelemetryConfig;
  dataDir: string;
}
