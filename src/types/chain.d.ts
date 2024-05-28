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

export interface ReplicaToUpdate{
  reporter: string;
  owner: string;
  sworker_anchor: string;
  report_slot: number;
  report_block: number;
  valid_at: number;
  is_added: boolean;
}

export interface FileToUpdate {
  cid: string;
  file_size: bigint;
  replicas: ReplicaToUpdate[];
}

export interface TxRes {
  status?: string;
  message?: string;
  details?: string;
}

export interface UpdatedFileToProcess {
  cid: string;
  actual_added_replicas: ReplicaToUpdate[];
  actual_deleted_replicas: ReplicaToUpdate[];
}
