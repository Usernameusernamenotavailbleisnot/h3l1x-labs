const fs = require('fs');
const path = require('path');
const axios = require('axios');
const winston = require('winston');
const chalk = require('chalk');
const { AptosClient, AptosAccount, TxnBuilderTypes, BCS } = require('aptos');
const { HttpsProxyAgent } = require('https-proxy-agent');

// Hardcoded technical configuration
const TECHNICAL_CONFIG = {
  nodeUrl: 'https://testnet.bardock.movementnetwork.xyz/v1',
  faucetUrl: 'https://faucet.testnet.bardock.movementnetwork.xyz',
  indexerUrl: 'https://indexer.testnet.bardock.movementnetwork.xyz',
  pkPath: './pk.txt',
  proxyPath: './proxy.txt',
  moduleAddresses: {
    eigenfi_token_minter: '0xf7429cda18fc0dd78d0dc48b102158024f1dc3a511a2a65ea553b5970d65b028',
    eigenfi_move_vault_hstmove: '0xf7429cda18fc0dd78d0dc48b102158024f1dc3a511a2a65ea553b5970d65b028'
  },
  hstMOVEMetadata: '0x9c9b084429eecf70c7c4f9b18980eb3cbb9c9a70fee7abfb59ca637005c5b430',
  transactionOptions: {
    maxGasAmount: 2000000,
    gasUnitPrice: 100
  },
  initialRetryDelay: 1000,
  maxRetryDelay: 30000,
  backoffFactor: 2,
  // Multiplier to convert human-readable amounts to blockchain units
  tokenMultiplier: 100000000 // 10^8 for 8 decimal places
};

// Load user configuration from config.json
let USER_CONFIG;
try {
  const configFile = fs.readFileSync('config.json', 'utf8');
  USER_CONFIG = JSON.parse(configFile);
  console.log('Configuration loaded successfully from config.json');
} catch (error) {
  console.error(`Error loading config.json: ${error.message}`);
  console.error('Please make sure config.json exists in the current directory');
  process.exit(1);
}

// Combine configurations
const CONFIG = {
  ...TECHNICAL_CONFIG,
  tasks: USER_CONFIG.tasks,
  delayBetweenTasks: USER_CONFIG.delayBetweenTasks,
  delayBetweenAccounts: USER_CONFIG.delayBetweenAccounts,
  retryConfig: {
    maxRetries: USER_CONFIG.maxRetries || 2,
    initialDelay: TECHNICAL_CONFIG.initialRetryDelay,
    maxDelay: TECHNICAL_CONFIG.maxRetryDelay,
    factor: TECHNICAL_CONFIG.backoffFactor
  },
  // Convert human-readable amounts to blockchain units
  amounts: {
    stakeAmount: String(USER_CONFIG.amounts.stakeAmount * TECHNICAL_CONFIG.tokenMultiplier),
    unstakeAmount: String(USER_CONFIG.amounts.unstakeAmount * TECHNICAL_CONFIG.tokenMultiplier)
  }
};

