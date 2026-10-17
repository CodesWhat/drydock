import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Published 1.7 candidate sections from the rc.24 preparation commit b6b3a33dd,
// and 1.6.1 history from its GA preparation commit 99ceaf2ec. Hashes preserve
// the original headings, dates and bodies independently of later branch tips.
const releasedSections = [
  ['1.7.0-rc.24', '4f43ee81a539c70eb2b941d060aed96a5da1648f90e541c74cdc21f7ea2bd0a9'],
  ['1.7.0-rc.23', 'e38551a915e94ae18ffe1a35683d6576ea9f4c4066804d577bd756444b78960f'],
  ['1.7.0-rc.22', '85cf7f67abdbcd3525823031ff51f7710baadf64c6f30c1b79a55730fd487025'],
  ['1.7.0-rc.21', '0bdd74038e4da9efcfb113f15e2c907e1a55fcd287a13c57e9e514cec9a6944b'],
  ['1.7.0-rc.20', 'a09030a9c02c87fe5281dc13e3cd91cd2ba47d127b21b71f7ae221885171cac4'],
  ['1.7.0-rc.19', '0ca8195fb335096b152edad19e7b952acc388063f2f40d64429afe88134a8efa'],
  ['1.7.0-rc.18', '3f5318d2720ec081d09ce95b16264899d5814f431e24212983ee21322dce3376'],
  ['1.7.0-rc.17', '36ede9a155496278c4ebf5fa0a775f2296cb26b1f78458d6ec41258f070728f1'],
  ['1.7.0-rc.16', '889297f540721169bf2ace982d1f3c9e91734d11ec2482b61ead00ca32e26c49'],
  ['1.7.0-rc.15', '5df3f8ed698fcb32d358a11dc7ebf4c07f7455e319ef29b3b3e1a60bdbfd806d'],
  ['1.7.0-rc.14', 'f808372465e8f91e10fd65089feefee172f456e60f2499de9f13217c1026b399'],
  ['1.7.0-rc.13', 'd0d713b481a2d45e7747f99d7f4775193e6f4b4ca07073fb624c0d83b4530441'],
  ['1.7.0-rc.12', '518b291037c8c64e9fd7abd75bd10bb4ac1510b116f868d7ed2c7534cbecc867'],
  ['1.7.0-rc.11', '7ec63408a14db3938ac5aee70900fb1c9982df1d7ae525077a164c23297f5fb9'],
  ['1.7.0-rc.10', '033b57684115b31b8397aaac8446502722afdab1ba4bdd454b025ad8f157a8fa'],
  ['1.7.0-rc.9', 'ec47e943aecc8628619fabc74cf54737a62276174a773be1be8c90b00b45a348'],
  ['1.7.0-rc.8', 'e28307573c6a6b672781c1e3de29be658d09a8099d1f8ff9ad50ce5b86fc902b'],
  ['1.7.0-rc.7', '9c1370b0cf3ce8b16f4307391783002363ca7ac8a99fb9054d6eb4f7752cae37'],
  ['1.7.0-rc.6', 'a45e8fa437786b7594fd4356b78c02711af4d72ea746494a83a05a5f984bbaab'],
  ['1.7.0-rc.5', 'e53622d8583a6d48c3930888fde1f0e6e2a87664fa743e72375771723175bfbb'],
  ['1.7.0-rc.4', '285ecacd8434366595a71fbc25544f6b2c395f6d095e4a2f813f7cc5419fac57'],
  ['1.7.0-rc.3', '315b73dbd18ea9cda66ee60e88d5d981e84221c10186d19b9806c8cb80827cc1'],
  ['1.7.0-rc.2', '6d63017844a16b26180eab2b4bd48969b095e5a25a2291ec3b346ce81fbce6f6'],
  ['1.7.0-rc.1', '325bdfd9416f44c8cdaed5344209f2689c41993b1f7ecd37fed01eb86add36b4'],
  ['1.6.1', '6353da17f29fba5dba91bb97ebc3adf600719d4cc9a982848968cc4090e6cadd'],
  ['1.6.1-rc.15', 'e366c96f966468f79e6afc1caa2b27fc496120cdd8ff0c66b2949692adfd131d'],
  ['1.6.1-rc.14', '1bc15006f3bd2a190e873f9dd3f90cfac6d6d62b9be4858974252e2f2cb870a2'],
  ['1.6.1-rc.13', 'cfcb064a21dc1b7bd7b9f78bcedd51e481dc17420ade6e095348fa8fae62fde9'],
  ['1.6.1-rc.12', '2eb64e825d7d5c7ddbb00822e3d2d58436f5dff7711b4df4d4d4d453d6fe94fb'],
  ['1.6.1-rc.11', 'f371d11ee3ac3f688ae3e2f1a38f33e526e7e0a82b7ed50b33adc33c0e037d02'],
  ['1.6.1-rc.10', '3813afbb6ed84197d6af48d5ac71b733d63f8e1d6b40b450de5c78c84375a8b0'],
  ['1.6.1-rc.9', 'eda2de25b3f989557b92ee5ee90dac7fea00dbae14212c31a69a01752538730c'],
  ['1.6.1-rc.8', '8c4ab5ac1f83e9a10bf009b046ff0776a6a85e4ff68b602b1e20b0ddff933d33'],
  ['1.6.1-rc.7', 'b66a0150003860d9db459fd39ed45051ba952ecbc981d05a647d49d23b1d5a23'],
  ['1.6.1-rc.6', 'e7221c7a803449835e36ec6999f726468efca46b346b02ade9e0907aa93ba1a8'],
  ['1.6.1-rc.5', 'b30520276de5f26ab901d7624580ab3ad0b6a4ee7242608c021f5472cb5919ae'],
  ['1.6.1-rc.4', 'b222faf40808e9d87bd0f53d65848f7de0c3a9a5ed627ea5c6d5d0ba38621594'],
  ['1.6.1-rc.3', '1a3a31a12833831cac5b8a8443c17f4d60b28c6700cf6939989a3e14c0b99c67'],
  ['1.6.1-rc.2', 'dde79e1f479909d56f7744e118a0902b0d2f9bd9b277c847690e36184bc54b60'],
  ['1.6.1-rc.1', 'ffe29563043696c49329c5daf1b6fb52f4bf364a8a6b2f0a374813f4c957fb83'],
];

