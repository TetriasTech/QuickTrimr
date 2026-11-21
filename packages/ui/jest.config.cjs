module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: [
    '<rootDir>/test/setup.ts',
    '<rootDir>/test/native-input-setup.ts',
  ],
  testMatch: ['<rootDir>/test/**/*.test.ts?(x)'],
};