// Set up custom logger with enhanced formatting
const logger = {
  info: (message) => {
    const date = new Date();
    const timestamp = `[${date.toLocaleDateString()} - ${date.toLocaleTimeString()}]`;
    console.log(`${chalk.gray(timestamp)} ${chalk.cyan('INFO')} ${message}`);
    
    // Also log to file without colors
    const logEntry = `[${date.toLocaleDateString()} - ${date.toLocaleTimeString()}] INFO: ${message}`;
    fs.appendFileSync('testnet-task.log', logEntry + '\n');
  },
  warn: (message) => {
    const date = new Date();
    const timestamp = `[${date.toLocaleDateString()} - ${date.toLocaleTimeString()}]`;
    console.log(`${chalk.gray(timestamp)} ${chalk.yellow('WARN')} ${chalk.yellow(message)}`);
    
    // Also log to file without colors
    const logEntry = `[${date.toLocaleDateString()} - ${date.toLocaleTimeString()}] WARN: ${message}`;
    fs.appendFileSync('testnet-task.log', logEntry + '\n');
  },
  error: (message) => {
    const date = new Date();
    const timestamp = `[${date.toLocaleDateString()} - ${date.toLocaleTimeString()}]`;
    console.log(`${chalk.gray(timestamp)} ${chalk.red('ERROR')} ${chalk.red(message)}`);
    
    // Also log to file without colors
    const logEntry = `[${date.toLocaleDateString()} - ${date.toLocaleTimeString()}] ERROR: ${message}`;
    fs.appendFileSync('testnet-task.log', logEntry + '\n');
  },
  success: (message) => {
    const date = new Date();
    const timestamp = `[${date.toLocaleDateString()} - ${date.toLocaleTimeString()}]`;
    console.log(`${chalk.gray(timestamp)} ${chalk.green('SUCCESS')} ${chalk.green(message)}`);
    
    // Also log to file without colors
    const logEntry = `[${date.toLocaleDateString()} - ${date.toLocaleTimeString()}] SUCCESS: ${message}`;
    fs.appendFileSync('testnet-task.log', logEntry + '\n');
  },
  task: (taskName, status) => {
    const date = new Date();
    const timestamp = `[${date.toLocaleDateString()} - ${date.toLocaleTimeString()}]`;
    
    if (status === 'start') {
      console.log(`${chalk.gray(timestamp)} ${chalk.blue('TASK')} ${chalk.blue('▶')} Starting: ${chalk.bold(taskName)}`);
      // Log to file
      fs.appendFileSync('testnet-task.log', `[${date.toLocaleDateString()} - ${date.toLocaleTimeString()}] TASK: Starting: ${taskName}\n`);
    } else if (status === 'skip') {
      console.log(`${chalk.gray(timestamp)} ${chalk.gray('SKIP')} ${chalk.gray('↷')} Skipping: ${chalk.gray(taskName)} (disabled in config)`);
      // Log to file
      fs.appendFileSync('testnet-task.log', `[${date.toLocaleDateString()} - ${date.toLocaleTimeString()}] SKIP: Skipping: ${taskName} (disabled in config)\n`);
    } else if (status === 'complete') {
      console.log(`${chalk.gray(timestamp)} ${chalk.green('TASK')} ${chalk.green('✓')} Completed: ${chalk.bold(taskName)}`);
      // Log to file
      fs.appendFileSync('testnet-task.log', `[${date.toLocaleDateString()} - ${date.toLocaleTimeString()}] TASK: Completed: ${taskName}\n`);
    } else if (status === 'fail') {
      console.log(`${chalk.gray(timestamp)} ${chalk.red('TASK')} ${chalk.red('✗')} Failed: ${chalk.bold(taskName)}`);
      // Log to file
      fs.appendFileSync('testnet-task.log', `[${date.toLocaleDateString()} - ${date.toLocaleTimeString()}] TASK: Failed: ${taskName}\n`);
    }
  },
  accountProgress: (currentIndex, total, address) => {
    const progressBar = generateProgressBar(currentIndex + 1, total);
    console.log(`\n${chalk.cyan('ACCOUNT')} [${currentIndex + 1}/${total}] ${progressBar} ${chalk.cyan(address)}`);
    fs.appendFileSync('testnet-task.log', `\nACCOUNT [${currentIndex + 1}/${total}] ${address}\n`);
  }
};

// Helper to generate ASCII progress bar
function generateProgressBar(current, total, size = 20) {
  const progress = Math.round((current / total) * size);
  const progressBar = '█'.repeat(progress) + '░'.repeat(size - progress);
  const percentage = Math.round((current / total) * 100);
  return `${progressBar} ${percentage}%`;
}

// Read private keys and proxies
function readLines(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      logger.error(`File not found: ${filePath}`);
      return [];
    }
    
    const content = fs.readFileSync(filePath, 'utf8');
    return content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);
  } catch (error) {
    logger.error(`Error reading file ${filePath}: ${error.message}`);
    return [];
  }
}

