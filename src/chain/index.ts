import { ApiPromise, Keyring, WsProvider } from '@polkadot/api';
import { BlockHash, Header, SignedBlock, DispatchError } from '@polkadot/types/interfaces';
import { KeyringPair } from '@polkadot/keyring/types';
import { formatError, parseObj, queryToObj, sleep } from '../utils';
import { typesBundleForPolkadot, crustTypes } from '@crustio/type-definitions';
import _ from 'lodash';
import { SLOT_LENGTH } from '../utils/consts';
import { logger } from '../utils/logger';
import { UnsubscribePromise, VoidFn } from '@polkadot/api/types';
import { SubmittableExtrinsic } from '@polkadot/api/promise/types';
import Bluebird from 'bluebird';
import { UpdatedFileToProcess, TxRes, WorkReportsToProcess, FileToUpdate } from '../types/chain';
import { timeout } from '../utils/promise-utils';
import { ITuple } from '@polkadot/types/types';
import { WorkReportsToProcessRecord } from '../types/database';


export type Identity = typeof crustTypes.swork.types.Identity;
export type FileInfoV2 = typeof crustTypes.market.types.FileInfoV2;

// TODO: Move the definition to crust.js lib
const customTypes = {
  WorkReportMetadata: {
    report_block: 'BlockNumber',
    extrinsic_index: 'u32',
    reporter: 'AccountId',
    owner: 'AccountId'
  }
}

export default class CrustApi {
  private readonly addr: string;
  private api!: ApiPromise;
  private readonly chainAccount: string;
  private readonly krp: KeyringPair;
  private latestBlock = 0;
  private subLatestHead: VoidFn = null;
  private txLocker = {market: false, swork: false};

  constructor(addr: string, chainAccount: string, backup: string, password: string) {
    this.addr = addr;
    this.chainAccount = chainAccount;

    const kr = new Keyring({ type: 'sr25519' });
    this.krp = kr.addFromJson(JSON.parse(backup));
    this.krp.decodePkcs8(password);
  }

  async initApi(): Promise<void> {
    if (this.api && this.api.disconnect) {
      this.api.disconnect().then().catch();
    }
    if (this.subLatestHead) {
      this.subLatestHead();
    }

    this.api = new ApiPromise({
      provider: new WsProvider(this.addr),
      types: customTypes,
      typesBundle: typesBundleForPolkadot,
    });

    await this.api.isReady;
    while (!this.api.isConnected) {
      logger.info('waiting for api to connect');
      await Bluebird.delay(1000);
    }

    this.subLatestHead = await this.api.rpc.chain.subscribeFinalizedHeads(
      (head: Header) => {
        this.latestBlock = head.number.toNumber();
      },
    );
  }

  // stop this api instance
  async stop(): Promise<void> {
    if (this.subLatestHead) {
      this.subLatestHead();
    }
    if (this.api) {
      const api = this.api;
      this.api = null;
      if (api.disconnect) {
        await api.disconnect();
      }
    }
  }

  // reconnect this api instance
  async reconnect(): Promise<void> {
    await this.stop();
    await Bluebird.delay(30 * 1000);
    await this.initApi();
    await Bluebird.delay(10 * 1000);
  }

  isConnected(): boolean {
    return this.api.isConnected;
  }

  latestFinalizedBlock(): number {
    return this.latestBlock;
  }

  async getBlockByNumber(blockNumber: number): Promise<SignedBlock> {
    const hash = await this.getBlockHash(blockNumber);
    const block = await this.api.rpc.chain.getBlock(hash);
    return block;
  }

  async getBlockHash(blockNumber: number): Promise<BlockHash> {
    return this.api.rpc.chain.getBlockHash(blockNumber);
  }

  chainApi(): ApiPromise {
    return this.api;
  }

  /// READ methods
  /**
   * Register a pubsub event, dealing with new block
   * @param handler handling with new block
   * @returns unsubscribe signal
   * @throws ApiPromise error
   */
  async subscribeNewHeads(handler: (b: Header) => void): UnsubscribePromise {
    // Waiting for API
    while (!(await this.withApiReady())) {
      logger.info('⛓ Connection broken, waiting for chain running.');
      await sleep(6000); // IMPORTANT: Sequential matters(need give time for create ApiPromise)
      this.initApi(); // Try to recreate api to connect running chain
    }

    // Waiting for chain synchronization
    while (await this.isSyncing()) {
      logger.info(
        `⛓ Chain is synchronizing, current block number ${(
          await this.header()
        ).number.toNumber()}`,
      );
      await sleep(6000);
    }

    // Subscribe finalized event
    return await this.api.rpc.chain.subscribeFinalizedHeads((head: Header) =>
      handler(head),
    );
  }

