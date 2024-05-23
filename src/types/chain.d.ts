import BigNumber from 'bignumber.js';

export interface WorkReportsToProcess {
  sworker_anchor: string;
  report_slot: number;
  report_block: number;
  extrinsic_index: number;
  reporter: string;
  owner: string;
  reported_srd_size: bigint;
  reported_files_size: bigint;
  added_files: string;
  deleted_files: string;
}

export interface ReplicaInfo{
  reporter: string;
  owner: string;
  sworker_anchor: string;
  report_slot: number;
  report_block: number;
  valid_at: number;
  is_added: boolean;
}

export interface FileInfo {
  cid: string;
  file_size: bigint;
  replicas: ReplicaInfo[];
}

export interface TxRes {
  status?: string;
  message?: string;
  details?: string;
}