// Create Aptos account from various private key formats
function createAptosAccount(privateKeyStr) {
  try {
    // Remove 0x prefix if present
    const cleanKey = privateKeyStr.startsWith('0x') ? privateKeyStr.slice(2) : privateKeyStr;
    
    // Check if it's a valid hex string
    if (!/^[0-9a-fA-F]+$/.test(cleanKey)) {
      throw new Error('Private key is not a valid hex string');
    }
    
    // Try different approaches for different key formats
    try {
      // Approach 1: Direct hex to bytes
      const privateKeyBytes = Uint8Array.from(Buffer.from(cleanKey, 'hex'));
      return new AptosAccount(privateKeyBytes);
    } catch (error) {
      logger.warn(`First approach failed: ${error.message}, trying alternative...`);
      
      // Approach 2: Parse using fromHexInput
      return AptosAccount.fromPrivateKeyHexInput(privateKeyStr);
    }
  } catch (error) {
    logger.error(`Failed to create account from private key: ${error.message}`);
    throw error;
  }
}

// Create Aptos client with proxy - Updated to be more resilient
function createClient(proxy = null) {
  const options = {};
  
  if (proxy) {
    const proxyAgent = new HttpsProxyAgent(proxy);
    options.axiosConfig = {
      httpAgent: proxyAgent,
      httpsAgent: proxyAgent,
      headers: {
        'accept': 'application/json, text/plain, */*',
        'accept-encoding': 'gzip, deflate, br, zstd',
        'accept-language': 'en-US,en;q=0.9',
        'content-type': 'application/json',
        'origin': 'chrome-extension://ejjladinnckdgjemekebdpeokbikhfci',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
        'x-aptos-client': 'aptos-typescript-sdk/1.21.0',
      }
    };
  }
  
  return new AptosClient(CONFIG.nodeUrl, options);
}

// Create axios instance with proxy - kept for faucet requests
function createAxiosInstance(proxy = null) {
  const options = {
    headers: {
      'accept': 'application/json, text/plain, */*',
      'accept-encoding': 'gzip, deflate, br, zstd',
      'accept-language': 'en-US,en;q=0.9',
      'content-type': 'application/json',
      'origin': 'chrome-extension://ejjladinnckdgjemekebdpeokbikhfci',
      'priority': 'u=1, i',
      'sec-ch-ua': '"Chromium";v="134", "Not:A-Brand";v="24", "Google Chrome";v="134"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'none',
      'sec-fetch-storage-access': 'active',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
      'x-aptos-client': 'aptos-typescript-sdk/1.21.0',
      'x-aptos-typescript-sdk-origin-method': 'fundAccount',
      'x-indexer-client': 'aptos-petra'
    }
  };
  
  if (proxy) {
    const proxyAgent = new HttpsProxyAgent(proxy);
    options.httpAgent = proxyAgent;
    options.httpsAgent = proxyAgent;
  }
  
  return axios.create(options);
}

// Sleep function for delays
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Retry function with exponential backoff
async function retryOperation(operation, maxRetries, initialDelay, maxDelay, factor) {
  let lastError;
  let delay = initialDelay;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      
      if (attempt < maxRetries) {
        // Calculate next delay with exponential backoff
        delay = Math.min(delay * factor, maxDelay);
        
        // Add some randomization to avoid thundering herd problem
        const jitter = delay * 0.2 * Math.random();
        const actualDelay = delay + jitter;
        
        logger.warn(`Attempt ${attempt} failed, retrying in ${Math.round(actualDelay / 1000)} seconds...`);
        await sleep(actualDelay);
      }
    }
  }
  
  // If all retries failed, throw the last error
  logger.error(`All ${maxRetries} retry attempts failed`);
  throw lastError;
}

