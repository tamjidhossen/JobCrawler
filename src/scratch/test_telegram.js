import fetch from 'node-fetch';
import dns from 'dns';
import dotenv from 'dotenv';

// Force Node.js DNS to prefer IPv4
dns.setDefaultResultOrder('ipv4first');

dotenv.config();

const token = process.env.TELEGRAM_BOT_TOKEN || '8636910703:AAGXN8a4-zF7a0W14_d7tpxSxfriiCfDtOo';
const chatId = process.env.TELEGRAM_CHAT_ID || '-1003997877148';

console.log('Testing Telegram connection (IPv4 first)...');
try {
  const url = `https://api.telegram.org/bot${token}/getMe`;
  const res = await fetch(url);
  const data = await res.json();
  console.log('Success connecting to Telegram!');
  console.log(data);
} catch (err) {
  console.error('Fetch failed with error:', err);
}
