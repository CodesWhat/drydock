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
const normalizeImageUrlImageIsTyped: ExpectNotAny<
  Parameters<BaseRegistry['normalizeImageUrl']>[0]
> = true;
const normalizeImageUrlReturnIsTyped: ExpectNotAny<ReturnType<BaseRegistry['normalizeImageUrl']>> =
  true;
const matchRegistryHostImageIsTyped: ExpectNotAny<
  Parameters<BaseRegistry['matchRegistryHost']>[0]
> = true;
const matchRegistryHostBaseHostsIsTyped: ExpectNotAny<
  Parameters<BaseRegistry['matchRegistryHost']>[1]
> = true;
const maskSensitiveFieldsFieldsIsTyped: ExpectNotAny<
  Parameters<BaseRegistry['maskSensitiveFields']>[0]
> = true;
const maskSensitiveFieldsReturnIsTyped: ExpectNotAny<
  ReturnType<BaseRegistry['maskSensitiveFields']>
> = true;

const baseRegistry = new BaseRegistry();

// @ts-expect-error requestOptions should be an object
baseRegistry.authenticateBasic(123, 'credentials');

// @ts-expect-error requestOptions should be an object
baseRegistry.authenticateBearer(123, 'token');

// @ts-expect-error requestOptions.headers should be a key-value object
baseRegistry.authenticateBasic({ headers: 'bad-headers' }, 'credentials');

// @ts-expect-error normalizeImageUrl expects a container image
baseRegistry.normalizeImageUrl({ registry: {} });

// @ts-expect-error matchRegistryHost expects string base hosts
baseRegistry.matchRegistryHost({ registry: { url: 'docker.io' } }, /docker\.io/);

// @ts-expect-error maskSensitiveFields expects string field names
baseRegistry.maskSensitiveFields([123]);

void authenticateBasicRequestOptionsIsTyped;
void authenticateBearerRequestOptionsIsTyped;
void authenticateBearerFromAuthUrlRequestOptionsIsTyped;
void normalizeImageUrlImageIsTyped;
void normalizeImageUrlReturnIsTyped;
void matchRegistryHostImageIsTyped;
void matchRegistryHostBaseHostsIsTyped;
void maskSensitiveFieldsFieldsIsTyped;
void maskSensitiveFieldsReturnIsTyped;
