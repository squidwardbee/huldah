import { Pool } from 'pg';
import { FundingTracker } from './fundingTracker';

interface ClusterMember {
  address: string;
  role: 'primary' | 'funding' | 'receiving' | 'unknown';
  volume: number;
  pnl: number;
  winRate: number;
  insiderScore: number;
  fundingAmount?: number;
  fundingDate?: Date;
}

interface Cluster {
  clusterId: string;
  detectionMethod: 'funding_pattern' | 'timing' | 'behavior' | 'manual';
  confidence: number;
  memberCount: number;
  totalVolume: number;
  totalPnl: number;
  avgWinRate: number;
  avgInsiderScore: number;
  marketsTraded: number;
  fundingSource?: string;
  fundingSourceType?: string;
  totalFunded?: number;
  members: ClusterMember[];
  createdAt: Date;
  lastActivity?: Date;
}

export class ClusterDetector {
  private db: Pool;
  private fundingTracker: FundingTracker;
  private isRunning = false;
  private tablesExist: boolean | null = null;

  constructor(db: Pool, fundingTracker: FundingTracker) {
    this.db = db;
    this.fundingTracker = fundingTracker;
  }

  /**
   * Check if cluster tables exist
   */
  private async checkTablesExist(): Promise<boolean> {
    if (this.tablesExist !== null) return this.tablesExist;

    try {
      const { rows } = await this.db.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'wallet_clusters'
        ) as exists
      `);
      this.tablesExist = rows[0]?.exists === true;
      return this.tablesExist;
    } catch {
      this.tablesExist = false;
      return false;
    }
  }

  /**
   * Main detection routine - runs all detection methods
   */
  async detectAllClusters(): Promise<void> {
    if (this.isRunning) {
      console.log('[ClusterDetector] Detection already in progress');
      return;
    }

    this.isRunning = true;
    console.log('[ClusterDetector] Starting cluster detection...');
    const startTime = Date.now();

    try {
      // Phase 1: Funding-based clustering
      await this.detectFundingClusters();

      // Phase 2: Timing-based clustering (trades within seconds)
      await this.detectTimingClusters();

      // Phase 3: Merge overlapping clusters
      await this.mergeOverlappingClusters();

      // Phase 4: Update all cluster stats
      await this.updateAllClusterStats();

      // Phase 5: Take daily snapshots
      await this.takeClusterSnapshots();

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[ClusterDetector] Detection complete in ${elapsed}s`);
    } catch (err) {
      console.error('[ClusterDetector] Error during detection:', err);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Detect clusters based on common funding sources
   * Wallets funded from the same address are likely related
   */
  async detectFundingClusters(): Promise<number> {
    console.log('[ClusterDetector] Detecting funding-based clusters...');

    // Find funding sources that funded multiple wallets
    const { rows: fundingSources } = await this.db.query(`
      SELECT
        counterparty,
        counterparty_type,
        COUNT(DISTINCT wallet_address) as wallet_count,
        SUM(amount) as total_funded,
        ARRAY_AGG(DISTINCT wallet_address) as wallets
      FROM funding_events
      WHERE direction = 'deposit'
        AND counterparty_type = 'wallet'  -- Only wallet-to-wallet transfers
        AND amount >= 100  -- Meaningful amounts
      GROUP BY counterparty, counterparty_type
      HAVING COUNT(DISTINCT wallet_address) >= 2
      ORDER BY wallet_count DESC
    `);

    let clustersCreated = 0;

    for (const source of fundingSources) {
      const wallets: string[] = source.wallets;

      // Check if these wallets are already in a cluster together
      const existingCluster = await this.findExistingClusterForWallets(wallets);

      if (existingCluster) {
        // Add any new members to existing cluster
        await this.addMembersToCluster(existingCluster, wallets, source.counterparty);
      } else {
        // Create new cluster
        await this.createFundingCluster(
          wallets,
          source.counterparty,
          source.counterparty_type,
          parseFloat(source.total_funded)
        );
        clustersCreated++;
      }
    }

    console.log(`[ClusterDetector] Created ${clustersCreated} funding-based clusters`);
    return clustersCreated;
  }

  /**
   * Create a new cluster based on funding pattern
   */
  private async createFundingCluster(
    wallets: string[],
    fundingSource: string,
    fundingSourceType: string,
    totalFunded: number
  ): Promise<string> {
    // Calculate confidence based on funding pattern strength
    const confidence = this.calculateFundingConfidence(wallets.length, totalFunded);

    const { rows } = await this.db.query(`
      INSERT INTO wallet_clusters (
        detection_method, confidence, member_count,
        funding_source, funding_source_type, total_funded
      ) VALUES ('funding_pattern', $1, $2, $3, $4, $5)
      RETURNING cluster_id
    `, [confidence, wallets.length, fundingSource, fundingSourceType, totalFunded]);

    const clusterId = rows[0].cluster_id;

    // Add members
    for (const wallet of wallets) {
      await this.addWalletToCluster(clusterId, wallet, 'receiving');
    }

    // Add funding source wallet if it exists in our system
    const { rows: sourceWallet } = await this.db.query(
      'SELECT address FROM wallets WHERE address = $1',
      [fundingSource.toLowerCase()]
    );

    if (sourceWallet.length > 0) {
      await this.addWalletToCluster(clusterId, fundingSource, 'funding');
    }

    // Update wallet cluster_id reference
    await this.db.query(`
      UPDATE wallets SET cluster_id = $1
      WHERE address = ANY($2)
    `, [clusterId, wallets]);

    return clusterId;
  }

  /**
   * Calculate confidence score for funding-based cluster
   */
  private calculateFundingConfidence(memberCount: number, totalFunded: number): number {
    // More members and higher funding = higher confidence
    let confidence = 0.5;

    // Member count factor (2-3 = +0.1, 4-5 = +0.2, 6+ = +0.3)
    if (memberCount >= 6) confidence += 0.3;
    else if (memberCount >= 4) confidence += 0.2;
    else confidence += 0.1;

    // Funding amount factor
    if (totalFunded >= 100000) confidence += 0.2;
    else if (totalFunded >= 10000) confidence += 0.1;

    return Math.min(confidence, 0.99);
  }

  /**
   * Detect clusters based on synchronized trading timing
   * Wallets that trade the same market within seconds of each other
   */
  async detectTimingClusters(): Promise<number> {
    console.log('[ClusterDetector] Detecting timing-based clusters...');

    // Find wallets that traded the same market within 60 seconds of each other
    const { rows: timingPatterns } = await this.db.query(`
      WITH trade_pairs AS (
        SELECT
          t1.wallet_address as wallet1,
          t2.wallet_address as wallet2,
          t1.condition_id,
          t1.timestamp as time1,
          t2.timestamp as time2,
          ABS(EXTRACT(EPOCH FROM (t1.timestamp - t2.timestamp))) as time_diff
        FROM whale_trades t1
        JOIN whale_trades t2 ON t1.condition_id = t2.condition_id
          AND t1.wallet_address < t2.wallet_address  -- Avoid duplicates
          AND ABS(EXTRACT(EPOCH FROM (t1.timestamp - t2.timestamp))) <= 60
        WHERE t1.timestamp > NOW() - INTERVAL '30 days'
      )
      SELECT
        wallet1, wallet2,
        COUNT(*) as coincidence_count,
        AVG(time_diff) as avg_time_diff
      FROM trade_pairs
      GROUP BY wallet1, wallet2
      HAVING COUNT(*) >= 3  -- At least 3 coincidences
      ORDER BY coincidence_count DESC
    `);

    let clustersCreated = 0;

    for (const pattern of timingPatterns) {
      const wallets = [pattern.wallet1, pattern.wallet2];

      // Check if already clustered
      const existingCluster = await this.findExistingClusterForWallets(wallets);

      if (!existingCluster) {
        // Calculate confidence based on coincidence count and timing
        const confidence = Math.min(
          0.5 + (pattern.coincidence_count * 0.05) + (1 / (pattern.avg_time_diff + 1)) * 0.2,
          0.95
        );

        const { rows } = await this.db.query(`
          INSERT INTO wallet_clusters (
            detection_method, confidence, member_count, metadata
          ) VALUES ('timing', $1, 2, $2)
          RETURNING cluster_id
        `, [
          confidence,
          JSON.stringify({
            coincidenceCount: pattern.coincidence_count,
            avgTimeDiff: pattern.avg_time_diff,
          }),
        ]);

        const clusterId = rows[0].cluster_id;

        await this.addWalletToCluster(clusterId, pattern.wallet1, 'unknown');
        await this.addWalletToCluster(clusterId, pattern.wallet2, 'unknown');

        clustersCreated++;
      }
    }

    console.log(`[ClusterDetector] Created ${clustersCreated} timing-based clusters`);
    return clustersCreated;
  }

  /**
   * Find if wallets are already in a cluster together
   */
  private async findExistingClusterForWallets(wallets: string[]): Promise<string | null> {
    const { rows } = await this.db.query(`
      SELECT cluster_id, COUNT(*) as member_match
      FROM wallet_cluster_members
      WHERE wallet_address = ANY($1)
      GROUP BY cluster_id
      HAVING COUNT(*) >= 2
      ORDER BY member_match DESC
      LIMIT 1
    `, [wallets]);

    return rows[0]?.cluster_id || null;
  }

  /**
   * Add a wallet to a cluster
   */
  private async addWalletToCluster(
    clusterId: string,
    walletAddress: string,
    role: string
  ): Promise<void> {
    // Get funding info for this wallet
    const { rows: funding } = await this.db.query(`
      SELECT SUM(amount) as total, MIN(timestamp) as first_date
      FROM funding_events
      WHERE wallet_address = $1 AND direction = 'deposit'
    `, [walletAddress.toLowerCase()]);

    await this.db.query(`
      INSERT INTO wallet_cluster_members (
        wallet_address, cluster_id, role, funding_amount, funding_date
      ) VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (wallet_address, cluster_id) DO UPDATE SET
        role = EXCLUDED.role,
        funding_amount = EXCLUDED.funding_amount,
        funding_date = EXCLUDED.funding_date
    `, [
      walletAddress.toLowerCase(),
      clusterId,
      role,
      funding[0]?.total || 0,
      funding[0]?.first_date || null,
    ]);
  }

  /**
   * Add new members to an existing cluster
   */
  private async addMembersToCluster(
    clusterId: string,
    wallets: string[],
    fundingSource: string
  ): Promise<void> {
    for (const wallet of wallets) {
      await this.addWalletToCluster(clusterId, wallet, 'receiving');
    }

    // Update cluster stats
    await this.updateClusterStats(clusterId);
  }

  /**
   * Merge clusters that share members
   */
  async mergeOverlappingClusters(): Promise<number> {
    console.log('[ClusterDetector] Checking for overlapping clusters...');

    // Find wallets that belong to multiple clusters
    const { rows: overlaps } = await this.db.query(`
      SELECT
        wallet_address,
        ARRAY_AGG(cluster_id ORDER BY cluster_id) as clusters
      FROM wallet_cluster_members
      GROUP BY wallet_address
      HAVING COUNT(*) > 1
    `);

    let mergeCount = 0;

    for (const overlap of overlaps) {
      const clusters: string[] = overlap.clusters;

      // Keep the first cluster, merge others into it
      const primaryCluster = clusters[0];
      const clustersToMerge = clusters.slice(1);

      for (const clusterToMerge of clustersToMerge) {
        await this.mergeClusters(primaryCluster, clusterToMerge);
        mergeCount++;
      }
    }

    console.log(`[ClusterDetector] Merged ${mergeCount} overlapping clusters`);
    return mergeCount;
  }

  /**
   * Merge one cluster into another
   */
  private async mergeClusters(targetCluster: string, sourceCluster: string): Promise<void> {
    // Move all members to target cluster
    await this.db.query(`
      UPDATE wallet_cluster_members
      SET cluster_id = $1
      WHERE cluster_id = $2
        AND wallet_address NOT IN (
          SELECT wallet_address FROM wallet_cluster_members WHERE cluster_id = $1
        )
    `, [targetCluster, sourceCluster]);

    // Update wallet references
    await this.db.query(`
      UPDATE wallets SET cluster_id = $1
      WHERE cluster_id = $2
    `, [targetCluster, sourceCluster]);

    // Delete the source cluster
    await this.db.query(`
      DELETE FROM wallet_cluster_members WHERE cluster_id = $1
    `, [sourceCluster]);

    await this.db.query(`
      DELETE FROM wallet_clusters WHERE cluster_id = $1
    `, [sourceCluster]);

    // Update target cluster stats
    await this.updateClusterStats(targetCluster);
  }

  /**
   * Update stats for a specific cluster
   */
  async updateClusterStats(clusterId: string): Promise<void> {
    await this.db.query('SELECT update_cluster_stats($1)', [clusterId]);
  }

  /**
   * Update stats for all clusters
   */
  async updateAllClusterStats(): Promise<void> {
    console.log('[ClusterDetector] Updating all cluster stats...');

    const { rows: clusters } = await this.db.query(`
      SELECT cluster_id FROM wallet_clusters WHERE is_active = TRUE
    `);

    for (const cluster of clusters) {
      await this.updateClusterStats(cluster.cluster_id);
    }

    console.log(`[ClusterDetector] Updated stats for ${clusters.length} clusters`);
  }

  /**
   * Take daily snapshots of cluster state for ML training
   */
  async takeClusterSnapshots(): Promise<void> {
    const today = new Date().toISOString().split('T')[0];

    await this.db.query(`
      INSERT INTO cluster_snapshots (
        cluster_id, snapshot_date, member_count, total_volume,
        total_pnl, avg_win_rate, avg_insider_score
      )
      SELECT
        cluster_id, $1::date, member_count, total_volume,
        total_pnl, avg_win_rate, avg_insider_score
      FROM wallet_clusters
      WHERE is_active = TRUE
      ON CONFLICT (cluster_id, snapshot_date) DO UPDATE SET
        member_count = EXCLUDED.member_count,
        total_volume = EXCLUDED.total_volume,
        total_pnl = EXCLUDED.total_pnl,
        avg_win_rate = EXCLUDED.avg_win_rate,
        avg_insider_score = EXCLUDED.avg_insider_score
    `, [today]);
  }

  /**
   * Get cluster by ID with full details
   */
  async getCluster(clusterId: string): Promise<Cluster | null> {
    if (!await this.checkTablesExist()) return null;

    const { rows: clusters } = await this.db.query(`
      SELECT
        c.*,
        (
          SELECT json_agg(json_build_object(
            'address', w.address,
            'role', wcm.role,
            'volume', w.total_volume,
            'pnl', w.realized_pnl,
            'winRate', CASE WHEN (w.win_count + w.loss_count) > 0
              THEN w.win_count::numeric / (w.win_count + w.loss_count)
              ELSE 0 END,
            'insiderScore', w.insider_score,
            'fundingAmount', wcm.funding_amount,
            'fundingDate', wcm.funding_date
          ) ORDER BY w.total_volume DESC)
          FROM wallet_cluster_members wcm
          JOIN wallets w ON wcm.wallet_address = w.address
          WHERE wcm.cluster_id = c.cluster_id
        ) as members
      FROM wallet_clusters c
      WHERE c.cluster_id = $1
    `, [clusterId]);

    if (clusters.length === 0) return null;

    const c = clusters[0];
    return {
      clusterId: c.cluster_id,
      detectionMethod: c.detection_method,
      confidence: parseFloat(c.confidence),
      memberCount: c.member_count,
      totalVolume: parseFloat(c.total_volume),
      totalPnl: parseFloat(c.total_pnl || 0),
      avgWinRate: parseFloat(c.avg_win_rate || 0),
      avgInsiderScore: c.avg_insider_score || 0,
      marketsTraded: c.markets_traded || 0,
      fundingSource: c.funding_source,
      fundingSourceType: c.funding_source_type,
      totalFunded: parseFloat(c.total_funded || 0),
      members: c.members || [],
      createdAt: c.created_at,
      lastActivity: c.last_activity,
    };
  }

  /**
   * Get cluster for a specific wallet
   */
  async getClusterForWallet(walletAddress: string): Promise<Cluster | null> {
    if (!await this.checkTablesExist()) return null;

    const { rows } = await this.db.query(`
      SELECT cluster_id FROM wallets WHERE address = $1 AND cluster_id IS NOT NULL
    `, [walletAddress.toLowerCase()]);

    if (rows.length === 0) return null;

    return this.getCluster(rows[0].cluster_id);
  }

  /**
   * List all clusters with optional filters
   */
  async listClusters(options: {
    method?: string;
    minMembers?: number;
    minVolume?: number;
    limit?: number;
    offset?: number;
  } = {}): Promise<{ clusters: Cluster[]; total: number }> {
    if (!await this.checkTablesExist()) {
      return { clusters: [], total: 0 };
    }

    const { method, minMembers = 2, minVolume = 0, limit = 50, offset = 0 } = options;

    let whereClause = 'WHERE is_active = TRUE AND member_count >= $1 AND total_volume >= $2';
    const params: any[] = [minMembers, minVolume];

    if (method) {
      params.push(method);
      whereClause += ` AND detection_method = $${params.length}`;
    }

    const { rows: countRows } = await this.db.query(`
      SELECT COUNT(*) as total FROM wallet_clusters ${whereClause}
    `, params);

    params.push(limit, offset);
    const { rows: clusters } = await this.db.query(`
      SELECT
        cluster_id, detection_method, confidence, member_count,
        total_volume, total_pnl, avg_win_rate, avg_insider_score,
        markets_traded, funding_source, funding_source_type,
        total_funded, created_at, last_activity
      FROM wallet_clusters
      ${whereClause}
      ORDER BY total_volume DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    return {
      clusters: clusters.map(c => ({
        clusterId: c.cluster_id,
        detectionMethod: c.detection_method,
        confidence: parseFloat(c.confidence),
        memberCount: c.member_count,
        totalVolume: parseFloat(c.total_volume),
        totalPnl: parseFloat(c.total_pnl || 0),
        avgWinRate: parseFloat(c.avg_win_rate || 0),
        avgInsiderScore: c.avg_insider_score || 0,
        marketsTraded: c.markets_traded || 0,
        fundingSource: c.funding_source,
        fundingSourceType: c.funding_source_type,
        totalFunded: parseFloat(c.total_funded || 0),
        members: [],
        createdAt: c.created_at,
        lastActivity: c.last_activity,
      })),
      total: parseInt(countRows[0].total),
    };
  }

  /**
   * Get recent trades by cluster members
   */
  async getClusterTrades(clusterId: string, limit = 50): Promise<any[]> {
    const { rows } = await this.db.query(`
      SELECT
        wt.*,
        m.question,
        wcm.role as member_role
      FROM whale_trades wt
      JOIN wallet_cluster_members wcm ON wt.wallet_address = wcm.wallet_address
      JOIN markets m ON wt.condition_id = m.condition_id
      WHERE wcm.cluster_id = $1
      ORDER BY wt.timestamp DESC
      LIMIT $2
    `, [clusterId, limit]);

    return rows;
  }

  /**
   * Start scheduled detection
   */
  startScheduled(intervalMs = 60 * 60 * 1000): void {
    // Run immediately
    this.detectAllClusters();

    // Then run hourly
    setInterval(() => {
      this.detectAllClusters();
    }, intervalMs);

    console.log(`[ClusterDetector] Scheduled to run every ${intervalMs / 1000 / 60} minutes`);
  }
}
