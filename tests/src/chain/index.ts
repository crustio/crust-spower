import { ApiPromise, Keyring, WsProvider } from '@polkadot/api';
import { BlockHash, Header, SignedBlock, DispatchError, EventRecord, } from '@polkadot/types/interfaces';
import { KeyringPair } from '@polkadot/keyring/types';
import { cidFromStorageKey, formatError, hexToString, queryToObj, sleep } from '../utils';
import { typesBundleForPolkadot, crustTypes } from '@crustio/type-definitions';
import _ from 'lodash';
import { logger } from '../utils/logger';
import { UnsubscribePromise, VoidFn } from '@polkadot/api/types';
import { SubmittableExtrinsic } from '@polkadot/api/promise/types';
import Bluebird from 'bluebird';
import { timeout } from '../utils/promise-utils';
import {ITuple} from '@polkadot/types/types';
import { SPowerConfig } from '../types/spower-config';
import { FileInfoV2, Group, TxRes, WorkReport, WorkReportOnChain } from '../types/chain';
import { AppContext } from '../types/context';
import { createConfigOps } from '../db/configs';
import { u8aToU8a } from '@polkadot/util';
import { createTypeUnsafe } from '@polkadot/types/create';
import { performance } from 'perf_hooks';

export type Identity = typeof crustTypes.swork.types.Identity;

