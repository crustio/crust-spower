import { AppContext } from '../types/context';
import _ from 'lodash';
import { createChildLogger } from '../utils/logger';
import { AccountsRecord, GroupMembersRecord, OrdersRecord, SworkerKeysRecord } from '../types/database';
import { Keyring } from '@polkadot/api';
import { KeyringPair } from '@polkadot/keyring/types';
import { mnemonicGenerate, randomAsU8a  } from '@polkadot/util-crypto';
import { assert } from 'console';
import { u8aToHex } from '@polkadot/util';


const logger = createChildLogger({ moduleId: 'sworker-simulator-tasks' });
const SWORKER_CODE = '0x69f72f97fc90b6686e53b64cd0b5325c8c8c8d7eed4ecdaa3827b4ff791694c0';

/**
 * main entry funciton for the task
 */
export async function runSworkerSimulatorTask(
  context: AppContext,
) {
  const { config } = context;

  // Get or generate group accounts
  const groupAccounts = await getOrGeneratAccounts(context, 'group', config.chain.groupAccountsNumber);
  logger.debug(`groupAccounts: ${groupAccounts.size}`);

  // Get or generate sworker accounts
  const sworkerAccounts = await getOrGeneratAccounts(context, 'sworker', config.chain.sworkerAccountsNumber);
  logger.debug(`sworkerAccounts: ${sworkerAccounts.size}`);

  // Get or generate sworker tee_pubkeys
  const sworkerKeys = await getOrGenerateTeePubkeys(context, [...sworkerAccounts.keys()]);

  // Get or generate group/sworker relationships
  const groupMembers = await getOrGenerateGroupAndSworkerMap(context, [...groupAccounts.keys()], [...sworkerAccounts.keys()]);
  logger.debug(`groupMembersMap: ${groupMembers.size}`);

  // Configure group and sworker accounts
  logger.debug(`Configure group and sworker accounts`);
  await configureGroupAndSworkers(context, groupAccounts, sworkerAccounts, groupMembers, sworkerKeys);
  
  // Generate orders
  logger.debug(`Start to generate orders...`);
  //await generateOrders(context, sworkerAccounts, groupMembersMap);
}

async function getOrGeneratAccounts(context: AppContext, type: string, count: number): Promise<Map<string, KeyringPair>> {

  const { api } = context;
  let accountKrps = new Map<string, KeyringPair>();

  // Read accounts from DB
  const accounts = await AccountsRecord.findAll({ where: { type: type } });

  // No accounts in DB, generate new accounts
  const kr = new Keyring({ type: 'sr25519' });
  kr.setSS58Format(66);
  if (accounts.length == 0) {
    let generatedAccounts = [];
    for (let i = 0; i < count; i++) {
        const mnemonic = mnemonicGenerate();
        const pair = kr.addFromUri(mnemonic);
        generatedAccounts.push({ 
          address: pair.address, 
          mnemonic, 
          type
        });
        logger.debug(`Generate krp for '${type}' accounts: '${pair.address}'-'${mnemonic}'`);

        accountKrps.set(pair.address, pair);
    }

    // Transfer 100 CRU from Alice to these generated accounts
    const aliceKrp = kr.addFromUri('//Alice');
    for (const account of generatedAccounts) {
      await api.transferTokens(aliceKrp, account.address, 1_000_000_000_000_000);
      logger.debug(`Transferred 100 CRU to ${account.address}`);
    }

    // Save the generated accounts to DB
    await AccountsRecord.bulkCreate(generatedAccounts);
  } else {
    // Create the KeyringPair if accounts have already been created
    for (const account of accounts) {
      const pair = kr.addFromUri(account.mnemonic);
      accountKrps.set(pair.address, pair);
    }
  }
  
  return accountKrps;
}

async function getOrGenerateTeePubkeys(context: AppContext, sworkerAddresses: string[]): Promise<Map<string, string>> {

    const { database } = context;
    const sworkerKeysMap = new Map<string, string>();

    const sworkerKeysRecords = await SworkerKeysRecord.findAll();
    if (sworkerKeysRecords.length == 0) {

        const sworkerKeysList = [];
        for (const sworkerAddress of sworkerAddresses) {
            const teePubKey = randomAsU8a(64);
            const hexTeePubKey = u8aToHex(teePubKey);
            logger.debug(`sworker: ${sworkerAddress} - hexTeePubKey: ${hexTeePubKey}`);

            const sworkerKey = {
                sworker_address: sworkerAddress,
                tee_pubkey: hexTeePubKey,
            };

            sworkerKeysList.push(sworkerKey);

            sworkerKeysMap.set(sworkerKey.sworker_address, sworkerKey.tee_pubkey);
        }

        // Save to DB
        await database.transaction(async (transaction) => {
            await GroupMembersRecord.bulkCreate(sworkerKeysList, {
                transaction
            });
        });
    } else {
        for (const sworkerKey of sworkerKeysRecords) {
            sworkerKeysMap.set(sworkerKey.sworker_address, sworkerKey.tee_pubkey);
        }
    }

    return sworkerKeysMap;
}

