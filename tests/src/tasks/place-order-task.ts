import { AppContext } from '../types/context';
import _ from 'lodash';
import { createChildLogger } from '../utils/logger';
import { AccountsRecord, OrdersRecord } from '../types/database';
import { Keyring } from '@polkadot/api';
import { KeyringPair } from '@polkadot/keyring/types';
import { mnemonicGenerate  } from '@polkadot/util-crypto';
import Bluebird from 'bluebird';
import { createHash } from 'crypto';
import { create } from 'ipfs-http-client';


const logger = createChildLogger({ moduleId: 'place-order-tasks' });

/**
 * main entry funciton for the task
 */
export async function runPlaceOrderTask(
  context: AppContext,
) {
  const accountKrps = await getOrGeneratAccounts(context);

  await generateOrders(context, accountKrps);
}

async function getOrGeneratAccounts(context: AppContext): Promise<KeyringPair[]> {

  const { api, config } = context;
  const placeOrderAccountsNumber = config.chain.placeOrderAccountsNumber;
  let accountKrps: KeyringPair[] = [];

  // Read accounts from DB
  const accounts = await AccountsRecord.findAll({ where: { type: 'order-placer' } });

  // No accounts in DB, generate new accounts
  const kr = new Keyring({ type: 'sr25519' });
  kr.setSS58Format(66);
  if (accounts.length == 0) {
    let generatedAccounts = [];
    for (let i = 0; i < placeOrderAccountsNumber; i++) {
        const mnemonic = mnemonicGenerate();
        const pair = kr.addFromUri(mnemonic);
        generatedAccounts.push({ 
          address: pair.address, 
          mnemonic, 
          type: 'order-placer' 
        });
        logger.debug(`Generate krp: '${pair.address}'-'${mnemonic}'`);

        accountKrps.push(pair);
    }

    // Transfer 1000 CRU from Alice to these generated accounts
    const aliceKrp = kr.addFromUri('//Alice');
    for (const account of generatedAccounts) {
      await api.transferTokens(aliceKrp, account.address, 1_000_000_000_000_000);
      logger.debug(`Transferred 1000 CRU to ${account.address}`);
    }

    // Save the generated accounts to DB
    await AccountsRecord.bulkCreate(generatedAccounts);
  } else {
    // Create the KeyringPair if accounts have already been created
    for (const account of accounts) {
      const pair = kr.addFromUri(account.mnemonic);
      accountKrps.push(pair);
    }
  }
  
  return accountKrps;
}

async function generateOrders(context: AppContext, accountKrps: KeyringPair[]) {

  const { api, config } = context;
  const placeOrderFrequency = config.chain.placeOrderFrequency;

  while(true) {
    try {
      // Sleep a while
      await Bluebird.delay(1 * 1000);

      // 1. Select random account
      const randomIndex = Math.floor(Math.random() * accountKrps.length);
      const krp = accountKrps[randomIndex];
      logger.debug(`Selected account: ${krp.address}`);

      // 2. Generate random file content with random file size (10B ~ 1MB)
      const randomFileSize = Math.floor(Math.random() * (1024 * 1024 - 10 + 1) + 10); // 10B to 1MB;
      logger.debug(`Generating random file content with size: ${randomFileSize}`);
      const fileContent = createHash('sha256').update(Math.random().toString()).digest('hex').repeat(randomFileSize / 64).slice(0, randomFileSize);

      // 3. Upload to IPFS
      logger.debug(`Uploading file to IPFS...`);
      const { cid, size } = await uploadToIPFS(fileContent, krp);
      logger.debug(`Uploaded file to IPFS, cid: ${cid}, size: ${size}`);

      // 4. Place storage order to crust
      logger.debug(`Placing storage order to crust...`);
      await api.placeStorageOrder(krp, cid, size);
      logger.debug(`Place storage order to crust successfully`);
      
      // 5. Save order to DB
      await OrdersRecord.create({
        cid,
        file_size: BigInt(size),
        sender: krp.address
      });

      // Wait for the interval
      await Bluebird.delay(placeOrderFrequency * 1000);
    } catch(err) {
      logger.error(`💥 Error to generate orders: ${err}`);
    }
  } 
}

async function uploadToIPFS(fileContent: any, pair: KeyringPair) {

  // Create the crust ipfs gateway client with specified pair
  const sig = pair.sign(pair.address);
  const sigHex = '0x' + Buffer.from(sig).toString('hex');
  const authHeader = Buffer.from(`sub-${pair.address}:${sigHex}`).toString('base64');
  const ipfsRemote = create({
      url: `https://gw.crustfiles.net/api/v0`,
      headers: {
          authorization: `Basic ${authHeader}`
      }
  });

  // Add file to ipfs
  const cid = await ipfsRemote.add(fileContent);

  // Get file status from ipfs
  const fileStat = await ipfsRemote.files.stat("/ipfs/" + cid.path);

  return {
      cid: cid.path,
      size: fileStat.cumulativeSize
  };
}
