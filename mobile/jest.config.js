module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts', '**/?(*.)+(spec|test).ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          target: 'ES2022',
          module: 'commonjs',
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          types: ['jest', 'node'],
        },
      },
    ],
  },
  moduleNameMapper: {
    '^react-native$': '<rootDir>/__mocks__/react-native.ts',
    '^expo-sqlite$': '<rootDir>/__mocks__/expo-sqlite.ts',
    '^expo-file-system(/.*)?$': '<rootDir>/__mocks__/expo-file-system.ts',
    '^expo-sharing$': '<rootDir>/__mocks__/expo-sharing.ts',
    '^expo-document-picker$': '<rootDir>/__mocks__/expo-document-picker.ts',
  },
};
