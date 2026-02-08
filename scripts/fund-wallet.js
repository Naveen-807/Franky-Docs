require('dotenv/config');
const axios = require('axios');

const walletAddress = '0x2de0a089dc4ad5733df1103c1af6214973a89a36';

async function tryConsoleFaucet() {
  console.log('--- Trying Console faucet API ---');
  const res = await axios.post('https://api.circle.com/v1/faucet/drips', {
    blockchain: 'ARC-TESTNET',
    address: walletAddress,
    native: false,
    usdc: true,
  }, {
    headers: {
      'Authorization': 'Bearer ' + process.env.CIRCLE_API_KEY,
      'Content-Type': 'application/json'
    }
  });
  console.log('Console faucet response:', JSON.stringify(res.data, null, 2));
}

async function main() {
  try {
    await tryConsoleFaucet();
  } catch (e) {
    console.log('Console faucet error:', e.message);
    if (e.response) {
      console.log('Status:', e.response.status);
      console.log('Body:', JSON.stringify(e.response.data).slice(0, 500));
    }
  }
  
  console.log('\n--- Manual faucet option ---');
  console.log('Go to https://faucet.circle.com');
  console.log('Select: Arc Testnet');
  console.log('Paste address:', walletAddress);
  console.log('Request USDC');
}

main();
