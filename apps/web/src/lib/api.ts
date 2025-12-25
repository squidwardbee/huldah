import axios from 'axios';

const API_URL = 'http://localhost:3001';

export const api = axios.create({
  baseURL: API_URL,
  timeout: 10000
});

export async function getTopWallets() {
  const { data } = await api.get('/api/wallets/top');
  return data;
}

export async function getRecentWhales() {
  const { data } = await api.get('/api/whales');
  return data;
}

export async function getWalletDetails(address: string) {
  const { data } = await api.get(`/api/wallets/${address}`);
  return data;
}



