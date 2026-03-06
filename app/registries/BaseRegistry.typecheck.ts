import BaseRegistry from './BaseRegistry.js';

type IsAny<T> = 0 extends 1 & T ? true : false;
type ExpectNotAny<T> = IsAny<T> extends true ? false : true;

const authenticateBasicRequestOptionsIsTyped: ExpectNotAny<
  Parameters<BaseRegistry['authenticateBasic']>[0]
> = true;
const authenticateBearerRequestOptionsIsTyped: ExpectNotAny<
  Parameters<BaseRegistry['authenticateBearer']>[0]
> = true;
const authenticateBearerFromAuthUrlRequestOptionsIsTyped: ExpectNotAny<
  Parameters<BaseRegistry['authenticateBearerFromAuthUrl']>[0]
> = true;

const baseRegistry = new BaseRegistry();

// @ts-expect-error requestOptions should be an object
baseRegistry.authenticateBasic(123, 'credentials');

// @ts-expect-error requestOptions should be an object
baseRegistry.authenticateBearer(123, 'token');

// @ts-expect-error requestOptions.headers should be a key-value object
baseRegistry.authenticateBasic({ headers: 'bad-headers' }, 'credentials');

void authenticateBasicRequestOptionsIsTyped;
void authenticateBearerRequestOptionsIsTyped;
void authenticateBearerFromAuthUrlRequestOptionsIsTyped;
