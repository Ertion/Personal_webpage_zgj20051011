import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

test('AI app exposes an accessible contribution calendar and year selector', async () => {
    const html = await readFile(join(projectRoot, 'index.html'), 'utf8');
    for (const id of ['aiActivityGrid', 'aiActivityMonths', 'aiCalendarTitle', 'aiActivityDetail']) {
        assert.match(html, new RegExp(`id="${id}"`));
    }
    assert.match(html, /data-ai-year="2026"[^>]+aria-pressed="true"/);
    assert.match(html, /data-ai-year="2025"[^>]+aria-pressed="false"/);
});

test('AI activity data matches the source workbook summaries', async () => {
    const data = JSON.parse(await readFile(join(projectRoot, 'ai-activity-data.json'), 'utf8'));
    assert.deepEqual(
        Object.fromEntries(Object.entries(data.years).map(([year, value]) => [year, {
            activeDays: value.activeDays,
            userMessages: value.userMessages,
            assistantReplies: value.assistantReplies,
            peakDate: value.peakDate,
            peakCount: value.peakCount,
            days: value.days.length
        }])),
        {
            2025: { activeDays: 67, userMessages: 676, assistantReplies: 680, peakDate: '2025-12-18', peakCount: 45, days: 365 },
            2026: { activeDays: 188, userMessages: 1992, assistantReplies: 2307, peakDate: '2026-03-14', peakCount: 44, days: 365 }
        }
    );
});

test('AI activity data is lazy-loaded when the AI app opens', async () => {
    const script = await readFile(join(projectRoot, 'ai-activity-ui.js'), 'utf8');
    assert.match(script, /fetch\('ai-activity-data\.json'/);
    assert.match(script, /event\.detail\?\.app !== 'ai'/);
    assert.match(script, /ArrowLeft: -7, ArrowRight: 7/);
});
