import { ApiPromise, Keyring, WsProvider } from '@polkadot/api';
import { BlockHash, Header, SignedBlock, DispatchError, } from '@polkadot/types/interfaces';
import { KeyringPair } from '@polkadot/keyring/types';
import { formatError, queryToObj, sleep, } from '../utils';
import { typesBundleForPolkadot, crustTypes } from '@crustio/type-definitions';
import _ from 'lodash';
import { logger } from '../utils/logger';
import { UnsubscribePromise, VoidFn } from '@polkadot/api/types';
import { SubmittableExtrinsic } from '@polkadot/api/promise/types';
import Bluebird from 'bluebird';
import { timeout } from '../utils/promise-utils';
import {ITuple} from '@polkadot/types/types';
import { SPowerConfig } from '../types/spower-config';
import { TxRes } from '../types/chain';

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
  private latestBlock = 0;
  private subLatestHead: VoidFn = null;
  private txLocker = {market: false, swork: false};

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

  async initMetadata() {
    await this.withApiReady();

    const kr = new Keyring({ type: 'sr25519' });
    const aliceKrp = kr.addFromUri('//Alice');

    // swork.setCode
    const tx1 = this.api.tx.swork.setCode('0x69f72f97fc90b6686e53b64cd0b5325c8c8c8d7eed4ecdaa3827b4ff791694c0', 10000000);
    await this.sendTransaction('swork', 'swork.setCode', tx1, aliceKrp);
    
    // swork.registerNewTeePubkey
    const tx2 = this.api.tx.swork.registerNewTeePubkey('0xd4d39c00d78b1c11e6861a92dbb0e2d311cd573c7dc0eabae8335751a0d8b360');
    await this.sendTransaction('swork', 'swork.registerNewTeePubkey', tx2, aliceKrp);

    // swork.setSpowerSuperior
    const tx3 = this.api.tx.swork.setSpowerSuperior('cTHqXgHChchei9XmEaFnm6FCsGods1XA43kbMkyF5UmLTGT9D');
    await this.sendTransaction('swork', 'swork.setSpowerSuperior', tx3, aliceKrp);

    // market.setSpowerSuperior
    const tx4 = this.api.tx.market.setSpowerSuperior('cTHqXgHChchei9XmEaFnm6FCsGods1XA43kbMkyF5UmLTGT9D');
    await this.sendTransaction('market', 'market.setSpowerSuperior', tx4, aliceKrp);

    // market.setEnableMarket
    const tx5 = this.api.tx.market.setEnableMarket(true);
    await this.sendTransaction('market', 'market.setEnableMarket', tx5, aliceKrp);
  }

  async transferTokens(sender: KeyringPair, recipient: string, amount: number) {
    await this.withApiReady();

    const tx = this.api.tx.balances.transfer(recipient, amount);
    await this.sendTransaction('market', 'balances.transfer', tx, sender);
  }

  async placeStorageOrder(sender: KeyringPair, cid: string, fileSize: number) {
    await this.withApiReady();

    const tips = 0;
    const memo = '';
    const tx = this.api.tx.market.placeStorageOrder(cid, fileSize, tips, memo);

    await this.sendTransaction('market', 'market.placeStorageOrder', tx, sender);
  }

  private async sendTransaction(lockName: string, method: string, tx: SubmittableExtrinsic, krp: KeyringPair) {
    let txRes = queryToObj(await this.handleTxWithLock(lockName, async () => this.sendTx(tx, krp)));
    txRes = txRes ? txRes : {status:'failed', details: 'Null txRes'};
    if (txRes.status == 'success') {
      logger.info(`${method} successfully`);
    } else {
      throw new Error(`${method} failed: ${txRes.details}`);
    }
  };

  private async handleTxWithLock(lockName: string, handler: Function) {
    if (this.txLocker[lockName]) {
      return {
        status: 'failed',
        details: 'Tx Locked',
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
