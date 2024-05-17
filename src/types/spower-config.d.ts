export interface ChainConfig {
  account: string;
  endPoint: string;
}

export interface TelemetryConfig {
  endPoint: string;
}

export interface SPowerConfig {
  chain: ChainConfig;
  telemetry: TelemetryConfig;
  dataDir: string;
}