function sections(contents) {
  const body = contents.split('\n[Unreleased]:')[0];
  const headings = [...body.matchAll(/^## \[([^\]]+)\].*$/gm)];
  return headings.map((heading, index) => [
    heading[1],
    body.slice(heading.index, headings[index + 1]?.index ?? body.length).trim(),
  ]);
}

test('the root changelog preserves complete published 1.7 RC and 1.6.1 history', () => {
  const changelog = readFileSync('CHANGELOG.md', 'utf8');
  const entries = sections(changelog);
  for (const [version, expectedHash] of releasedSections) {
    const matches = entries.filter(([name]) => name === version);
    assert.equal(matches.length, 1, `${version} must have exactly one section`);
    assert.equal(createHash('sha256').update(matches[0][1]).digest('hex'), expectedHash, version);
    assert.ok(changelog.includes(`[${version}]: https://github.com/CodesWhat/drydock/compare/`));
  }
});

test('settings migration remains compatible with the version being served', () => {
  const v16 = readFileSync('content/docs/v1.6/deprecations/index.mdx', 'utf8');
  const v15 = readFileSync('content/docs/v1.5/deprecations/index.mdx', 'utf8');
  assert.ok(v16.includes('Change `PUT /api/v1/settings` to `PATCH /api/v1/settings`'));
  assert.ok(v16.includes('`Deprecation` and `Sunset` on `PUT /api/v1/settings`'));
  assert.ok(v16.includes('The unversioned `/api/settings` path returns `410 Gone`'));
  assert.ok(v15.includes('Change `PUT /api/settings` to `PATCH /api/settings`'));
});
