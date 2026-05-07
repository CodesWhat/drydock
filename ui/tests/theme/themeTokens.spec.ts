import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('theme tokens', () => {
  const tokensSource = readFileSync(join(process.cwd(), 'src/theme/tokens.css'), 'utf8');

  it('scopes light theme tokens to html so nested layout classes cannot override the selected family', () => {
    expect(tokensSource).toContain('html.light:not([class*="theme-"]),');
    expect(tokensSource).toContain('html.theme-one-dark.light');
    expect(tokensSource).not.toContain('\n.light:not([class*="theme-"]),');
  });

  it('scopes named theme token blocks to html', () => {
    for (const family of ['github', 'dracula', 'catppuccin', 'gruvbox', 'ayu']) {
      expect(tokensSource).toContain(`html.theme-${family}.dark`);
      expect(tokensSource).toContain(`html.theme-${family}.light`);
      expect(tokensSource).not.toContain(`\n.theme-${family}.dark`);
      expect(tokensSource).not.toContain(`\n.theme-${family}.light`);
    }
  });
});
