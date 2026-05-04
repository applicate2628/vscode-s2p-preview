import type { ComplexValue, TouchstoneDocument, TouchstoneSample } from "./touchstone";

const ZERO: ComplexValue = { re: 0, im: 0 };
const ONE: ComplexValue = { re: 1, im: 0 };

export function effectiveReferenceOhms(
  sourceReferenceOhms: readonly number[],
  targetOhms: readonly number[],
  selectedPorts: readonly boolean[]
): number[] {
  return sourceReferenceOhms.map((sourceOhms, index) => {
    assertPositiveOhms(sourceOhms, `Source impedance for port ${index + 1}`);
    if (!selectedPorts[index]) {
      return sourceOhms;
    }

    const target = targetOhms[index];
    assertPositiveOhms(target, `Target impedance for port ${index + 1}`);
    return target;
  });
}

export function renormalizeDocument(
  doc: TouchstoneDocument,
  targetOhms: readonly number[],
  selectedPorts: readonly boolean[]
): TouchstoneDocument {
  const nextReferenceOhms = effectiveReferenceOhms(doc.referenceOhms, targetOhms, selectedPorts);

  return {
    ...doc,
    referenceOhms: nextReferenceOhms,
    samples: doc.samples.map((sample) => renormalizeSample(sample, doc.referenceOhms, nextReferenceOhms))
  };
}

function renormalizeSample(
  sample: TouchstoneSample,
  sourceReferenceOhms: readonly number[],
  targetReferenceOhms: readonly number[]
): TouchstoneSample {
  const z = sToZ(sample.matrix, sourceReferenceOhms);
  return {
    freqGHz: sample.freqGHz,
    matrix: zToS(z, targetReferenceOhms)
  };
}

function sToZ(s: ComplexValue[][], referenceOhms: readonly number[]): ComplexValue[][] {
  const size = s.length;
  const identity = identityMatrix(size);
  const normalized = multiplyMatrices(
    addMatrices(identity, s),
    inverseMatrix(subtractMatrices(identity, s))
  );

  return scaleByReference(normalized, referenceOhms, false);
}

function zToS(z: ComplexValue[][], referenceOhms: readonly number[]): ComplexValue[][] {
  const size = z.length;
  const identity = identityMatrix(size);
  const normalized = scaleByReference(z, referenceOhms, true);

  return multiplyMatrices(
    subtractMatrices(normalized, identity),
    inverseMatrix(addMatrices(normalized, identity))
  );
}

function scaleByReference(matrix: ComplexValue[][], referenceOhms: readonly number[], inverse: boolean): ComplexValue[][] {
  return matrix.map((row, rowIndex) =>
    row.map((value, columnIndex) => {
      const rowScale = Math.sqrt(referenceOhms[rowIndex]);
      const columnScale = Math.sqrt(referenceOhms[columnIndex]);
      const scale = inverse ? 1 / (rowScale * columnScale) : rowScale * columnScale;
      return multiplyByReal(value, scale);
    })
  );
}

function identityMatrix(size: number): ComplexValue[][] {
  return Array.from({ length: size }, (_, rowIndex) =>
    Array.from({ length: size }, (_, columnIndex) => rowIndex === columnIndex ? ONE : ZERO)
  );
}

function addMatrices(left: ComplexValue[][], right: ComplexValue[][]): ComplexValue[][] {
  return left.map((row, rowIndex) =>
    row.map((value, columnIndex) => add(value, right[rowIndex][columnIndex]))
  );
}

function subtractMatrices(left: ComplexValue[][], right: ComplexValue[][]): ComplexValue[][] {
  return left.map((row, rowIndex) =>
    row.map((value, columnIndex) => subtract(value, right[rowIndex][columnIndex]))
  );
}

function multiplyMatrices(left: ComplexValue[][], right: ComplexValue[][]): ComplexValue[][] {
  const size = left.length;
  const result = createMatrix(size);

  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      let sum = ZERO;
      for (let index = 0; index < size; index += 1) {
        sum = add(sum, multiply(left[row][index], right[index][column]));
      }
      result[row][column] = sum;
    }
  }

  return result;
}

function inverseMatrix(matrix: ComplexValue[][]): ComplexValue[][] {
  const size = matrix.length;
  const augmented = matrix.map((row, rowIndex) => [
    ...row.map(cloneComplex),
    ...identityMatrix(size)[rowIndex].map(cloneComplex)
  ]);

  for (let column = 0; column < size; column += 1) {
    const pivotRow = findPivotRow(augmented, column);
    if (pivotRow === -1) {
      throw new Error("Cannot renormalize Touchstone data because an intermediate matrix is singular.");
    }

    if (pivotRow !== column) {
      const swap = augmented[column];
      augmented[column] = augmented[pivotRow];
      augmented[pivotRow] = swap;
    }

    const pivot = augmented[column][column];
    for (let item = 0; item < size * 2; item += 1) {
      augmented[column][item] = divide(augmented[column][item], pivot);
    }

    for (let row = 0; row < size; row += 1) {
      if (row === column) {
        continue;
      }

      const factor = augmented[row][column];
      for (let item = 0; item < size * 2; item += 1) {
        augmented[row][item] = subtract(augmented[row][item], multiply(factor, augmented[column][item]));
      }
    }
  }

  return augmented.map((row) => row.slice(size));
}

function findPivotRow(matrix: ComplexValue[][], column: number): number {
  let bestRow = -1;
  let bestMagnitude = 0;

  for (let row = column; row < matrix.length; row += 1) {
    const magnitude = Math.hypot(matrix[row][column].re, matrix[row][column].im);
    if (magnitude > bestMagnitude) {
      bestMagnitude = magnitude;
      bestRow = row;
    }
  }

  return bestMagnitude > 1e-15 ? bestRow : -1;
}

function createMatrix(size: number): ComplexValue[][] {
  return Array.from({ length: size }, () =>
    Array.from({ length: size }, () => ({ re: 0, im: 0 }))
  );
}

function add(left: ComplexValue, right: ComplexValue): ComplexValue {
  return { re: left.re + right.re, im: left.im + right.im };
}

function subtract(left: ComplexValue, right: ComplexValue): ComplexValue {
  return { re: left.re - right.re, im: left.im - right.im };
}

function multiply(left: ComplexValue, right: ComplexValue): ComplexValue {
  return {
    re: left.re * right.re - left.im * right.im,
    im: left.re * right.im + left.im * right.re
  };
}

function multiplyByReal(value: ComplexValue, scale: number): ComplexValue {
  return { re: value.re * scale, im: value.im * scale };
}

function divide(left: ComplexValue, right: ComplexValue): ComplexValue {
  const denominator = right.re * right.re + right.im * right.im;
  if (denominator <= 1e-30) {
    throw new Error("Cannot renormalize Touchstone data because an intermediate matrix is singular.");
  }

  return {
    re: (left.re * right.re + left.im * right.im) / denominator,
    im: (left.im * right.re - left.re * right.im) / denominator
  };
}

function cloneComplex(value: ComplexValue): ComplexValue {
  return { re: value.re, im: value.im };
}

function assertPositiveOhms(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be positive.`);
  }
}
