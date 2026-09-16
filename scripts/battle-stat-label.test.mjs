import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { componentLoader } from './component-test-loader.mjs';

const language = componentLoader()('lib/language.ts');
const labels = {
  kills: ['Kills', 'Фраги', 'Фраги'], deaths: ['Deaths', 'Смерти', 'Смерти'], spawns: ['Spawns', 'Спавны', 'Спавны'],
  killDeath: ['Kills / deaths', 'Фраги / Смерти', 'Фраги / Смерти'],
  killSpawn: ['Kills / spawns', 'Фраги / Спавны', 'Фраги / Спавны'],
};

test('compact Russian stat headings keep full tooltips, screen-reader text and game icons', () => {
  const Label = componentLoader({ './language-provider': { useTranslation: () => ({ language: 'ru', t: key => language.translate('ru', key) }) } })('battle-stat-label.tsx').default;
  for (const [kind, [, full, short]] of Object.entries(labels)) {
    const html = renderToStaticMarkup(React.createElement(Label, { kind }));
    assert.ok(html.includes(`title="${full}"`)); assert.ok(html.includes(`data-game-icon="${kind}"`));
    assert.ok(html.includes(`>${short}</span>`));
    if (short !== full) {
      assert.ok(html.includes(`<span aria-hidden="true">${short}</span>`));
      assert.ok(html.includes(`<span class="activity-sr-only">${full}</span>`));
    }
    assert.doesNotMatch(html, /\(compact\)|font-size|text-overflow|<abbr/);
  }
});

test('English headings and full translations elsewhere stay unchanged', () => {
  const Label = componentLoader()('battle-stat-label.tsx').default;
  for (const [kind, [english, russian]] of Object.entries(labels)) {
    const html = renderToStaticMarkup(React.createElement(Label, { kind }));
    assert.ok(html.includes(`>${english}</span>`));
    assert.doesNotMatch(html, /activity-sr-only|\(compact\)/);
    assert.equal(language.translate('ru', english), russian);
  }
});

test('Results and session tables and ratio cards share the constrained heading component', () => {
  for (const file of ['file-battles-panel.tsx', 'session-overview.tsx']) {
    const source = readFileSync(new URL('../app/' + file, import.meta.url), 'utf8');
    for (const kind of Object.keys(labels)) assert.ok(source.includes(`<BattleStatLabel kind="${kind}" />`), file + ': ' + kind);
    assert.match(source, /number\(killCount\(b\)\)/);
    assert.match(source, /number\(b\.deaths\)/); assert.match(source, /number\(b\.spawns\)/);
  }
});

test('stat text can wrap within fixed columns without smaller fonts, clipping or changing global labels', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  const textRule = css.match(/\.battle-stat-label \.game-label-text \{([^}]+)\}/)?.[1] ?? '';
  for (const rule of ['max-width: 100%', 'white-space: normal', 'overflow-wrap: anywhere', 'line-height: 1.35']) assert.ok(textRule.includes(rule));
  assert.doesNotMatch(textRule, /font-size|overflow: hidden|text-overflow/);
  assert.match(css, /\.results-table th:first-child \{ width: 40%; \}/);
  assert.match(css, /\.results-table thead \.battle-stat-label, \.session-table thead \.battle-stat-label \{[^}]*flex-direction: row; flex-wrap: wrap; justify-content: center/);
  assert.match(css, /\.results-ratios > div \{ min-width: 0;/);
});
