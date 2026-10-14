// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Muya } from '../../muya';

const editors: Muya[] = [];
let originalVersion: string | undefined;

beforeEach(() => {
    originalVersion = window.MUYA_VERSION;
    window.MUYA_VERSION = 'test';
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    while (editors.length)
        editors.pop()!.destroy();
    document.getSelection()?.removeAllRanges();
    vi.restoreAllMocks();
    if (originalVersion === undefined)
        delete (window as Partial<Window>).MUYA_VERSION;
    else
        window.MUYA_VERSION = originalVersion;
});

function boot(markdown: string): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, { markdown });
    muya.init();
    editors.push(muya);
    return muya;
}

describe('a failed deferred edit batch', () => {
    it('preserves live edits, retains undo/redo, and accepts subsequent edits', () => {
        const muya = boot('Original text\n');
        const leaf = muya.editor.scrollPage!.firstContentInDescendant()!;
        leaf.text = 'Original text edited';
        leaf.setCursor(leaf.text.length, leaf.text.length, true);
        muya.editor.jsonState.removeOperation([99]);
        expect(() => muya.flush()).not.toThrow();
        expect(muya.getMarkdown().trim()).toBe('Original text edited');
        expect(muya.getHistory().stack.undo).toHaveLength(1);
        expect(muya.getHistory().stack.undo[0].rebuild).toBe(true);
        muya.undo();
        expect(muya.getMarkdown().trim()).toBe('Original text');
        muya.redo();
        expect(muya.getMarkdown().trim()).toBe('Original text edited');
        muya.editor.scrollPage!.firstContentInDescendant()!.text = 'Further typing';
        expect(() => muya.flush()).not.toThrow();
        expect(muya.getMarkdown().trim()).toBe('Further typing');
    });

    it('does not steal selection or edit the other pane while recovering', () => {
        const left = boot('Left document\n');
        const right = boot('Right document\n');
        const rightLeaf = right.editor.scrollPage!.firstContentInDescendant()!;
        rightLeaf.setCursor(0, 5);
        left.editor.scrollPage!.firstContentInDescendant()!.text = 'Left edited';
        left.editor.jsonState.removeOperation([99]);
        expect(() => left.flush()).not.toThrow();
        expect(left.getMarkdown().trim()).toBe('Left edited');
        expect(right.getMarkdown().trim()).toBe('Right document');
        expect(right.getSelectedText()).toBe('Right');
        expect(right.getHistory().stack.undo).toHaveLength(0);
    });

    it('drops a stale operation without creating a change or replaying it', () => {
        const muya = boot('Original text\n');
        const change = vi.fn();
        muya.on('json-change', change);
        muya.editor.jsonState.removeOperation([99]);
        expect(() => muya.flush()).not.toThrow();
        expect(change).not.toHaveBeenCalled();
        expect(muya.getHistory().stack.undo).toHaveLength(0);
        muya.editor.scrollPage!.firstContentInDescendant()!.text = 'Next edit';
        expect(() => muya.flush()).not.toThrow();
        expect(change).toHaveBeenCalledTimes(1);
        expect(muya.getMarkdown().trim()).toBe('Next edit');
    });
});
