import { type RequestOptions, withAuthorizationHeader } from './auth.js';

const requestOptions: RequestOptions = {
  headers: {
    Accept: 'application/json',
  },
};

void withAuthorizationHeader(requestOptions, 'Bearer', 'token-value', 'missing token');