// Request funds from faucet
async function requestFundsFromFaucet(address, proxy = null) {
  return retryOperation(
    async () => {
      const axiosInstance = createAxiosInstance(proxy);
      try {
        logger.info(`Requesting native MOVE funds for address: ${address}`);
        const response = await axiosInstance.post(`${CONFIG.faucetUrl}/fund`, {
          address,
          amount: 1000000000 // 1 MOVE
        });
        
        // If the faucet returns transaction hashes, wait for them to complete
        if (response.data && response.data.txn_hashes && response.data.txn_hashes.length > 0) {
          logger.info(`Waiting for faucet transaction to complete...`);
          await sleep(5000); // Wait for transaction to be processed
        }
        
        return response.data;
      } catch (error) {
        // Log simplified error information
        logger.error(`Error requesting funds: ${error.message}`);
        throw error;
      }
    },
    CONFIG.retryConfig.maxRetries,
    CONFIG.retryConfig.initialDelay,
    CONFIG.retryConfig.maxDelay,
    CONFIG.retryConfig.factor
  );
}

// Claim hstMOVE tokens using Aptos SDK
async function claimHstMOVE(account, client, proxy = null) {
  return retryOperation(
    async () => {
      try {
        logger.info(`Claiming hstMOVE tokens for address: ${account.address()}`);
        
        // Define the transaction payload
        const payload = {
          function: `${CONFIG.moduleAddresses.eigenfi_token_minter}::eigenfi_token_minter::mint_fa`,
          type_arguments: [],
          arguments: [
            CONFIG.hstMOVEMetadata,
            "10000000000" // Amount to mint
          ]
        };
        
        // Use Aptos SDK's built-in transaction submission
        const txnRequest = await client.generateTransaction(account.address(), payload);
        
        // Set gas parameters if needed
        txnRequest.max_gas_amount = CONFIG.transactionOptions.maxGasAmount.toString();
        txnRequest.gas_unit_price = CONFIG.transactionOptions.gasUnitPrice.toString();
        
        // Sign the transaction with the SDK
        const signedTxn = await client.signTransaction(account, txnRequest);
        
        // Submit the transaction using the SDK
        const pendingTxn = await client.submitTransaction(signedTxn);
        const txnHash = pendingTxn.hash;
        
        logger.info(`Claim hstMOVE transaction submitted with hash: ${txnHash}`);
        
        // Wait for transaction confirmation - with fallback
        try {
          // Wait a bit longer for the transaction
          await sleep(8000);
          
          // Try to get transaction by hash directly instead of using waitForTransaction
          const txnResult = await client.getTransactionByHash(txnHash);
          logger.success(`Claim hstMOVE transaction completed successfully`);
          return txnResult;
        } catch (txError) {
          logger.warn(`Unable to get transaction details, but transaction was submitted`);
          // Return a simplified result since the transaction was submitted successfully
          return { 
            hash: txnHash, 
            success: true 
          };
        }
      } catch (error) {
        logger.error(`Error claiming hstMOVE tokens: ${error.message}`);
        throw error;
      }
    },
    CONFIG.retryConfig.maxRetries,
    CONFIG.retryConfig.initialDelay,
    CONFIG.retryConfig.maxDelay,
    CONFIG.retryConfig.factor
  );
}

// Stake hstMOVE tokens using the Aptos SDK
async function stakeHstMOVE(account, client, proxy = null) {
  // Get stake amount from config
  const amount = CONFIG.amounts.stakeAmount;
  const displayAmount = USER_CONFIG.amounts.stakeAmount; // Human-readable amount
  
  return retryOperation(
    async () => {
      try {
        logger.info(`Staking ${displayAmount} hstMOVE tokens for address: ${account.address()}`);
        
        // Define the transaction payload
        const payload = {
          function: `${CONFIG.moduleAddresses.eigenfi_move_vault_hstmove}::eigenfi_move_vault_hstmove::stake`,
          type_arguments: [],
          arguments: [amount]
        };
        
        // Use Aptos SDK's built-in transaction submission
        const txnRequest = await client.generateTransaction(account.address(), payload);
        
        // Set gas parameters if needed
        txnRequest.max_gas_amount = CONFIG.transactionOptions.maxGasAmount.toString();
        txnRequest.gas_unit_price = CONFIG.transactionOptions.gasUnitPrice.toString();
        
        // Sign the transaction with the SDK
        const signedTxn = await client.signTransaction(account, txnRequest);
        
        // Submit the transaction using the SDK
        const pendingTxn = await client.submitTransaction(signedTxn);
        const txnHash = pendingTxn.hash;
        
        logger.info(`Stake hstMOVE transaction submitted with hash: ${txnHash}`);
        
        // Wait for transaction confirmation - with fallback
        try {
          // Wait a bit longer for the transaction
          await sleep(8000);
          
          // Try to get transaction by hash directly instead of using waitForTransaction
          const txnResult = await client.getTransactionByHash(txnHash);
          logger.success(`Stake hstMOVE transaction completed successfully`);
          return txnResult;
        } catch (txError) {
          logger.warn(`Unable to get transaction details, but transaction was submitted`);
          // Return a simplified result since the transaction was submitted successfully
          return { 
            hash: txnHash, 
            success: true 
          };
        }
      } catch (error) {
        logger.error(`Error staking hstMOVE tokens: ${error.message}`);
        throw error;
      }
    },
    CONFIG.retryConfig.maxRetries,
    CONFIG.retryConfig.initialDelay,
    CONFIG.retryConfig.maxDelay,
    CONFIG.retryConfig.factor
  );
}

