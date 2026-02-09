/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    transform: {
        // '^.+\\.[tj]sx?$' to process js/ts with `ts-jest`
        // '^.+\\.m?[tj]sx?$' to process js/ts/mjs/mts with `ts-jest`
        '^.+\\.tsx?$': [
            'ts-jest',
            {
                useESM: false,
                tsconfig: {
                    module: 'CommonJS',
                    moduleResolution: 'Node',
                },
            },
        ],
        '^.+\\.m?jsx?$': [
            'ts-jest',
            {
                useESM: false,
                tsconfig: {
                    allowJs: true,
                    module: 'CommonJS',
                    moduleResolution: 'Node',
                },
            },
        ],
    },
    moduleNameMapper: {
        '^(\\.{1,2}/.*)\\.js$': '$1',
    },
    transformIgnorePatterns: [
        '<rootDir>/node_modules/(?!(openid-client|oauth4webapi|jose)/)',
    ],
    coverageDirectory: 'coverage',
    collectCoverageFrom: [
        '**/*.{js,ts}',
        '!**/node_modules/**',
        '!**/dist/**',
        '!**/coverage/**',
        '!jest.config.cjs',
    ],
    testPathIgnorePatterns: ['<rootDir>/dist/', '<rootDir>/node_modules/'],
};
