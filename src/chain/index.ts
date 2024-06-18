import { ApiPromise, Keyring, WsProvider } from '@polkadot/api';
import { BlockHash, Header, SignedBlock, DispatchError, Extrinsic, EventRecord } from '@polkadot/types/interfaces';
import { KeyringPair } from '@polkadot/keyring/types';
import { cidFromStorageKey, formatError, hexToString, parseObj, queryToObj, sleep, stringToHex } from '../utils';
import { typesBundleForPolkadot, crustTypes } from '@crustio/type-definitions';
import _ from 'lodash';
import { SLOT_LENGTH } from '../utils/consts';
import { logger } from '../utils/logger';
import { UnsubscribePromise, VoidFn } from '@polkadot/api/types';
import { SubmittableExtrinsic } from '@polkadot/api/promise/types';
import Bluebird from 'bluebird';
import { TxRes, WorkReportsToProcess, FileToUpdate, FileInfoV2, ChangedFileInfo } from '../types/chain';
import { timeout } from '../utils/promise-utils';
import {ITuple} from '@polkadot/types/types';
import { SPowerConfig } from '../types/spower-config';
import { u8aToU8a } from '@polkadot/util';
import { createTypeUnsafe } from '@polkadot/types/create';

export type Identity = typeof crustTypes.swork.types.Identity;