// Compound stake rewards using the Aptos SDK
async function compoundStakeRewards(account, client, proxy = null) {
  return retryOperation(
    async () => {
      try {
        logger.info(`Compounding stake rewards for address: ${account.address()}`);
        
        // Define the transaction payload
        const payload = {
          function: `${CONFIG.moduleAddresses.eigenfi_move_vault_hstmove}::eigenfi_move_vault_hstmove::compound`,
          type_arguments: [],
          arguments: []
        };
        
        // Use Aptos SDK's built-in transaction submission
        const txnRequest = await client.generateTransaction(account.address(), payload);
        
        // Set gas parameters if needed
        txnRequest.max_gas_amount = CONFIG.transactionOptions.maxGasAmount.toString();
        txnRequest.gas_unit_price = CONFIG.transactionOptions.gasUnitPrice.toString();
        
        // Sign the transaction with the SDK
        const signedTxn = await client.signTransaction(account, txnRequest);
        
        // Submit the transaction using the SDK
        const pendingTxn = await client.submitTransaction(signedTxn);
        const txnHash = pendingTxn.hash;
        
        logger.info(`Compound transaction submitted with hash: ${txnHash}`);
        
        // Wait for transaction confirmation - with fallback
        try {
          // Wait a bit longer for the transaction
          await sleep(8000);
          
          // Try to get transaction by hash directly instead of using waitForTransaction
          const txnResult = await client.getTransactionByHash(txnHash);
          logger.success(`Compound transaction completed successfully`);
          return txnResult;
        } catch (txError) {
          logger.warn(`Unable to get transaction details, but transaction was submitted`);
          // Return a simplified result since the transaction was submitted successfully
          return { 
            hash: txnHash, 
            success: true 
          };
        }
      } catch (error) {
        logger.error(`Error compounding stake rewards: ${error.message}`);
        throw error;
      }
    },
    CONFIG.retryConfig.maxRetries,
    CONFIG.retryConfig.initialDelay,
    CONFIG.retryConfig.maxDelay,
    CONFIG.retryConfig.factor
  );
}