const KeyMetadataInitialized = 'chain:metadata-initialized';

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
  private latestBlock = 0;
  private subLatestHead: VoidFn = null;
  private txLocker = {market: false, swork: false, balances:false, staking: false};

  constructor(config: SPowerConfig) {
    this.addr = config.chain.endPoint;
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
    await Bluebird.delay(5 * 1000);
    await this.initApi();
    await Bluebird.delay(3 * 1000);
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

  async initMetadata(context: AppContext) {

    const configOp = createConfigOps(context.database);
    const isInitialized = await configOp.readInt(KeyMetadataInitialized);
    if (!_.isNil(isInitialized) && isInitialized == 1) {
      logger.info('⛓ Metadata already initialized, skip it.');
      return;
    }
    logger.info('⛓ Init metadata...');
    
    await this.withApiReady();

    const kr = new Keyring({ type: 'sr25519' });
    kr.setSS58Format(66);
    const aliceKrp = kr.addFromUri('//Alice');
    logger.debug(`alice: ${aliceKrp.address}`);

    // swork.setCode
    const tx1 = this.api.tx.swork.setCode('0x69f72f97fc90b6686e53b64cd0b5325c8c8c8d7eed4ecdaa3827b4ff791694c0', 10000000);
    const sudoTx1 = this.api.tx.sudo.sudo(tx1);
    await this.sendTransaction('swork', 'swork.setCode', sudoTx1, aliceKrp);
    
    // swork.registerNewTeePubkey
    const tx2 = this.api.tx.swork.registerNewTeePubkey('0xd4d39c00d78b1c11e6861a92dbb0e2d311cd573c7dc0eabae8335751a0d8b360');
    const sudoTx2 = this.api.tx.sudo.sudo(tx2);
    await this.sendTransaction('swork', 'swork.registerNewTeePubkey', sudoTx2, aliceKrp);

    // swork.setSpowerSuperior
    const tx3 = this.api.tx.swork.setSpowerSuperior('cTHqXgHChchei9XmEaFnm6FCsGods1XA43kbMkyF5UmLTGT9D');
    const sudoTx3 = this.api.tx.sudo.sudo(tx3);
    await this.sendTransaction('swork', 'swork.setSpowerSuperior', sudoTx3, aliceKrp);

    // market.setSpowerSuperior
    const tx4 = this.api.tx.market.setSpowerSuperior('cTHqXgHChchei9XmEaFnm6FCsGods1XA43kbMkyF5UmLTGT9D');
    const sudoTx4 = this.api.tx.sudo.sudo(tx4);
    await this.sendTransaction('market', 'market.setSpowerSuperior', sudoTx4, aliceKrp);

    // market.setEnableMarket
    const tx5 = this.api.tx.market.setEnableMarket(true);
    const sudoTx5 = this.api.tx.sudo.sudo(tx5);
    await this.sendTransaction('market', 'market.setEnableMarket', sudoTx5, aliceKrp);

    // transfer 1000 CRU to crust-spower account
    await this.transferTokens(aliceKrp, 'cTHqXgHChchei9XmEaFnm6FCsGods1XA43kbMkyF5UmLTGT9D', 1_000_000_000_000_000);

    // Mark as initialized
    await configOp.saveInt(KeyMetadataInitialized, 1);
  }

  async transferTokens(sender: KeyringPair, recipient: string, amount: number) {
    await this.withApiReady();

    const tx = this.api.tx.balances.transfer(recipient, amount);
    await this.sendTransaction('balances', 'balances.transfer', tx, sender);
  }

  async placeStorageOrder(sender: KeyringPair, cid: string, fileSize: number) {
    await this.withApiReady();

    const tips = 0;
    const memo = '';
    const tx = this.api.tx.market.placeStorageOrder(cid, fileSize, tips, memo);

    await this.sendTransaction('market', 'market.placeStorageOrder', tx, sender);
  }

  async getGroup(groupAddress: string): Promise<Group> {
    await this.withApiReady();

    // The value of swork.groups on chain is not Option<> type, so non-exists group will 
    // return a default Group object which is not what we want
    const allGroupEntries = await this.api.query.swork.groups.entries();

    for (const [key, value] of allGroupEntries ) {
      const address = key.toHuman();
      const group = value.toHuman() as any as Group;

      if (address == groupAddress) {
        return group;
      }
    }

    return null;
  }

  async createGroup(group: KeyringPair) {
    await this.withApiReady();

    // Create group
    const tx = this.api.tx.swork.createGroup();
    
    await this.sendTransaction('swork', 'swork.createGroup', tx, group);
  }

  async addMemberToAllowlist(memberAddress: string, groupAccount: KeyringPair) {
    await this.withApiReady();

    const tx = this.api.tx.swork.addMemberIntoAllowlist(memberAddress);

    await this.sendTransaction('swork', 'swork.addMemberIntoAllowList', tx, groupAccount);
  }

  async joinGroup(memberAccount: KeyringPair, groupAddress: string) {
    await this.withApiReady();

    const tx = this.api.tx.swork.joinGroup(groupAddress);

    await this.sendTransaction('swork', 'swork.joinGroup', tx, memberAccount);
  }

  async sworkerRegister(sworkerAccount: KeyringPair, code: string, teePubkey: string) {
    await this.withApiReady();

    const tx = this.api.tx.swork.registerWithDeauthChain(sworkerAccount.address, code, [], [], teePubkey, []);

    await this.sendTransaction('swork', 'swork.registerWithDeauthChain', tx, sworkerAccount);
  }

  async sworkerReportWorks(sworkerAccount: KeyringPair, workReport: WorkReport): Promise<boolean> {
    await this.withApiReady();

    const tx = this.api.tx.swork.reportWorks(
      workReport.curr_pk, workReport.ab_upgrade_pk, workReport.slot, workReport.slot_hash,
      workReport.reported_srd_size, workReport.reported_files_size, workReport.added_files, workReport.deleted_files,
      workReport.reported_srd_root, workReport.reported_files_root, workReport.sig);

    try {
      await this.sendTransaction('swork', 'swork.reportWorks', tx, sworkerAccount);
      return true;
    } catch(err) {
      logger.error(`💥 Error to report works to chain: ${err}`);
    }

    return false;
  }

  async parseNewFilesAndClosedFilesByBlock(
    atBlock: number
  ): Promise<[string[], string[]]> {
    await this.withApiReady();
    try {
      const bh = await this.getBlockHash(atBlock);
      const ers: EventRecord[] = await this.api.query.system.events.at(bh);
      const newFiles: string[] = [];
      const closedFiles: string[] = [];

      for (const {event: { data, method }} of ers) {
        if (method === 'FileSuccess') {
          if (data.length < 2) continue; // data should be like [AccountId, MerkleRoot]
          // Find new successful file order from extrinsincs
          const cid = hexToString(data[1].toString());
          newFiles.push(cid);
        } 
        // else if (method === 'CalculateSuccess') {
        //   if (data.length !== 1) continue; // data should be like [MerkleRoot]

        //   const cid = hexToString(data[0].toString());
        //   const isClosed = (await this.maybeGetFileUsedInfo(cid)) === null;
        //   if (isClosed) {
        //     closedFiles.push(cid);
        //   }
        //} 
        else if (method === 'IllegalFileClosed' || method === 'FileClosed') {
          if (data.length !== 1) continue; // data should be like [MerkleRoot]
          // Add into closed files
          const cid = hexToString(data[0].toString());
          closedFiles.push(cid);
        }
      }

      return [newFiles, closedFiles];
    } catch (err) {
      logger.error(`💥 Parse files error at block(${atBlock}): ${err}`);
      return [[], []];
    }
  }
  
  async getWorkReport(sworkerKey: string): Promise<WorkReportOnChain> {
    await this.withApiReady();

    const value = await this.api.query.swork.workReports(sworkerKey);
    
    if (!value.isEmpty) {
      const workReport = JSON.parse(value.toString()) as WorkReportOnChain;
      return workReport;
    }
    
    return null;
  }

  async getLastSpowerUpdateBlock(): Promise<number> {
    await this.withApiReady();
    
    const block = await this.api.query.swork.lastSpowerUpdateBlock();
    if (block.isEmpty) {
      return 0;
    }
    return parseInt(block as any);   
  }

  async getLastProcessedBlockWorkReports(): Promise<number> {
    await this.withApiReady();
    
    const block = await this.api.query.swork.lastProcessedBlockWorkReports();
    if (_.isNil(block) || block.isEmpty) {
      return 0;
    }
    return parseInt(block as any);   
  }

  async getAllWorkReports(atBlock: number): Promise<Map<string, WorkReportOnChain>> {
    await this.withApiReady();

    const blockHash = await this.getBlockHash(atBlock);
    const allWorkReportsData = await this.api.query.swork.workReports.entriesAt(blockHash);

    const workReportsMap = new Map<string, WorkReportOnChain>();
    for (const entry of allWorkReportsData) {
      const anchor = entry[0].toHuman().toString();
      const workReport = JSON.parse(entry[1].toString())  as WorkReportOnChain;

      workReportsMap.set(anchor, workReport);
    }
    return workReportsMap;
  }

  async getFilesInfoV2(cids: string[], atBlock: number): Promise<Map<string, FileInfoV2>> {

    const startTime = performance.now();
    await this.withApiReady();
    const fileInfoV2Map = new Map<string, FileInfoV2>();
    try {
      const blockHash = await this.getBlockHash(atBlock);

      // Generate the related storage keys
      const storageKeys = [];
      for (const cid of cids) {
        storageKeys.push(this.api.query.market.filesV2.key(cid));
      }

      // Retrieve the FilesInfoV2 data from chain in batch
      const batchSize = 300;
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
            const fileInfoV2Decoded = createTypeUnsafe(registry, 'FileInfoV2', [input], {blockHash, isPedantic: true});

            const fileInfoV2: FileInfoV2 = JSON.parse(fileInfoV2Decoded.toString(), (key, value) => {
              if (key === 'replicas') {
                return new Map(Object.entries(value));
              }
              return value;
            });

            fileInfoV2Map.set(cid, fileInfoV2);
          }
        }
      }
    } catch (err) {
      logger.error(`💥 Error to get files info v2 from chain: ${err}`);
        throw err;
    } finally {
      const endTime = performance.now();
      logger.debug(`End to get ${fileInfoV2Map.size} files info v2 from chain at block '${atBlock}'. Time cost: ${(endTime - startTime).toFixed(2)}ms`);
    }

    return fileInfoV2Map;
  }
  
  private async sendTransaction(lockName: string, method: string, tx: SubmittableExtrinsic, krp: KeyringPair) {
    let txRes = queryToObj(await this.handleTxWithLock(lockName, async () => this.sendTx(tx, krp)));
    txRes = txRes ? txRes : {status:'failed', message: 'Null txRes'};
    if (txRes.status == 'success') {
      logger.info(`${method} successfully`);
    } else {
      throw new Error(`${method} failed: ${txRes.message}`);
    }
  };

  private async handleTxWithLock(lockName: string, handler: Function) {
    do {
      if (this.txLocker[lockName]) {
        logger.debug(`Lock '${lockName}' is locked, wait a while and check later`);
        await sleep(1000);
      } else {
        break;
      }
    } while(true);

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

  private async sendTx(tx: SubmittableExtrinsic, krp: KeyringPair) {
    return new Promise((resolve, reject) => {
      tx.signAndSend(krp, ({events = [], status}) => {
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
