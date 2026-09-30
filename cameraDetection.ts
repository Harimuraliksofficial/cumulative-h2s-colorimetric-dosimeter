import { Dimensions } from 'react-native';

const { width, height } = Dimensions.get('window');

// Define the geometric coordinates breakdown to integrate into the scanning module:
// We simulate OpenCV detection logic.
export const CASSETTE_ZONES = {
  container: { x: width * 0.1, y: height * 0.2, width: width * 0.8, height: width * 0.8 },
};

export const getSubZones = (container: { x: number, y: number, width: number, height: number }) => {
  const { x, y, width, height } = container;
  const rowHeight = height / 3;
  return {
    h2s: { x: x, y: y, width: width * 0.7, height: rowHeight, label: 'H2S SENSING AREA' },
    qr: { x: x + width * 0.7, y: y, width: width * 0.3, height: rowHeight, label: 'QR CODE' },
    refColor: { x: x, y: y + rowHeight, width: width * 0.7, height: rowHeight, label: 'REFERENCE COLOUR SCALE' },
    aging: { x: x + width * 0.7, y: y + rowHeight, width: width * 0.3, height: rowHeight, label: 'AGING / PRE-AGED PATCH' },
    moisture: { x: x, y: y + rowHeight * 2, width: width, height: rowHeight, label: 'MOISTURE STRIP' },
  };
};

export type ScannerState = 'SEARCHING' | 'ALIGNING' | 'ANALYZING' | 'DAMAGED' | 'VALIDATED';

export function simulateOpenCVProcess(step: number): { state: ScannerState, moistureHue?: string } {
  if (step < 3) return { state: 'SEARCHING' };
  if (step < 6) return { state: 'ALIGNING' };
  if (step < 10) return { state: 'ANALYZING' };
  
  // 5% chance of simulating a damaged card
  if (Math.random() > 0.95) {
    return { state: 'DAMAGED', moistureHue: 'MAGENTA' };
  }
  
  return { state: 'VALIDATED', moistureHue: 'WHITE' };
}