  /**
   * Used to determine whether the chain is synchronizing
   * @returns true/false
   */
  async isSyncing(): Promise<boolean> {
    const health = await this.api.rpc.system.health();
    let res = health.isSyncing.isTrue;

    if (!res) {
      const h_before = await this.header();
      await sleep(3000);
      const h_after = await this.header();
      if (h_before.number.toNumber() + 1 < h_after.number.toNumber()) {
        res = true;
      }
    }

    return res;
  }

  async waitForNextBlock(): Promise<void> {
    const h_before = await this.header();

    do {
      await sleep(3000);
      const h_after = await this.header();
      if (h_after.number.toNumber()> h_before.number.toNumber()) {
        return;
      }
    } while(true);
  }
  /**
   * Get best block's header
   * @returns header
   */
  async header(): Promise<Header> {
    return this.api.rpc.chain.getHeader();
  }

  /**
   * Get chain account
   * @returns string
   */
  getChainAccount(): string {
    return this.chainAccount;
  }

  /**
   * Get sworker identity
   * @returns Identity or Null
   */
  async sworkIdentity(): Promise<Identity | null> {
    const identity = await this.api.query.swork.identities(this.chainAccount);
    if (identity.isEmpty) {
      return null;
    }
    return identity.toJSON() as Identity;
  }

  /**
   * Get all validators count
   * @returns Count
   */
  async validatorsCount(): Promise<number> {
    const vs = await this.api.query.staking.validators.entries();
    return vs.length;
  }

  /**
   * Get all work reports
   * @returns The array of work report
   */
  async workReportsAll(): Promise<unknown> {
    return parseObj(await this.api.query.swork.workReports.entries());
  }

  /**
   * Get current report slot
   * @returns Current report slot
   */
  async currentReportSlot(): Promise<number> {
    return parseObj(await this.api.query.swork.currentReportSlot());
  }

  /**
   * Get all node count
   * @returns All node count
   */
  async getAllNodeCount(): Promise<number> {
    const currentSlot = await this.currentReportSlot();
    const workReports = await this.workReportsAll();
    let validReports = [];
    if (_.isArray(workReports)) {
      const realReports = _.map(workReports, (e) => {
        return e[1];
      });
      validReports = _.filter(realReports, (e) => {
        return e.report_slot >= currentSlot - SLOT_LENGTH;
      });
    }
    return validReports.length;
  }

  /**
   * Get group members
   * @param groupOwner owner's account id
   * @returns members(or empty vec)
   */
  async groupMembers(groupOwner: string): Promise<string[]> {
    try {
      const data = await this.api.query.swork.groups(groupOwner);
      if (data.isEmpty) {
        return [];
      }
      return (data.toJSON() as any).members as string[]; // eslint-disable-line
    } catch (e) {
      logger.error(`💥 Get group member error: ${e}`);
      return [];
    }
  }

