# H3L1X

## Overview

An automation tool for the Movement Network testnet. It streamlines interactions with the testnet by automating common tasks such as claiming tokens, staking, and compounding rewards.

## Features

- **Multi-account support**: Manage multiple wallets from a single interface
- **Proxy integration**: Use different proxies for each account
- **Task automation**:
  - Claim native MOVE tokens from faucet
  - Claim hstMOVE tokens
  - Stake hstMOVE tokens
  - Compound stake rewards
  - Unstake hstMOVE tokens
- **Smart retry mechanism**: Exponential backoff for failed operations
- **Detailed logging**: Console and file-based logs for tracking activity
- **Task scheduling**: Set up recurring operations at defined intervals
- **Customizable settings**: Configure token amounts and task execution

## Requirements

- Node.js 14.0.0 or higher
- Internet connection
- Movement Network testnet access
- Private keys for your accounts
- (Optional) Proxies for additional security

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/Usernameusernamenotavailbleisnot/h3l1x-labs.git
   cd h3l1x-labs
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create configuration files:
   - Create `pk.txt` with each private key on a new line
   - Create `proxy.txt` with each proxy on a new line (optional)
   - Customize `config.json` according to your needs

## Configuration

The `config.json` file allows you to customize the tool's behavior:

```json
{
  "tasks": {
    "claimNativeFaucet": true,
    "claimHstMOVE": true,
    "stakeHstMOVE": true,
    "compoundStakeRewards": true,
    "unstakeHstMOVE": true
  },
  "amounts": {
    "stakeAmount": 10,
    "unstakeAmount": 1
  },
  "delayBetweenTasks": 3000,
  "delayBetweenAccounts": 5000,
  "maxRetries": 2,
  "scheduler": {
    "enabled": true,
    "intervalHours": 25
  }
}
```

- **tasks**: Enable/disable specific operations
- **amounts**: Set token amounts for staking and unstaking (in human-readable format)
- **delayBetweenTasks**: Time to wait between operations (milliseconds)
- **delayBetweenAccounts**: Time to wait between processing accounts (milliseconds)
- **maxRetries**: Maximum number of retry attempts for failed operations
- **scheduler**: Configure recurring execution of all tasks

## Usage

Run the tool with:

```bash
npm start
```

Or directly:

```bash
node index.js
```

The tool will:
1. Load your configuration
2. Process each account in your `pk.txt` file
3. Perform enabled tasks for each account
4. Log results to console and `testnet-task.log`
5. If scheduler is enabled, wait for the next run interval

## Logging

H3L1X provides detailed logging:
- Console output with color-coded status messages
- Full activity log in `testnet-task.log`

## Security Notes

- Store private keys securely
- Never share your `pk.txt` file
- Consider using unique proxies for each account
- This tool is meant for testnet use only

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Disclaimer

This tool is for educational and testing purposes only. Use at your own risk on testnet environments. The authors are not responsible for any potential loss of funds or other damages.
