module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: [
    '<rootDir>/../../packages/ui/test/native-input-setup.ts',
  ],
  testMatch: ['<rootDir>/test/**/*.test.ts?(x)'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@quicktrimr/ui$': '<rootDir>/../../packages/ui/src/index.ts',
  },
};