  /**
   * Trying to get work reports to process from the latest block
   * @returns Vec<WorkReportsToProcess>
   * @throws ApiPromise error or type conversing error
   */
  async getWorkReportsToProcess(): Promise<WorkReportsToProcess[]> {

    let startTime = performance.now();
    logger.info(`Start to get work reports from chain`);
    await this.withApiReady();
    try {
      // Get all the entries from the latest block
      const wrsToProcessChain = await this.api.query.swork.workReportsToProcess.entries();
      logger.info(`Work Reports to process: ${wrsToProcessChain.length}`);

      let workReportsToProcess = [];
      // workReportsToProcess is defined in the chain as double map (sworkerAnchor, reportSlot) => (blockNumber, extrinsicIndex, reporter,) 
      for (const [{args: [sworkerAnchor, reportSlot]}, value] of wrsToProcessChain){
          let workReportMetadata = value as any;
          const report_block = workReportMetadata.report_block;
          const exIdx = workReportMetadata.extrinsic_index;
          const reporter = workReportMetadata.reporter;
          const owner = workReportMetadata.owner;
          // logger.debug(`${sworkerAnchor}: ${reportSlot} - {blockNumber: ${blockNumber}, exIdx: ${exIdx}, reporter: ${reporter}, owner: ${owner}`);

          const blockHash = await this.api.rpc.chain.getBlockHash(report_block);
          const blockForWorkReport = await this.api.rpc.chain.getBlock(blockHash);

          let exFound = false;
          blockForWorkReport.block.extrinsics.forEach((extrinsic, index) => {
              if (index == exIdx) {
                  exFound = true;

                  // Check the sworker::report_works extrinsic call arguments structure
                  const { method: { args } } = extrinsic;
                  const reported_srd_size = args[4];
                  const reported_files_size = args[5];
                  const added_files = args[6];
                  const deleted_files = args[7];

                  let workReport = {
                      sworker_anchor: sworkerAnchor.toString(),
                      report_slot: reportSlot,
                      report_block: report_block,
                      extrinsic_index: exIdx,
                      reporter: reporter.toString(),
                      owner: owner.toString(),
                      reported_srd_size: reported_srd_size ? reported_srd_size : 0,
                      reported_files_size: reported_files_size ? reported_files_size : 0,
                      added_files: added_files ? added_files : [],
                      deleted_files: deleted_files ? deleted_files : []
                  };

                  workReportsToProcess.push(workReport);
                  // logger.debug(`workReport: ${JSON.stringify({section: section, method: method, args: {...workReport}})}`);
              }
          });

          if (!exFound) {
            logger.error(`💥 Extrinsic data not found for blockNumber: ${report_block}, exIdx: ${exIdx}. The connected chain node may not be an archive node!!!`);
          }
      }

      return workReportsToProcess;
    } catch (err) {
      logger.error(`💥 Error to query work reports from chain: ${err}`);
      return [];
    } finally {
      let endTime = performance.now();
      logger.info(`End to get work reports from chain. Time cost: ${(endTime - startTime).toFixed(2)}ms`);
    }
  }

  async updateReplicas(filesInfoMap: Map<string, FileToUpdate>, workReports: WorkReportsToProcessRecord[]): Promise<boolean> {

    if (filesInfoMap === null || filesInfoMap.size === 0) {
      return false;
    }

    let startTime = performance.now();
    logger.info(`Start to update replicas data to chain`);

    await this.withApiReady();
    try {
      // Construct the transaction body data
      let fileInfoMapBody = [];
      let workReportsBody = [];
      filesInfoMap.forEach((fileInfo, cid) => {
        const entry = [cid, fileInfo.file_size, fileInfo.replicas];
        fileInfoMapBody.push(entry);
      });
      workReports.forEach(wr => {
        const entry = [wr.sworker_anchor, wr.report_slot];
        workReportsBody.push(entry);
      });
      logger.debug(`fileInfoMapBody: ${JSON.stringify(fileInfoMapBody)}`);
      logger.debug(`workReportsBody: ${JSON.stringify(workReportsBody)}`);

      // Construct the transaction object
      const tx = this.api.tx.market.updateReplicas(fileInfoMapBody, workReportsBody); 

      // Send the transaction
      let txRes = queryToObj(await this.handleMarketTxWithLock(async () => this.sendTx(tx)));
      txRes = txRes ? txRes : {status:'failed', details: 'Null txRes'};
      if (txRes.status == 'success') {
        logger.info(`Update relicas data to chain successfully`);
        return true;
      }
      else {
        logger.error(`Failled to update replicas data to chain: ${txRes.details}`);
        return false;
      }
    } catch (err) {
      logger.error(`💥 Error to update replicas data to chain: ${err}`);
    } finally {
      let endTime = performance.now();
      logger.info(`End to update replicas data to chain. Time cost: ${(endTime - startTime).toFixed(2)}ms`);
    }

    return false;
  }

  async getUpdatedFilesToProcess(): Promise<Map<number, UpdatedFileToProcess[]>> {

    let startTime = performance.now();
    logger.info(`Start to get updated files from chain`);
    await this.withApiReady();
    try {
      // Get all the entries from the latest block
      const updatedFilesToProcessChain = await this.api.query.market.updatedFilesToProcess.entries();
      logger.info(`Updated Files to process: ${updatedFilesToProcessChain.length}`);

      let updatedFilesMap = new Map<number, UpdatedFileToProcess[]>();
      // updatedFilesToProcess is defined in the chain as map (update_block) => Vec<{cid, actual_added_replicas, actual_deleted_replicas}> 
      for (const [{args: [updateBlock] }, value] of updatedFilesToProcessChain){
          logger.debug(`updatedFileInfo: ${updateBlock} - ${value}`);
          let updatedFiles = JSON.parse(value as any) as UpdatedFileToProcess[];

          updatedFilesMap.set(updateBlock as any, updatedFiles);
      }

      return updatedFilesMap;
    } catch (err) {
      logger.error(`💥 Error to get updated files from chain: ${err}`);
      return null;
    } finally {
      let endTime = performance.now();
      logger.info(`End to get updated files from chain. Time cost: ${(endTime - startTime).toFixed(2)}ms`);
    }
  }

