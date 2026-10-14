/**
 * Jest mock for expo-file-system and expo-file-system/legacy
 */

export const documentDirectory = 'file:///data/user/0/documents/';
export const cacheDirectory = 'file:///data/user/0/cache/';
export const bundleDirectory = 'file:///bundle/';

export const writeAsStringAsync = jest.fn(async () => Promise.resolve());
export const readAsStringAsync = jest.fn(async () => Promise.resolve(''));
export const getInfoAsync = jest.fn(async () => Promise.resolve({ exists: true, isDirectory: false, size: 100 }));
export const deleteAsync = jest.fn(async () => Promise.resolve());

export enum EncodingType {
  UTF8 = 'utf8',
  Base64 = 'base64',
}

export class Paths {
  static get cache() {
    return { uri: cacheDirectory };
  }
  static get document() {
    return { uri: documentDirectory };
  }
}
