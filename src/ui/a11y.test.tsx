// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';
import { AppProviders } from './AppProviders';
import { App } from './App';
import { createFakeBackend } from './mock/fakeBackend';
import { pollUntil } from './test/poll';
import { renderWithTheme } from './test/render';

/**
 * WCAG 2.0 AA, checked by a second opinion.
 *
 * `contrast.test.ts` measures colour pairs arithmeticly, and the component tests
 * assert roles and labels because those are what a screen reader announces. Neither
 * catches the mistakes nobody thought about: a heading level that skips, a control
 * identified only by its placeholder, a modal that leaves the page behind it in the
 * tab order. So the rendered interface is handed to axe-core, which knows the rules
 * better than this file does.
 *
 * The whole application is scanned rather than components stitched together by hand,
 * because the violations that matter live in the composition — a drawer, a dialog, a
 * live region — and not in one component in isolation.
 *
 * Colour contrast reports "incomplete" rather than passing under jsdom, which lays
 * nothing out. That is expected, and is exactly why the arithmetic suite exists.
 */
afterEach(cleanup);

async function expectAccessible(container: Element, label: string) {
  const results = await axe.run(container as HTMLElement, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
  });
  const findings = results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.map((node) => node.html.slice(0, 140)),
  }));
  expect(findings, 'accessibility violations in ' + label).toEqual([]);
}

function renderApp(api = createFakeBackend()) {
  const view = renderWithTheme(
    <AppProviders>
      <App api={api} />
    </AppProviders>,
  );
  return { ...view, api };
}

describe('accessibility', () => {
  it('the empty working interface has no violations', async () => {
    const { container } = renderApp();
    await screen.findByRole('heading', { level: 1 });
    await expectAccessible(container, 'the main window with no documents');
  });

  it('the first-run model gate has no violations', async () => {
    const { container } = renderApp(createFakeBackend({ modelsInstalled: false }));
    await screen.findByRole('dialog');
    await expectAccessible(container, 'the first-run model gate');
  });

  it('a corpus with a cited answer has no violations', async () => {
    const { container, api } = renderApp();
    await screen.findByRole('heading', { level: 1 });

    await api.addDocuments({ paths: ['C:/fake/contract.pdf'] });
    await pollUntil(async () => (await api.listDocuments())[0]?.status.state === 'ready');

    const composer = await screen.findByRole('textbox', { name: /ask/i });
    composer.focus();
    screen.getByRole('button', { name: /send/i });
    // Typing into the composer is what makes the enabled state real: a scan of a
    // disabled form would pass by saying nothing.
    const { default: userEvent } = await import('@testing-library/user-event');
    await userEvent.type(composer, 'What is the notice period?');
    await userEvent.keyboard('{Enter}');

    await pollUntil(() => screen.queryAllByText(/\[1\]/).length > 0);
    await expectAccessible(container, 'the conversation with citations');
  });

  it('catches a violation when one is really there', async () => {
    // The scan above is only worth anything if it can fail. This fragment contains
    // three deliberate, ordinary mistakes — an image with no text alternative, a
    // button with no accessible name, and a link whose only content is an icon — and
    // the scan has to name all three. If a change ever silences axe (a wrong rule
    // filter, a container that excludes the content), this is the test that says so.
    const host = document.createElement('div');
    host.innerHTML = ['<img src="signature.png">', '<button type="button"></button>', '<a href="#next"><span></span></a>'].join(
      '',
    );
    document.body.append(host);
    try {
      const results = await axe.run(host, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } });
      const ids = results.violations.map((violation) => violation.id);
      expect(ids).toContain('image-alt');
      expect(ids).toContain('button-name');
      expect(ids).toContain('link-name');
    } finally {
      host.remove();
    }
  });

  it('every interactive control in the sidebar is named', async () => {
    const { api } = renderApp();
    await api.addDocuments({ paths: ['C:/fake/contract.pdf'] });
    await pollUntil(async () => (await api.listDocuments())[0]?.status.state === 'ready');

    // Not an axe rule, a review point: an icon button whose accessible name comes
    // only from a tooltip is a coin flip, because tooltips do not open for a screen
    // reader. Every control in the window has to answer to a name of its own.
    const buttons = Array.from(document.querySelectorAll('button'));
    const unnamed = buttons.filter(
      (button) =>
        (button.getAttribute('aria-label') ?? '').trim().length === 0 &&
        (button.textContent ?? '').trim().length === 0,
    );
    expect(unnamed, 'unnamed controls: ' + unnamed.map((button) => button.outerHTML.slice(0, 120)).join('\n')).toHaveLength(
      0,
    );
    expect(buttons.length).toBeGreaterThan(4);
  });
});