  async getFilesInfoV2(cids: string[], at_block: number): Promise<Map<string, FileInfoV2>> {

    let startTime = performance.now();
    logger.info(`Start to get files info v2 from chain`);
    await this.withApiReady();
    try {
      const apiAt = await this.api.at(await this.getBlockHash(at_block));

      /// ----------------------------------------------------
      /// TODO: Implement a batch query runtime API later and get data in batch instead of one by one for better performance
      let filesInfoV2 = new Map<string, FileInfoV2>();
      for (const cid of cids) {
        const fileInfoV2FromChain = await apiAt.query.market.FilesV2(cid);
        logger.debug(`fileInfoV2FromChain: ${fileInfoV2FromChain}`);

        filesInfoV2.set(cid, fileInfoV2FromChain as any);
      }

      return filesInfoV2;
    } catch (err) {
      logger.error(`💥 Error to get files info v2 from chain: ${err}`);
      return null;
    } finally {
      let endTime = performance.now();
      logger.info(`End to get files info v2 from chain. Time cost: ${(endTime - startTime).toFixed(2)}ms`);
    }
  }

  private async handleMarketTxWithLock(handler: Function) {
    if (this.txLocker.market) {
      return {
        status: 'failed',
        details: 'Tx Locked',
      };
    }

    try {
      this.txLocker.market = true;
      return await timeout(
        new Promise((resolve, reject) => {
          handler().then(resolve).catch(reject);
        }),
        7 * 60 * 1000, // 7 min, for valid till checking
        null
      );
    } finally {
      this.txLocker.market = false;
    }
  }

  private async sendTx(tx: SubmittableExtrinsic) {
    return new Promise((resolve, reject) => {
      tx.signAndSend(this.krp, ({events = [], status}) => {
        logger.info(
          `  ↪ 💸 [tx]: Transaction status: ${status.type}, nonce: ${tx.nonce}`
        );

        if (status.isInvalid || status.isDropped || status.isUsurped) {
          reject(new Error(`${status.type} transaction.`));
        } else {
          // Pass it
        }

        if (status.isInBlock) {
          events.forEach(({event: {data, method, section}}) => {
            if (section === 'system' && method === 'ExtrinsicFailed') {
              const [dispatchError] = data as unknown as ITuple<[DispatchError]>;
              const result: TxRes = {
                status: 'failed',
                message: dispatchError.type,
              };
              // Can get detail error info
              if (dispatchError.isModule) {
                const mod = dispatchError.asModule;
                const error = this.api.registry.findMetaError(
                  new Uint8Array([mod.index.toNumber(), mod.error.toNumber()])
                );
                result.message = `${error.section}.${error.name}`;
                result.details = error.documentation.join('');
              }

              logger.info(
                `  ↪ 💸 ❌ [tx]: Send transaction(${tx.type}) failed with ${result.message}.`
              );
              resolve(result);
            } else if (method === 'ExtrinsicSuccess') {
              const result: TxRes = {
                status: 'success',
              };

              logger.info(
                `  ↪ 💸 ✅ [tx]: Send transaction(${tx.type}) success.`
              );
              resolve(result);
            }
          });
        } else {
          // Pass it
        }
      }).catch(e => {
        reject(e);
      });
    });
  }

  public async ensureConnection(): Promise<void> {
    if (!(await this.withApiReady())) {
      logger.info('⛓ Connection broken, waiting for chain running.');
      await Bluebird.delay(6000); // IMPORTANT: Sequential matters(need give time for create ApiPromise)
      await this.initApi(); // Try to recreate api to connect running chain
    }
  }

  // TODO: add more error handling here
  private async withApiReady(): Promise<boolean> {
    try {
      await this.api.isReadyOrError;
      return true;
    } catch (e) {
      logger.error(`💥 Error connecting with Chain: %s`, formatError(e));
      return false;
    }
  }
}
