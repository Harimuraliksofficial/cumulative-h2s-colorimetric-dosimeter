import modelWeights from '../../datasets/vasdhara_model_weights.json';

export interface ScanFeatures {
  r_norm: number;
  g_norm: number;
  b_norm: number;
  h: number;
  s: number;
  v: number;
  darkness_index: number;
  temperature: number;
  humidity: number;
}

export interface InferenceResult {
  exposure_ppm_h: number;
  status: 'SAFE' | 'ADVISORY' | 'CRITICAL' | 'FATAL_ENV_OUT_OF_BOUNDS';
  message: string;
}

/**
 * Executes zero-dependency RBF kernel evaluation for SVR on the mobile device.
 */
export function predictDosimeterExposure(inputs: ScanFeatures): InferenceResult {
  // 1. Environmental Boundary Enforcement Gate
  if (inputs.temperature > modelWeights.temp_cutoff || inputs.humidity > modelWeights.rh_cutoff) {
    return {
      exposure_ppm_h: 0.0,
      status: 'FATAL_ENV_OUT_OF_BOUNDS',
      message: 'ENVIRONMENT EXCEEDED OPERATIONAL THRESHOLD (>50°C or >95% RH)',
    };
  }

  const rawVector = [
    inputs.r_norm,
    inputs.g_norm,
    inputs.b_norm,
    inputs.h,
    inputs.s,
    inputs.v,
    inputs.darkness_index,
    inputs.temperature,
    inputs.humidity,
  ];

  // 2. Feature Standardization (Z-score scaling)
  const scaledVector: number[] = rawVector.map((val, idx) => {
    return (val - modelWeights.scaler_mean[idx]) / modelWeights.scaler_scale[idx];
  });

  // 3. Radial Basis Function (RBF) Kernel Evaluation
  // K(x, x') = exp(-gamma * ||x - x'||^2)
  let decisionValue = modelWeights.intercept;
  const numSupportVectors = modelWeights.support_vectors.length;

  for (let i = 0; i < numSupportVectors; i++) {
    const sv = modelWeights.support_vectors[i];
    let squaredDistance = 0.0;
    for (let j = 0; j < scaledVector.length; j++) {
      const diff = scaledVector[j] - sv[j];
      squaredDistance += diff * diff;
    }
    const kernelVal = Math.exp(-modelWeights.gamma * squaredDistance);
    decisionValue += modelWeights.dual_coef[i] * kernelVal;
  }

  const exposure = Math.max(0.0, parseFloat(decisionValue.toFixed(2)));

  // 4. Industrial Regulatory Classification (OSHA / ACGIH Standards)
  let status: 'SAFE' | 'ADVISORY' | 'CRITICAL' = 'SAFE';
  let message = 'COMPLIANT / WITHIN SAFE SHIFT LIMITS';

  if (exposure > 10.0) {
    status = 'CRITICAL';
    message = 'CEILING THRESHOLD EXCEEDED — MANDATORY EVACUATION';
  } else if (exposure > 5.0) {
    status = 'ADVISORY';
    message = 'ACTION LEVEL REACHED — EHS SUPERVISOR NOTIFIED';
  }

  return {
    exposure_ppm_h: exposure,
    status,
    message,
  };
}
