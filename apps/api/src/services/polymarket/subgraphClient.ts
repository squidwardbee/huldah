import axios from 'axios';

const ENDPOINTS = {
  positions: 'https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/positions-subgraph/0.0.7/gn',
  pnl: 'https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/pnl-subgraph/0.0.14/gn',
  activity: 'https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/activity-subgraph/0.0.4/gn'
};

export interface Position {
  id: string;
  user: string;
  balance: string;
  asset: {
    id: string;
    condition: {
      id: string;
    };
    outcomeIndex: string;
  };
}

export interface UserPositionWithPnL {
  id: string;
  user: string;
  tokenId: string;
  amount: string;
  avgPrice: string;
  realizedPnl: string;
  totalBought: string;
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
        userBalances(where: { user: $wallet, balance_gt: "0" }, first: $first) {
          id
          user
          balance
          asset {
            id
            condition {
              id
            }
            outcomeIndex
          }
        }
      }
    `;

    const result = await this.query<{ userBalances: Position[] }>(
      ENDPOINTS.positions,
      query,
      { wallet: walletAddress.toLowerCase(), first }
    );

    return result.userBalances;
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
    outcomeIndex: string;
    balance: string;
  }[]> {
    const query = `
      query MarketHolders($condition: String!, $first: Int!) {
        userBalances(
          where: { balance_gt: "0" }
          orderBy: balance
          orderDirection: desc
          first: $first
        ) {
          user
          balance
          asset {
            condition {
              id
            }
            outcomeIndex
          }
        }
      }
    `;

    const result = await this.query<{
      userBalances: {
        user: string;
        balance: string;
        asset: {
          condition: { id: string };
          outcomeIndex: string
        }
      }[]
    }>(
      ENDPOINTS.positions,
      query,
      { condition: conditionId, first }
    );

    // Filter by condition and flatten the response
    return result.userBalances
      .filter(ub => ub.asset.condition.id.toLowerCase() === conditionId.toLowerCase())
      .map(ub => ({
        user: ub.user,
        outcomeIndex: ub.asset.outcomeIndex,
        balance: ub.balance
      }));
  }

  /**
   * Get wallet positions with PnL data from the PnL subgraph
   */
  async getWalletPositionsWithPnL(walletAddress: string, first = 100): Promise<UserPositionWithPnL[]> {
    const query = `
      query GetUserPositions($wallet: String!, $first: Int!) {
        userPositions(where: { user: $wallet }, first: $first, orderBy: amount, orderDirection: desc) {
          id
          user
          tokenId
          amount
          avgPrice
          realizedPnl
          totalBought
        }
      }
    `;

    const result = await this.query<{ userPositions: UserPositionWithPnL[] }>(
      ENDPOINTS.pnl,
      query,
      { wallet: walletAddress.toLowerCase(), first }
    );

    return result.userPositions;
  }
}


