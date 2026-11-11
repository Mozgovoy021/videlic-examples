<?php

declare(strict_types=1);

namespace App;

final class Slug
{
    public static function from(string $text): string
    {
        $slug = strtolower(trim($text));
        $slug = preg_replace('/[^a-z0-9]+/', '-', $slug) ?? '';
        $slug = preg_replace('/-{2,}/', '-', $slug) ?? '';
        return trim($slug, '-');
    }
}
