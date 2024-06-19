
export interface TxRes {
  status?: string;
  message?: string;
  details?: string;
}

export interface Group {
  members: string[];
  allowlist: string[];
}

export interface WorkReport {
  curr_pk: string;
  ab_upgrade_pk: string;
  slot: number;
  slot_hash: string;
  reported_srd_size: bigint;
  reported_files_size: bigint;
  added_files: any[];
  deleted_files: any[];
  reported_srd_root: string;
  reported_files_root: string;
  sig: string;
}

export interface WorkReportOnChain {
  report_slot: number;
  spower: bigint;
  free: bigint;
  reported_files_size: bigint;
  reported_srd_root: string;
  reported_files_root: string;
}