// Unstake hstMOVE tokens using the Aptos SDK
async function unstakeHstMOVE(account, client, proxy = null) {
  // Get unstake amount from config
  const amount = CONFIG.amounts.unstakeAmount;
  const displayAmount = USER_CONFIG.amounts.unstakeAmount; // Human-readable amount
  
  return retryOperation(
    async () => {
      try {
        logger.info(`Unstaking ${displayAmount} hstMOVE tokens for address: ${account.address()}`);
        
        // Define the transaction payload
        const payload = {
          function: `${CONFIG.moduleAddresses.eigenfi_move_vault_hstmove}::eigenfi_move_vault_hstmove::unstake`,
          type_arguments: [],
          arguments: [amount]
        };
        
        // Use Aptos SDK's built-in transaction submission
        const txnRequest = await client.generateTransaction(account.address(), payload);
        
        // Set gas parameters if needed
        txnRequest.max_gas_amount = CONFIG.transactionOptions.maxGasAmount.toString();
        txnRequest.gas_unit_price = CONFIG.transactionOptions.gasUnitPrice.toString();
        
        // Sign the transaction with the SDK
        const signedTxn = await client.signTransaction(account, txnRequest);
        
        // Submit the transaction using the SDK
        const pendingTxn = await client.submitTransaction(signedTxn);
        const txnHash = pendingTxn.hash;
        
        logger.info(`Unstake transaction submitted with hash: ${txnHash}`);
        
        // Wait for transaction confirmation - with fallback
        try {
          // Wait a bit longer for the transaction
          await sleep(8000);
          
          // Try to get transaction by hash directly instead of using waitForTransaction
          const txnResult = await client.getTransactionByHash(txnHash);
          logger.success(`Unstake transaction completed successfully`);
          return txnResult;
        } catch (txError) {
          logger.warn(`Unable to get transaction details, but transaction was submitted`);
          // Return a simplified result since the transaction was submitted successfully
          return { 
            hash: txnHash, 
            success: true 
          };
        }
      } catch (error) {
        logger.error(`Error unstaking hstMOVE tokens: ${error.message}`);
        throw error;
      }
    },
    CONFIG.retryConfig.maxRetries,
    CONFIG.retryConfig.initialDelay,
    CONFIG.retryConfig.maxDelay,
    CONFIG.retryConfig.factor
  );
}

// Process a single account
async function processAccount(privateKey, proxy, index, total) {
  try {
    // Create account from private key using our helper function
    const account = createAptosAccount(privateKey);
    
    // Display account progress with a formatted progress bar
    logger.accountProgress(index, total, account.address());
    
    // Create client with proxy
    const client = createClient(proxy);
    
    // Store results of each operation
    const results = {
      faucet: null,
      claim: null,
      stake: null,
      compound: null,
      unstake: null
    };
    
    try {
      // Request funds from faucet (if enabled)
      if (CONFIG.tasks.claimNativeFaucet) {
        logger.task('Request Native MOVE Funds', 'start');
        results.faucet = await requestFundsFromFaucet(account.address().toString(), proxy);
        logger.task('Request Native MOVE Funds', 'complete');
        await sleep(CONFIG.delayBetweenTasks);
      } else {
        logger.task('Request Native MOVE Funds', 'skip');
      }
      
      // Claim hstMOVE tokens (if enabled)
      if (CONFIG.tasks.claimHstMOVE) {
        logger.task('Claim hstMOVE Tokens', 'start');
        results.claim = await claimHstMOVE(account, client, proxy);
        logger.task('Claim hstMOVE Tokens', 'complete');
        await sleep(CONFIG.delayBetweenTasks);
      } else {
        logger.task('Claim hstMOVE Tokens', 'skip');
      }
      
      // Stake hstMOVE tokens (if enabled)
      if (CONFIG.tasks.stakeHstMOVE) {
        logger.task(`Stake ${USER_CONFIG.amounts.stakeAmount} hstMOVE Tokens`, 'start');
        results.stake = await stakeHstMOVE(account, client, proxy);
        logger.task(`Stake ${USER_CONFIG.amounts.stakeAmount} hstMOVE Tokens`, 'complete');
        await sleep(CONFIG.delayBetweenTasks);
      } else {
        logger.task('Stake hstMOVE Tokens', 'skip');
      }
      
      // Compound stake rewards (if enabled)
      if (CONFIG.tasks.compoundStakeRewards) {
        logger.task('Compound Stake Rewards', 'start');
        results.compound = await compoundStakeRewards(account, client, proxy);
        logger.task('Compound Stake Rewards', 'complete');
        await sleep(CONFIG.delayBetweenTasks);
      } else {
        logger.task('Compound Stake Rewards', 'skip');
      }
      
      // Unstake some hstMOVE tokens (if enabled)
      if (CONFIG.tasks.unstakeHstMOVE) {
        logger.task(`Unstake ${USER_CONFIG.amounts.unstakeAmount} hstMOVE Tokens`, 'start');
        results.unstake = await unstakeHstMOVE(account, client, proxy);
        logger.task(`Unstake ${USER_CONFIG.amounts.unstakeAmount} hstMOVE Tokens`, 'complete');
      } else {
        logger.task('Unstake hstMOVE Tokens', 'skip');
      }
      
    } catch (error) {
      logger.error(`Failed to complete all operations for account: ${account.address()}`);
      logger.error(`Last error: ${error.message}`);
      
      // Log the operations that were successful
      const completedOps = Object.entries(results)
        .filter(([_, result]) => result !== null)
        .map(([op, _]) => op);
      
      if (completedOps.length > 0) {
        logger.info(`Completed operations: ${completedOps.join(', ')}`);
      } else {
        logger.info('No operations were completed successfully');
      }
      
      return false;
    }
    
    logger.success(`✅ Completed all enabled tasks for account: ${account.address()}`);
    return true;
  } catch (error) {
    logger.error(`❌ Error initializing account process: ${error.message}`);
    return false;
  }
}

