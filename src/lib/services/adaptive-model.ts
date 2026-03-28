/**
 * Adaptive Walk-Forward Model
 *
 * Learns optimal feature weights from past backtest periods using
 * ridge regression. No external ML libraries — pure TypeScript.
 *
 * At each rebalance date:
 *   1. Collect (features, actual_return) pairs from past N periods
 *   2. Run ridge regression to find optimal weights
 *   3. Use learned weights to score stocks for the next period
 *
 * This is a proper walk-forward ML model:
 *   - No look-ahead bias (only trains on past data)
 *   - Adapts to changing market conditions
 *   - Regularized to prevent overfitting (ridge/L2 penalty)
 */

/**
 * Ridge regression: find weights w that minimize ||Xw - y||² + λ||w||²
 *
 * Closed-form solution: w = (X'X + λI)⁻¹ X'y
 *
 * @param X Feature matrix (rows = samples, cols = features)
 * @param y Target vector (actual returns)
 * @param lambda Regularization strength (higher = more shrinkage)
 * @returns Weight vector
 */
export function ridgeRegression(
  X: number[][],
  y: number[],
  lambda: number = 1.0,
): number[] {
  const n = X.length;      // number of samples
  const p = X[0]?.length ?? 0; // number of features
  if (n === 0 || p === 0 || n !== y.length) return [];

  // Compute X'X (p x p)
  const XtX: number[][] = Array.from({ length: p }, () => Array(p).fill(0));
  for (let i = 0; i < p; i++) {
    for (let j = i; j < p; j++) {
      let sum = 0;
      for (let k = 0; k < n; k++) {
        sum += X[k][i] * X[k][j];
      }
      XtX[i][j] = sum;
      XtX[j][i] = sum; // symmetric
    }
  }

  // Add ridge penalty: X'X + λI
  for (let i = 0; i < p; i++) {
    XtX[i][i] += lambda;
  }

  // Compute X'y (p x 1)
  const Xty: number[] = Array(p).fill(0);
  for (let i = 0; i < p; i++) {
    let sum = 0;
    for (let k = 0; k < n; k++) {
      sum += X[k][i] * y[k];
    }
    Xty[i] = sum;
  }

  // Solve (X'X + λI)w = X'y via Cholesky decomposition
  const w = solveSymmetricPositiveDefinite(XtX, Xty);
  return w;
}

/**
 * Solve Ax = b for symmetric positive definite A using Cholesky decomposition.
 * Falls back to simple Gaussian elimination if Cholesky fails.
 */
function solveSymmetricPositiveDefinite(A: number[][], b: number[]): number[] {
  const n = A.length;
  if (n === 0) return [];

  // Cholesky: A = LL'
  const L: number[][] = Array.from({ length: n }, () => Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = 0;
      for (let k = 0; k < j; k++) {
        sum += L[i][k] * L[j][k];
      }
      if (i === j) {
        const diag = A[i][i] - sum;
        if (diag <= 0) {
          // Not positive definite — fall back to pseudo-inverse approach
          return leastSquaresFallback(A, b);
        }
        L[i][j] = Math.sqrt(diag);
      } else {
        L[i][j] = (A[i][j] - sum) / L[j][j];
      }
    }
  }

  // Forward substitution: Ly = b
  const y: number[] = Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let k = 0; k < i; k++) {
      sum += L[i][k] * y[k];
    }
    y[i] = (b[i] - sum) / L[i][i];
  }

  // Back substitution: L'x = y
  const x: number[] = Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let sum = 0;
    for (let k = i + 1; k < n; k++) {
      sum += L[k][i] * x[k];
    }
    x[i] = (y[i] - sum) / L[i][i];
  }

  return x;
}

/** Simple fallback: use gradient descent if Cholesky fails */
function leastSquaresFallback(A: number[][], b: number[]): number[] {
  const n = A.length;
  const x: number[] = Array(n).fill(0);
  const lr = 0.001;
  const iterations = 200;

  for (let iter = 0; iter < iterations; iter++) {
    // Compute Ax - b
    const residual: number[] = Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let j = 0; j < n; j++) {
        sum += A[i][j] * x[j];
      }
      residual[i] = sum - b[i];
    }

    // Gradient step: x -= lr * residual
    for (let i = 0; i < n; i++) {
      x[i] -= lr * residual[i];
    }
  }

  return x;
}

/**
 * Features to extract from a FeatureVector for the adaptive model.
 * These are the features the ridge regression will learn weights for.
 */
export const ADAPTIVE_FEATURE_KEYS = [
  // Momentum (most predictive historically)
  "return_5d", "return_10d", "return_20d", "return_60d",
  // Technicals
  "rsi_14", "bollinger_position", "macd_histogram", "volume_ratio",
  // Trend
  "price_vs_sma20", "price_vs_sma50", "price_vs_sma200",
  "year_position", "drawdown_from_high",
  // Volatility
  "volatility_20d", "mean_reversion_z",
  // Fundamentals
  "pe", "pb", "roe", "revenue_growth", "earnings_growth", "dcf_upside",
  // Z-scored cross-sectional
  "z_return_20d", "z_return_60d", "z_volume_ratio",
  "z_pe", "z_dcf_upside", "z_roe",
  // Advanced momentum
  "momentum_quality", "momentum_accel", "vol_contraction",
  // Market-level aggregate
  "mkt_avg_momentum", "mkt_breadth", "mkt_dispersion", "mkt_avg_rsi", "mkt_avg_vol",
];

/**
 * Extract a feature row from a features record.
 * Missing features are set to 0.
 */
export function extractFeatureRow(
  features: Record<string, number>,
  keys: string[] = ADAPTIVE_FEATURE_KEYS,
): number[] {
  return keys.map((k) => {
    const v = features[k];
    return v != null && isFinite(v) ? v : 0;
  });
}

/**
 * Score stocks using learned weights.
 * Returns a score per stock (higher = better predicted return).
 */
export function scoreWithWeights(
  featureRow: number[],
  weights: number[],
): number {
  let score = 0;
  const len = Math.min(featureRow.length, weights.length);
  for (let i = 0; i < len; i++) {
    score += featureRow[i] * weights[i];
  }
  return score;
}

/**
 * Train-and-predict for one rebalance period.
 *
 * @param trainingData Past periods: { features: number[], actualReturn: number }[]
 * @param currentFeatures Feature rows for stocks to score this period
 * @param lambda Ridge regularization (default 10.0 for small sample sizes)
 * @returns Predicted scores for each stock (higher = expected outperformance)
 */
export function adaptivePredict(
  trainingData: { features: number[]; actualReturn: number }[],
  currentFeatures: number[][],
  lambda: number = 10.0,
): number[] {
  if (trainingData.length < 10) {
    // Not enough training data — return zeros (fall back to base model)
    return currentFeatures.map(() => 0);
  }

  const X = trainingData.map((d) => d.features);
  const y = trainingData.map((d) => d.actualReturn);

  const weights = ridgeRegression(X, y, lambda);
  if (weights.length === 0) return currentFeatures.map(() => 0);

  return currentFeatures.map((row) => scoreWithWeights(row, weights));
}
