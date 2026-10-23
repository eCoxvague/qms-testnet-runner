import { gunzipSync } from 'node:zlib';
import { err } from './messages.mjs';

// Matrix Market array/symmetric stores the lower triangle in column order.
// Calculate x^T Q x using integers: these coefficients exceed JS's safe Number range.
export function verifyQubo(bytes, metadata) {
  const text = gunzipSync(bytes, { maxOutputLength: 64 * 1024 * 1024 }).toString('utf8');
  const lines = text.split(/\r?\n/);
  if (lines.shift()?.trim() !== '%%MatrixMarket matrix array integer symmetric')
    throw new Error(err.quboFormat);
  const values = lines.filter(line => line.trim() && !line.startsWith('%'));
  const dimensions = values.shift().trim().split(/\s+/).map(Number);
  const [rows, cols] = dimensions;
  if (dimensions.length !== 2 || !Number.isSafeInteger(rows) || rows < 1 || rows > 4096 || rows !== cols)
    throw new Error(err.quboSize);
  const solution = metadata.solution;
  if (typeof solution !== 'string' || !/^[01]+$/.test(solution) || solution.length !== rows
      || Number(metadata.problem_size) !== rows || Number(metadata.solution_length) !== rows)
    throw new Error(err.quboSolution);
  if (values.length !== rows * (rows + 1) / 2) throw new Error(err.quboCoeffs);
  let objective = 0n;
  let index = 0;
  for (let col = 0; col < cols; col++) {
    for (let row = col; row < rows; row++) {
      const raw = values[index++].trim();
      if (!/^-?\d+$/.test(raw)) throw new Error(err.quboInt);
      if (solution[col] === '1' && solution[row] === '1')
        objective += BigInt(raw) * (row === col ? 1n : 2n);
    }
  }
  if (objective.toString() !== String(metadata.objective_value)) throw new Error(err.quboObjective);
  return { verified: true, variables: rows, coefficients: values.length,
    computedObjective: objective.toString(), note: '已验证给定解的目标值；未证明全局最优。' };
}