// Print configuration summary
function printConfigSummary() {
  console.log('\n' + chalk.cyan('='.repeat(60)));
  console.log(chalk.cyan.bold('HELIX LABS - CONFIGURATION SUMMARY'));
  console.log(chalk.cyan('='.repeat(60)));
  
  console.log('\n' + chalk.yellow.bold('ENABLED TASKS:'));
  console.log(`${CONFIG.tasks.claimNativeFaucet ? chalk.green('✓') : chalk.red('✗')} Claim Native MOVE Funds`);
  console.log(`${CONFIG.tasks.claimHstMOVE ? chalk.green('✓') : chalk.red('✗')} Claim hstMOVE Tokens`);
  console.log(`${CONFIG.tasks.stakeHstMOVE ? chalk.green('✓') : chalk.red('✗')} Stake hstMOVE Tokens (Amount: ${USER_CONFIG.amounts.stakeAmount})`);
  console.log(`${CONFIG.tasks.compoundStakeRewards ? chalk.green('✓') : chalk.red('✗')} Compound Stake Rewards`);
  console.log(`${CONFIG.tasks.unstakeHstMOVE ? chalk.green('✓') : chalk.red('✗')} Unstake hstMOVE Tokens (Amount: ${USER_CONFIG.amounts.unstakeAmount})`);
  
  console.log('\n' + chalk.yellow.bold('OTHER SETTINGS:'));
  console.log(`Delay between tasks: ${chalk.white(CONFIG.delayBetweenTasks)}ms`);
  console.log(`Delay between accounts: ${chalk.white(CONFIG.delayBetweenAccounts)}ms`);
  console.log(`Max retries: ${chalk.white(CONFIG.retryConfig.maxRetries)}`);
  
  // Show scheduler info if enabled
  if (USER_CONFIG.scheduler && USER_CONFIG.scheduler.enabled) {
    console.log('\n' + chalk.yellow.bold('SCHEDULER:'));
    console.log(`${chalk.green('✓')} Enabled - Will run every ${chalk.white(USER_CONFIG.scheduler.intervalHours)} hours`);
  }
  
  console.log(chalk.cyan('='.repeat(60)) + '\n');
}

