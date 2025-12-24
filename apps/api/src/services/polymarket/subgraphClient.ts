import axios from 'axios';

const ENDPOINTS = {
  positions: 'https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/positions-subgraph/0.0.7/gn',
  pnl: 'https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/pnl-subgraph/0.0.14/gn',
  activity: 'https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/activity-subgraph/0.0.4/gn'
};

export interface Position {
  condition: string;
  outcomeIndex: number;
  balance: string;
  averagePrice: string;
  realizedPnl: string;
}

interface GraphQLResponse<T> {
  data: T;
  errors?: { message: string }[];
}

export class SubgraphClient {
  async query<T>(endpoint: string, query: string, variables?: Record<string, unknown>): Promise<T> {
    const { data } = await axios.post<GraphQLResponse<T>>(endpoint, { query, variables });
    if (data.errors) {
      throw new Error(data.errors[0].message);
    }
    return data.data;
  }

  async getWalletPositions(walletAddress: string, first = 100): Promise<Position[]> {
    const query = `
      query GetPositions($wallet: String!, $first: Int!) {
        positions(where: { user: $wallet }, first: $first) {
          condition
          outcomeIndex
          balance
          averagePrice
          realizedPnl
        }
      }
    `;
    
    const result = await this.query<{ positions: Position[] }>(
      ENDPOINTS.positions,
      query,
      { wallet: walletAddress.toLowerCase(), first }
    );
    
    return result.positions;
  }

  async getTopWalletsByPnL(first = 100): Promise<{ id: string; realizedPnl: string }[]> {
    const query = `
      query TopWallets($first: Int!) {
        users(first: $first, orderBy: realizedPnl, orderDirection: desc) {
          id
          realizedPnl
        }
      }
    `;
    
    const result = await this.query<{ users: { id: string; realizedPnl: string }[] }>(
      ENDPOINTS.pnl,
      query,
      { first }
    );
    
    return result.users;
  }

  /**
   * Get top holders for a specific market condition
   */
  async getMarketHolders(conditionId: string, first = 50): Promise<{
    user: string;
    outcomeIndex: number;
    balance: string;
    averagePrice: string;
  }[]> {
    const query = `
      query MarketHolders($condition: String!, $first: Int!) {
        positions(
          where: { condition: $condition, balance_gt: "0" }
          orderBy: balance
          orderDirection: desc
          first: $first
        ) {
          user
          outcomeIndex
          balance
          averagePrice
        }
      }
    `;
    
    const result = await this.query<{ positions: { user: string; outcomeIndex: number; balance: string; averagePrice: string }[] }>(
      ENDPOINTS.positions,
      query,
      { condition: conditionId, first }
    );
    
    return result.positions;
  }
}


