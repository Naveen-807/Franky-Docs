import { generateBchWallet } from "../src/wallet/bch.js";

// 1. Generate a fresh wallet and verify the address format
const wallet = generateBchWallet("chipnet");
console.log("=== Generated BCH Wallet ===");
console.log("CashAddr:", wallet.cashAddress);
console.log("Legacy:", wallet.legacyAddress);
console.log("WIF:", wallet.wif);
console.log("Private Key Hex:", wallet.privateKeyHex);
console.log("Address prefix:", wallet.cashAddress.split(":")[0]);
console.log("Address length:", wallet.cashAddress.length);

// 2. Check the existing address from the doc
const existingAddress = "bchtest:qr50rzw49s6g925f4s54459m26da57e0jykv4vtrjt";
console.log("\n=== Existing Address ===");
console.log("Address:", existingAddress);
console.log("Length:", existingAddress.length);
console.log("Prefix:", existingAddress.split(":")[0]);
const hashPart = existingAddress.split(":")[1];
console.log("Hash part:", hashPart);
console.log("Hash part length:", hashPart.length);

// Decode cashaddr manually to verify
const CASHADDR_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const isValidChars = [...hashPart].every(c => CASHADDR_CHARSET.includes(c));
console.log("All chars valid in cashaddr charset:", isValidChars);

// 3. Test the BCH REST API 
console.log("\n=== Testing BCH REST APIs ===");

// Test chipnet.fullstack.cash
try {
  const res1 = await fetch(`https://chipnet.fullstack.cash/v5/electrumx/balance/${existingAddress}`, {
    signal: AbortSignal.timeout(10000)
  });
  const text1 = await res1.text();
  console.log("chipnet.fullstack.cash response status:", res1.status);
  console.log("chipnet.fullstack.cash response:", text1.slice(0, 200));
} catch (e) {
  console.log("chipnet.fullstack.cash error:", (e as Error).message);
}

// Test alternative API
try {
  const res2 = await fetch(`https://chipnet.imaginary.cash/api/address/${existingAddress}/balance`, {
    signal: AbortSignal.timeout(10000)
  });
  const text2 = await res2.text();
  console.log("chipnet.imaginary.cash response status:", res2.status);
  console.log("chipnet.imaginary.cash response:", text2.slice(0, 200));
} catch (e) {
  console.log("chipnet.imaginary.cash error:", (e as Error).message);
}

// Test electroncash/fulcrum style
try {
  const res3 = await fetch(`https://cbch.loping.net/api/address/${existingAddress}/balance`, {
    signal: AbortSignal.timeout(10000)
  });
  const text3 = await res3.text();
  console.log("cbch.loping.net response:", res3.status, text3.slice(0, 200));
} catch (e) {
  console.log("cbch.loping.net error:", (e as Error).message);
}