async function getOrGenerateGroupAndSworkerMap(context:AppContext, groupAddresses: string[], sworkerAddresses: string[]): Promise<Map<string, string[]>> {

    const { database } = context;
    const groupMembersMap = new Map<string, string[]>();

    const groupMembersRecords = await GroupMembersRecord.findAll();
    if (groupMembersRecords.length == 0) {
        // Distribute sworker accounts to group
        const groupCount = groupAddresses.length;
        const chunkSize = Math.ceil(sworkerAddresses.length / groupCount);
        const sworkerAddressChunks = _.chunk(sworkerAddresses, chunkSize);

        assert(sworkerAddressChunks.length == groupCount);

        const groupMemberList = [];
        for (let i = 0; i < groupCount; i++) {
            const groupAddress = groupAddresses[i];
            const sworkerAddressChunk = sworkerAddressChunks[i];

            let membersList = groupMembersMap.get(groupAddress);
            if (_.isNil(membersList)) {
                membersList = [];
                groupMembersMap.set(groupAddress, membersList);
            }
            for (const sworkerAddress of sworkerAddressChunk) {
                const groupMember = {
                    group_address: groupAddress,
                    sworker_address: sworkerAddress,
                }
                groupMemberList.push(groupMember);
                logger.debug(`Assign sworker account: ${sworkerAddress} to group: ${groupAddress}`);

                membersList.push(sworkerAddress);
            }
        }

        // Save to DB
        await database.transaction(async (transaction) => {
            await GroupMembersRecord.bulkCreate(groupMemberList, {
                transaction
            });
        });
    } else {
        for (const record of groupMembersRecords) {
            let membersList = groupMembersMap.get(record.group_address);
            if (_.isNil(membersList)) {
                membersList = [];
                groupMembersMap.set(record.group_address, membersList);
            }
            membersList.push(record.sworker_address);
        }
    }

    return groupMembersMap;
}

async function configureGroupAndSworkers(
    context: AppContext, 
    groupAccounts: Map<string, KeyringPair>, 
    sworkerAccounts: Map<string, KeyringPair>, 
    groupMembers: Map<string, string[]>,
    sworkerKeys: Map<string, string>) {

  const { api } = context;

  for (const [groupAddress, groupAccount] of groupAccounts) {
    const group = await api.getGroup(groupAddress);
    const members = groupMembers.get(groupAddress);

    if (_.isNil(group)) {
        logger.debug(`Group not exist, create it: ${groupAddress}`);
        await api.createGroup(groupAccount);
        
        logger.debug(`Add sworker to allow list`);
        for (const sworkerAddress of members) {
            await api.addMemberToAllowList(sworkerAddress, groupAccount);
        }

        logger.debug(`sworker register`);
        for (const sworkerAddress of members) {
            await api.sworkerRegister(sworkerAccounts.get(sworkerAddress), SWORKER_CODE, sworkerKeys.get(sworkerAddress));
        }

        logger.debug(`sworker join group`) 
        for (const sworkerAddress of members) {
            await api.joinGroup(sworkerAccounts.get(sworkerAddress), groupAddress);
        };
    } else {
        const toAddAllowList = [];
        for (const sworkerAddress of members) {
            if (!group.members.includes(sworkerAddress)) {
                toAddAllowList.push(sworkerAddress);
            }
        }

        if (toAddAllowList.length > 0) {
            logger.debug(`toAddAllowList: ${JSON.stringify(toAddAllowList)}`);
            logger.debug(`group.allowList: ${JSON.stringify(group.allowlist)}`);
            for (const sworkerAddress of toAddAllowList) {
                if (!group.allowlist.includes(sworkerAddress)) {
                    await api.addMemberToAllowList(sworkerAddress, groupAccount);

                    await api.sworkerRegister(sworkerAccounts.get(sworkerAddress), SWORKER_CODE, sworkerKeys.get(sworkerAddress));

                    await api.joinGroup(sworkerAccounts.get(sworkerAddress), groupAddress);
                }
            }   
        }
        
    }
  }
}

// async function generateOrders(context: AppContext, sworkerAccounts: Map<string, KeyringPair>, groupMembersMap: Map<string, string[]>) {

//   const { api, config } = context;
//   const placeOrderFrequency = config.chain.placeOrderFrequency;

//   while(true) {
//     try {
//       // Sleep a while
//       await Bluebird.delay(1 * 1000);

//       // 1. Select random account
//       const randomIndex = Math.floor(Math.random() * accountKrps.length);
//       const krp = accountKrps[randomIndex];
//       logger.debug(`Selected account: ${krp.address}`);

//       // 2. Generate random file content with random file size (10B ~ 1MB)
//       const randomFileSize = Math.floor(Math.random() * (1024 * 1024 - 10 + 1) + 10); // 10B to 1MB;
//       logger.debug(`Generating random file content with size: ${randomFileSize}`);
//       const fileContent = createHash('sha256').update(Math.random().toString()).digest('hex').repeat(randomFileSize / 64).slice(0, randomFileSize);

//       // 3. Upload to IPFS
//       logger.debug(`Uploading file to IPFS...`);
//       const { cid, size } = await uploadToIPFS(fileContent, krp);
//       logger.debug(`Uploaded file to IPFS, cid: ${cid}, size: ${size}`);

//       // 4. Place storage order to crust
//       logger.debug(`Placing storage order to crust...`);
//       await api.placeStorageOrder(krp, cid, size);
//       logger.debug(`Place storage order to crust successfully`);
      
//       // 5. Save order to DB
//       await OrdersRecord.create({
//         cid,
//         file_size: BigInt(size),
//         sender: krp.address
//       });

//       // Wait for the interval
//       await Bluebird.delay(placeOrderFrequency * 1000);
//     } catch(err) {
//       logger.error(`💥 Error to generate orders: ${err}`);
//     }
//   } 
// }

