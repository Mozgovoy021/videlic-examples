<?php

use App\Slug;

it('lowercases and joins words with hyphens', function () {
    expect(Slug::from('  Hello, World  '))->toBe('hello-world');
});

it('returns an empty slug for punctuation only', function () {
    expect(Slug::from('!!!'))->toBe('');
});

it('keeps digits', function () {
    expect(Slug::from('Release 2.0'))->toBe('release-2-0');
});

it('collapses dashes left by unicode letters and falls back when empty', function () {
    expect(Slug::from('Café — Ñandú'))->toBe('caf-and');
    expect(Slug::from('ÄÖÜ'))->toBe('acc656');
});