// Format time remaining
function formatTimeRemaining(milliseconds) {
  const seconds = Math.floor(milliseconds / 1000) % 60;
  const minutes = Math.floor(milliseconds / (1000 * 60)) % 60;
  const hours = Math.floor(milliseconds / (1000 * 60 * 60));
  
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

// Execute all tasks once
async function executeAllTasks() {
  // Clear and create log file
  fs.writeFileSync('testnet-task.log', '');
  
  // Print configuration summary before starting
  printConfigSummary();
  
  logger.info('🚀 Starting Helix Labs Testnet Task');
  
  // Read private keys and proxies
  const privateKeys = readLines(TECHNICAL_CONFIG.pkPath);
  const proxies = readLines(TECHNICAL_CONFIG.proxyPath);
  
  if (privateKeys.length === 0) {
    logger.error('❌ No private keys found. Exiting.');
    return false;
  }
  
  logger.info(`📋 Found ${privateKeys.length} private keys`);
  
  if (proxies.length === 0) {
    logger.warn('⚠️ No proxies found. Proceeding without proxies.');
  } else {
    logger.info(`🌐 Found ${proxies.length} proxies`);
    
    if (privateKeys.length !== proxies.length) {
      logger.warn(`⚠️ Number of private keys (${privateKeys.length}) does not match number of proxies (${proxies.length}). Some accounts may not have a dedicated proxy.`);
    }
  }
  
  // Process each account
  for (let i = 0; i < privateKeys.length; i++) {
    const privateKey = privateKeys[i];
    const proxy = i < proxies.length ? proxies[i] : null;
    
    await processAccount(privateKey, proxy, i, privateKeys.length);
    
    if (i < privateKeys.length - 1) {
      logger.info(`⏳ Waiting ${CONFIG.delayBetweenAccounts / 1000} seconds before processing next account...`);
      await sleep(CONFIG.delayBetweenAccounts);
    }
  }
  
  logger.success('✅ Finished all tasks for all accounts');
  
  // Print summary of completed accounts
  console.log('\n' + chalk.cyan('='.repeat(60)));
  console.log(chalk.cyan.bold('TASK SUMMARY'));
  console.log(chalk.cyan('='.repeat(60)));
  console.log(`${chalk.green.bold('▶')} Total accounts processed: ${privateKeys.length}`);
  console.log(chalk.cyan('='.repeat(60)) + '\n');
  
  return true;
}

// Main function with scheduler support
async function main() {
  // Check if scheduler is enabled
  const schedulerEnabled = USER_CONFIG.scheduler && USER_CONFIG.scheduler.enabled;
  const intervalHours = (USER_CONFIG.scheduler && USER_CONFIG.scheduler.intervalHours) || 25;
  const intervalMs = intervalHours * 60 * 60 * 1000;
  
  if (!schedulerEnabled) {
    // Just run once if scheduler is disabled
    await executeAllTasks();
    return;
  }
  
  // Run with scheduler enabled (every 25 hours)
  logger.info(`📅 Scheduler enabled - will run every ${intervalHours} hours`);
  
  let iterationCount = 1;
  
  while (true) {
    try {
      console.log('\n' + chalk.magenta('='.repeat(60)));
      console.log(chalk.magenta.bold(`SCHEDULED RUN #${iterationCount}`));
      console.log(chalk.magenta('='.repeat(60)) + '\n');
      
      // Run all tasks
      await executeAllTasks();
      
      // Calculate next run time
      const nextRunTime = new Date(Date.now() + intervalMs);
      logger.info(`📅 Next scheduled run: ${nextRunTime.toLocaleString()}`);
      
      // Display countdown
      const startTime = Date.now();
      const endTime = startTime + intervalMs;
      
      console.log('\n' + chalk.yellow('='.repeat(60)));
      console.log(chalk.yellow.bold(`WAITING FOR NEXT RUN IN ${intervalHours} HOURS`));
      console.log(chalk.yellow('='.repeat(60)) + '\n');
      
      // Update countdown every minute
      const countdownInterval = setInterval(() => {
        const currentTime = Date.now();
        const timeRemaining = endTime - currentTime;
        
        if (timeRemaining <= 0) {
          clearInterval(countdownInterval);
          return;
        }
        
        const formattedTime = formatTimeRemaining(timeRemaining);
        process.stdout.write(`\r${chalk.cyan('⏳')} Time remaining until next run: ${chalk.cyan(formattedTime)}`);
      }, 60000); // Update every minute
      
      // Wait for the full interval
      await sleep(intervalMs);
      
      // Clear the countdown interval if it's still running
      clearInterval(countdownInterval);
      
      // Move to next line after countdown
      console.log('\n');
      
      // Increment iteration counter
      iterationCount++;
      
    } catch (error) {
      logger.error(`Error in scheduled run: ${error.message}`);
      logger.info('Will try again at the next scheduled time');
      await sleep(intervalMs);
    }
  }
}

// Run the main function
main().catch(error => {
  logger.error(`❌ Unhandled error in main process: ${error.message}`);
  process.exit(1);
});