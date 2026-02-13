module.exports = {
  protocol: process.env.DD_PROTOCOL || 'http',
  host: process.env.DD_HOST || 'localhost',
  port: process.env.DD_PORT || 3000,
  username: process.env.DD_USERNAME || 'john',
  password: process.env.DD_PASSWORD || 'doe',
};
