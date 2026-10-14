// @vitest-environment happy-dom

import type Content from '../../block/base/content';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Muya } from '../../muya';

const editors: Muya[] = [];
let originalVersion: string | undefined;

beforeEach(() => {
    originalVersion = window.MUYA_VERSION;
    window.MUYA_VERSION = 'test';
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

function leaf(muya: Muya): Content {
    return muya.editor.scrollPage!.firstContentInDescendant()!;
}

describe('selection ownership between editors', () => {
    it('does not expose another editor caret or range', () => {
        const left = boot('Left document\n');
        const right = boot('Right document\n');
        leaf(right).setCursor(1, 1);
        expect(left.getSelection()).toBeNull();
        expect(right.getSelection()?.anchor.block).toBe(leaf(right));
        leaf(right).setCursor(0, 5);
        expect(left.getSelection()).toBeNull();
        expect(right.getSelectedText()).toBe('Right');
    });

    it.each([false, true])('rejects a native range spanning two editors (backward: %s)', (backward) => {
        const left = boot('Left document\n');
        const right = boot('Right document\n');
        const a = document.createTreeWalker(leaf(left).domNode!, NodeFilter.SHOW_TEXT).nextNode()!;
        const b = document.createTreeWalker(leaf(right).domNode!, NodeFilter.SHOW_TEXT).nextNode()!;
        const selection = document.getSelection()!;
        selection.setBaseAndExtent(backward ? b : a, 1, backward ? a : b, 4);
        expect(left.getSelection()).toBeNull();
        expect(right.getSelection()).toBeNull();
    });

    it('clearing the inactive selection leaves the other editor range intact', () => {
        const left = boot('Left document\n');
        const right = boot('Right document\n');
        leaf(right).setCursor(0, 5);
        left.editor.selection.clear();
        expect(right.getSelectedText()).toBe('Right');
    });

    it('rejects foreign endpoints when setting a selection', () => {
        const left = boot('Left document\n');
        const right = boot('Right document\n');
        leaf(left).setCursor(1, 1);
        const endpoint = { block: leaf(right), path: leaf(right).path, offset: 0 };
        left.editor.selection.setSelection(endpoint, endpoint);
        expect(left.getSelection()?.anchor.block).toBe(leaf(left));
        expect(left.editor.selection.anchorBlock).toBe(leaf(left));
    });

    it('does not dispatch an input in one editor to a block in the other', () => {
        const left = boot('Left document\n');
        const right = boot('Right document\n');
        leaf(right).setCursor(1, 1);
        const input = vi.spyOn(leaf(right), 'inputHandler');
        left.domNode.dispatchEvent(new InputEvent('input', { bubbles: true, data: 'x', inputType: 'insertText' }));
        expect(input).not.toHaveBeenCalled();
        expect(left.editor.activeContentBlock).toBeNull();
    });

    it('does not cut a range owned by the other editor', () => {
        const left = boot('Left document\n');
        const right = boot('Right document\n');
        leaf(right).setCursor(0, 5);
        left.editor.clipboard.cutHandler();
        left.flush();
        right.flush();
        expect(left.getMarkdown().trim()).toBe('Left document');
        expect(right.getMarkdown().trim()).toBe('Right document');
    });
});
