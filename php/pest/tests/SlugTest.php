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

it('collapses dashes left by unicode letters', function () {
    expect(Slug::from('Café — Über ñ x'))->toBe('caf-ber-x');
});
