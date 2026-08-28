/**
 * Korean particle gate for Latin-script product names.
 *
 * Korean picks a particle by whether the preceding syllable ends in a consonant or a
 * vowel: 이/은/을/과/으로 after a consonant, 가/는/를/와/로 after a vowel. A Latin-script
 * name takes the particle that matches how it is *read*, not how it is spelled, so the
 * correct form is fixed per name and cannot be derived from the ASCII.
 *
 * "Drydock" reads 드라이독, which ends in ㄱ, so it always takes the consonant forms.
 * `Drydock가` shipped in ko for several releases (CodeRabbit caught it on PR #920) and
 * two more were already in the catalog next to it, in `updateStatus.summary.notify` and
 * `configView`. Nothing flagged them: key-parity compares structure, placeholder-parity
 * compares `{braces}`, and no-raw-text only looks at English leaking into templates.
 *
 * This gate matters most for the strings Crowdin stores. Re-uploading a corrected
 * translation adds a candidate alongside the stored one rather than replacing it (the
 * same behaviour that produced #919 on the READMEs), so a sync can put the wrong particle
 * back. When it does, this fails loudly instead of shipping quietly.
 *
 * Deliberately not generic. Applying the rule to every proper noun would need each one's
 * Korean reading: "Docker" is 도커, vowel-final, so `Docker가` is *correct* and a blanket
 * rule would flag it. Add a name here only after checking how it is read.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const koDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../src/locales/ko');

/** Latin-script names whose Korean reading ends in a consonant, so they take 이/은/을/과/으로. */
const CONSONANT_FINAL_NAMES = ['Drydock'];

/** Vowel-final particles, which are the wrong choice after any name in the list above. */
const VOWEL_FINAL_PARTICLES = ['가', '는', '를', '와', '로'] as const;

const CORRECTION: Record<(typeof VOWEL_FINAL_PARTICLES)[number], string> = {
  가: '이',
  는: '은',
  를: '을',
  와: '과',
  로: '으로',
};

/**
 * The trailing lookahead keeps the match to a standalone particle. Without it `Drydock로`
 * would also fire on a name followed by a Hangul word that merely starts with the same
 * syllable.
 */
const WRONG_PARTICLE = new RegExp(
  `(${CONSONANT_FINAL_NAMES.join('|')})(${VOWEL_FINAL_PARTICLES.join('|')})(?![가-힣])`,
  'g',
);

interface ParticleViolation {
  namespace: string;
  name: string;
  wrong: string;
  correct: string;
  context: string;
}

const violations: ParticleViolation[] = [];

for (const nsFile of readdirSync(koDir).filter((f) => f.endsWith('.json'))) {
  const raw = readFileSync(join(koDir, nsFile), 'utf8');
  for (const line of raw.split('\n')) {
    for (const m of line.matchAll(WRONG_PARTICLE)) {
      const wrong = m[2] as (typeof VOWEL_FINAL_PARTICLES)[number];
      violations.push({
        namespace: nsFile,
        name: m[1],
        wrong,
        correct: CORRECTION[wrong],
        context: line.trim().slice(0, 120),
      });
    }
  }
}

describe('korean-particles', () => {
  test('consonant-final product names take consonant-form particles in ko', () => {
    const message =
      violations.length === 0
        ? ''
        : 'Wrong Korean particle after a consonant-final product name:\n' +
          violations
            .map(
              (v) =>
                `  ko/${v.namespace}: "${v.name}${v.wrong}" should be "${v.name}${v.correct}"\n` +
                `    ${v.context}`,
            )
            .join('\n');
    expect(violations, message).toHaveLength(0);
  });

  test('the gate actually matches a wrong particle', () => {
    expect('감지되면 Drydock가 이 업데이트를'.match(WRONG_PARTICLE)).toEqual(['Drydock가']);
    expect('감지되면 Drydock이 이 업데이트를'.match(WRONG_PARTICLE)).toBeNull();
    // A following Hangul syllable means the match was a word, not a particle.
    expect('Drydock로그를 확인하세요'.match(WRONG_PARTICLE)).toBeNull();
  });
});
