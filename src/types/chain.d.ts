import BigNumber from 'bignumber.js';

export interface WorkReportsToProcess {
  sworker_anchor: string;
  report_slot: number;
  block_number: number;
  extrinsic_index: number;
  reported_srd_size: bigint;
  reported_files_size: bigint;
  added_files: string;
  deleted_files: string;
}