// TODO: Move the definition to crust.js lib
const customTypes = {
  ReplicaToUpdate: {
    reporter: 'AccountId',
    owner: 'AccountId',
    sworker_anchor: 'SworkerAnchor',
    report_slot: 'ReportSlot',
    report_block: 'BlockNumber',
    valid_at: 'BlockNumber',
    is_added: 'bool'
  },
  UpdatedFileInfoOf: {
    cid: 'MerkleRoot',
    actual_added_replicas: 'Vec<ReplicaToUpdate<AccountId>>',
    actual_deleted_replicas: 'Vec<ReplicaToUpdate<AccountId>>'
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
  private config: SPowerConfig;

  constructor(config: SPowerConfig) {
    this.config = config;

    this.addr = config.chain.endPoint;
    this.chainAccount = config.chain.account;

    const kr = new Keyring({ type: 'sr25519' });
    this.krp = kr.addFromJson(JSON.parse(config.chain.backup));
    this.krp.decodePkcs8(config.chain.password);
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

  async getLastProcessedBlockWorkReports(): Promise<number> {
    await this.withApiReady();
    
    const block = await this.api.query.swork.lastProcessedBlockWorkReports();
    if (_.isNil(block) || block.isEmpty) {
      return 0;
    }
    return parseInt(block as any);   
  }

  /**
   * Trying to get work reports to process at the specific block
   * @returns Vec<WorkReportsToProcess>
   * @throws ApiPromise error or type conversing error
   */
  async getWorkReportsToProcess(atBlock: number): Promise<WorkReportsToProcess[]> {

    let startTime = performance.now();
    await this.withApiReady();
    let workReportsToProcess = [];
    try {
      const hash = await this.getBlockHash(atBlock);
      const block = await this.api.rpc.chain.getBlock(hash);
      const exs: Extrinsic[] = block.block.extrinsics;
      const events: EventRecord[] = await this.api.query.system.events.at(hash);

      for (const {event: { data, method },phase} of events) {
        if (method === 'QueueWorkReportSuccess') {
          // Get the corresponding extrinsic data
          const exIdx = phase.asApplyExtrinsic.toNumber();
          const extrinsic = exs[exIdx];
          // Check the sworker::report_works extrinsic call arguments structure
          const { method: { args } } = extrinsic;
          const report_slot = args[2];
          const reported_srd_size = args[4];
          const reported_files_size = args[5];
          const added_files = args[6];
          const deleted_files = args[7];

          // Get data from the event body
          const sworkerAnchor = data[0];
          const reporter = data[1];
          const owner = data[2];

          let workReport: WorkReportsToProcess = {
              sworker_anchor: sworkerAnchor.toString(),
              report_slot: parseObj(report_slot),
              report_block: atBlock,
              extrinsic_index: exIdx,
              reporter: reporter.toString(),
              owner: owner.toString(),
              reported_srd_size: reported_srd_size ? parseObj(reported_srd_size): BigInt(0),
              reported_files_size: reported_files_size ? parseObj(reported_files_size) : BigInt(0),
              added_files: added_files ? parseObj(added_files) : [],
              deleted_files: deleted_files ? parseObj(deleted_files) : []
          };

          workReportsToProcess.push(workReport);
        }
      }
    } catch (err) {
      logger.error(`💥 Error to query work reports from chain: ${err}`);
    } finally {
      let endTime = performance.now();
      logger.debug(`End to get ${workReportsToProcess.length} work reports from chain at block '${atBlock}'. Time cost: ${(endTime - startTime).toFixed(2)}ms`);
    }
    
    return workReportsToProcess;
  }

   async getLastReplicasUpdateBlock(): Promise<number> {
    await this.withApiReady();
    
    const block = await this.api.query.market.lastReplicasUpdateBlock();
    if (_.isNil(block) || block.isEmpty) {
      return 0;
    }
    return parseInt(block as any);   
  }
  
  async getReplicasUpdatedFiles(atBlock: number): Promise<string[]> {
    let startTime = performance.now();
    await this.withApiReady();
    let cids = [];
    try {
      const hash = await this.getBlockHash(atBlock);
      const block = await this.api.rpc.chain.getBlock(hash);
      const exs: Extrinsic[] = block.block.extrinsics;
      const events: EventRecord[] = await this.api.query.system.events.at(hash);

      for (const {event: { method },phase} of events) {
        if (method === 'UpdateReplicasSuccess') {
          // There is a successful market::update_replicas extrinsic call in this block
          // Get the corresponding extrinsic data
          const exIdx = phase.asApplyExtrinsic.toNumber();
          const extrinsic = exs[exIdx];
          // Check the market::update_replicas extrinsic call arguments structure
          const { method: { args } } = extrinsic;
          const file_infos_map = args[0] as any; // as [[string, bigint, []]]
          for (const [cid, _file_size, _replicas_to_update] of file_infos_map) {
            cids.push(hexToString(cid.toString()));
          }
        }
      }
    } catch (err) {
      logger.error(`💥 Error to get replicas updated files from chain: ${err}`);
      throw err;
    } finally {
      let endTime = performance.now();
      logger.debug(`End to get ${cids.length} updated files from chain at block '${atBlock}'. Time cost: ${(endTime - startTime).toFixed(2)}ms`);
    }

    return cids;
  }

  async getClosedFiles(atBlock: number): Promise<string[]> {
    let startTime = performance.now();
    await this.withApiReady();
    let cids = [];
    try {
      const hash = await this.getBlockHash(atBlock);
      const events: EventRecord[] = await this.api.query.system.events.at(hash);

      for (const {event: { data, method }} of events) {
        if (method === 'FileClosed' || method === 'IllegalFileClosed') {
          // Get data from the event body
          const cid = hexToString(data[0].toString());
          cids.push(cid);
        }
      }
    } catch (err) {
      logger.error(`💥 Error to get closed files from chain: ${err}`);
      throw err;
    } finally {
      let endTime = performance.now();
      logger.debug(`End to get ${cids.length} closed files from chain at block '${atBlock}'. Time cost: ${(endTime - startTime).toFixed(2)}ms`);
    }

    return cids;
  }
  

  async getFilesInfoV2(cids: string[], atBlock: number): Promise<Map<string, FileInfoV2>> {

    let startTime = performance.now();
    await this.withApiReady();
    let fileInfoV2Map = new Map<string, FileInfoV2>();
    try {
      const blockHash = await this.getBlockHash(atBlock);

      // Generate the related storage keys
      let storageKeys = [];
      for (const cid of cids) {
        storageKeys.push(this.api.query.market.filesV2.key(cid));
      }

      // Retrieve the FilesInfoV2 data from chain in batch
      const batchSize = this.config.chain.filesV2SyncBatchSize;
      logger.debug(`Total files count need to query: ${storageKeys.length}, query in batch size: ${batchSize}`);
      for (let i = 0; i < storageKeys.length; i += batchSize) {
        const storageKeysInBatch = storageKeys.slice(i, i + batchSize);
        logger.debug(`Batch ${i+1}: ${storageKeysInBatch.length} files`);

        const fileInfoV2MapFromChain = await this.api.rpc.state.queryStorageAt(storageKeysInBatch, blockHash) as any;

        for (let index = 0; index < fileInfoV2MapFromChain.length; index++) {
          const cid = cidFromStorageKey(storageKeysInBatch[index]);
          const filesInfoV2Codec = fileInfoV2MapFromChain[index];
          if (!_.isNil(filesInfoV2Codec) && !filesInfoV2Codec.isEmpty) {
            // Decode the Codec to FileInfoV2 object 
            const input = u8aToU8a(filesInfoV2Codec.value);
            const registry = filesInfoV2Codec.registry;
            const fileInfoV2 = createTypeUnsafe(registry, 'FileInfoV2', [input], {blockHash, isPedantic: true});

            fileInfoV2Map.set(cid, fileInfoV2 as any);
          }
        }
      }
    } catch (err) {
      logger.error(`💥 Error to get files info v2 from chain: ${err}`);
        throw err;
    } finally {
      let endTime = performance.now();
      logger.debug(`End to get ${fileInfoV2Map.size} files info v2 from chain at block '${atBlock}'. Time cost: ${(endTime - startTime).toFixed(2)}ms`);
    }

    return fileInfoV2Map;
  }

  async updateReplicas(filesInfoMap: Map<string, FileToUpdate>, lastProcessedBlockWrs: number): Promise<boolean> {

    if (filesInfoMap === null || filesInfoMap.size === 0) {
      return false;
    }

    let startTime = performance.now();
    await this.withApiReady();
    try {
      // Construct the transaction body data
      let fileInfoMapBody = [];
      filesInfoMap.forEach((fileInfo, cid) => {
        const entry = [cid, fileInfo.file_size, fileInfo.replicas.map((replica) =>{
          return [replica.reporter, replica.owner, replica.sworker_anchor, replica.report_slot, replica.report_block, replica.valid_at, replica.is_added];
        })];
        fileInfoMapBody.push(entry);
      });

      // Construct the transaction object
      const tx = this.api.tx.market.updateReplicas(fileInfoMapBody, lastProcessedBlockWrs); 

      // Send the transaction
      let txRes = queryToObj(await this.handleTxWithLock('market', async () => this.sendTx(tx)));
      txRes = txRes ? txRes : {status:'failed', message: 'Null txRes'};
      if (txRes.status == 'success') {
        logger.info(`Update relicas data to chain successfully`);
        return true;
      }
      else {
        logger.error(`Failled to update replicas data to chain: ${txRes.message}`);
        return false;
      }
    } catch (err) {
      logger.error(`💥 Error to update replicas data to chain: ${err}`);
    } finally {
      let endTime = performance.now();
      logger.debug(`End to update replicas data to chain. Time cost: ${(endTime - startTime).toFixed(2)}ms`);
    }

    return false;
  }

   async getLastSpowerUpdateBlock(): Promise<number> {
    await this.withApiReady();
    
    const block = await this.api.query.swork.lastSpowerUpdateBlock();
    if (block.isEmpty) {
      return 0;
    }
    return parseInt(block as any);   
  }

  async updateSpower(
    sworkerChangedSpowerMap: Map<string, bigint>,
    filesChangedMap: Map<string, ChangedFileInfo>,
    ): Promise<boolean> {
    if (_.isNil(sworkerChangedSpowerMap) || _.isNil(filesChangedMap)) {
      return false;
    }

    let startTime = performance.now();
    await this.withApiReady();
    try {
      // Construct the update_spower call arguments body, the argument type is as follows on chain:
      // changed_spowers: 
      //     Vector of (SworkerAnchor, changed_spower_value)
      // changed_files:
      //     Vec<(cid, spower, Vec<(owner, who, anchor, created_at)>)>
      let changed_spowers = [];
      let changed_files = [];
      for (const [anchor, changedSpower] of sworkerChangedSpowerMap) {
        const entry = [anchor, changedSpower];
        changed_spowers.push(entry);
      }
      for (const [cid, changedFileInfo] of filesChangedMap) {
        let replicas_vec = [];
        for (const [owner, replica] of changedFileInfo.replicas) {
          const replica_entry = [owner, replica.who, replica.anchor, replica.created_at];
          replicas_vec.push(replica_entry);
        }
        const file_entry = [stringToHex(cid), changedFileInfo.spower, replicas_vec];
        changed_files.push(file_entry);
      };

      // Create the transaction object
      const tx = this.api.tx.swork.updateSpower(changed_spowers, changed_files); 

      // Send the transaction
      let txRes = queryToObj(await this.handleTxWithLock('swork', async () => this.sendTx(tx)));
      txRes = txRes ? txRes : {status:'failed', message: 'Null txRes'};
      if (txRes.status == 'success') {
        logger.info(`Update spower data to chain successfully`);
        return true;
      }
      else {
        logger.error(`Failled to update spower data to chain: ${txRes.message}`);
        return false;
      }
    } catch (err) {
      logger.error(`💥 Error to update spower data to chain: ${err}`);
    } finally {
      let endTime = performance.now();
      logger.debug(`End to update spower data to chain. Time cost: ${(endTime - startTime).toFixed(2)}ms`);
    }

    return false;
  }

  private async handleTxWithLock(lockName: string, handler: Function) {
    if (this.txLocker[lockName]) {
      return {
        status: 'failed',
        message: 'Tx Locked',
      };
    }

    try {
      this.txLocker[lockName] = true;
      return await timeout(
        new Promise((resolve, reject) => {
          handler().then(resolve).catch(reject);
        }),
        60 * 1000, // 1 min, for valid till checking
        null
      );
    } finally {
      this.txLocker[lockName] = false;
    }
  }

  private async sendTx(tx: SubmittableExtrinsic) {
    return new Promise((resolve, reject) => {
      tx.signAndSend(this.krp, ({events = [], status}) => {
        logger.info(`  ↪ 💸 [tx]: Transaction status: ${status.type}, nonce: ${tx.nonce}`);

        if (status.isInvalid || status.isDropped || status.isUsurped) {
          reject(new Error(`${status.type} transaction.`));
        } else {
          // Pass it
        }

        if (status.isInBlock || status.isFinalized) {
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

            logger.info(`  ↪ 💸 ❌ [tx]: Send transaction(${tx.type}) failed with ${result.message}`);
            resolve(result);
          } else if (method === 'ExtrinsicSuccess') {
            const result: TxRes = {
              status: 'success',
            };

            logger.info(`  ↪ 💸 ✅ [tx]: Send transaction(${tx.type}) success.`);
            resolve(result);
          }
        });
        } else {
          // Pass it
        }
      }).catch(e => {
        logger.error(`Exceptions happens in tx.signAndSend(): ${e}`);
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
